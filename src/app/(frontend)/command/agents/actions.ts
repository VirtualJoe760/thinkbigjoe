"use server";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { assertAdmin } from "@/lib/require-admin";
import { prospectSiteUrl } from "@/lib/forge-outreach";
import { smsAgentReply, smsAgentModel, type SmsProspect, type SmsTurn } from "@/lib/sms-agent";
import type { ChatTurn } from "./models";

/**
 * Run one turn of the SMS communications agent from the Command Center console — a real
 * conversation with the same brain that answers prospects, so Joe can pressure-test it live
 * (throw objections, switch models, pick any prospect) before it ever texts a customer.
 * Admin-gated. `model` "gemini-2.5-flash" forces the Gemini fallback; anything else is an
 * Ollama Cloud model id.
 */
export async function agentChatTurn(input: {
  siteId: number;
  message: string;
  history: ChatTurn[];
  model: string;
}): Promise<{ reply: string | null; model: string; ms: number }> {
  await assertAdmin();

  const message = (input.message || "").trim();
  if (!message) return { reply: null, model: input.model, ms: 0 };

  const rows = (
    await db.execute(sql`
      SELECT id, business_name AS "businessName", owner_name AS "ownerName", claim_code AS "claimCode",
             slug, live_url AS "liveUrl", phone
      FROM forge_sites WHERE id = ${input.siteId} LIMIT 1`)
  ).rows as Array<{
    id: number;
    businessName: string;
    ownerName: string | null;
    claimCode: string | null;
    slug: string | null;
    liveUrl: string | null;
    phone: string | null;
  }>;
  const s = rows[0];
  if (!s) return { reply: null, model: input.model, ms: 0 };

  const prospect: SmsProspect = {
    id: s.id,
    businessName: s.businessName,
    ownerName: s.ownerName,
    claimCode: s.claimCode,
    site: prospectSiteUrl({ liveUrl: s.liveUrl, slug: s.slug }),
    phone: s.phone || "+10000000000",
  };

  const history: SmsTurn[] = (input.history || []).map((h) =>
    h.from === "them" ? { role: "user", text: h.text } : { role: "assistant", text: h.text },
  );

  // "gemini-…" → let the agent use its Gemini path (no model override); else force the Ollama model id.
  const useGemini = input.model.startsWith("gemini");
  const started = Date.now();
  const reply = await smsAgentReply(prospect, message, history, useGemini ? undefined : { model: input.model });
  return {
    reply,
    model: useGemini ? smsAgentModel() : `ollama-cloud/${input.model}`,
    ms: Date.now() - started,
  };
}
