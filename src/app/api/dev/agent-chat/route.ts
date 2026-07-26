import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { prospectSiteUrl } from "@/lib/forge-outreach";
import { smsAgentReply, smsAgentModel, type SmsProspect, type SmsTurn } from "@/lib/sms-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Test bench for the SMS communications agent — talk to it directly, no Twilio, no texts sent.
 *
 * This exists because the agent shipped for weeks without anyone ever having a conversation with
 * it; it was only ever judged from the code and from transcripts after the fact. Before changing
 * its prompt or its model, argue with it here first.
 *
 *   curl -s localhost:3000/api/dev/agent-chat -H "Authorization: Bearer $CRON_SECRET" \
 *     -H 'content-type: application/json' \
 *     -d '{"siteId":21,"message":"I dont need a website","history":[]}' | jq -r .reply
 *
 * `history` is the conversation SO FAR ([{from:"them"|"us",text}]) — pass it to drive a multi-turn
 * conversation that isn't in the database. Omit it entirely to replay against the real thread on
 * record for that site.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    siteId?: number;
    message?: string;
    history?: Array<{ from: "them" | "us"; text: string }>;
    model?: string;
  };
  const siteId = Number(body.siteId);
  const message = (body.message || "").trim();
  if (!siteId || !message) {
    return NextResponse.json({ error: "siteId and message are required" }, { status: 400 });
  }

  const rows = (
    await db.execute(sql`
      SELECT id, business_name AS "businessName", owner_name AS "ownerName", claim_code AS "claimCode",
             slug, live_url AS "liveUrl", phone
      FROM forge_sites WHERE id = ${siteId} LIMIT 1`)
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
  if (!s) return NextResponse.json({ error: `no site ${siteId}` }, { status: 404 });

  const prospect: SmsProspect = {
    id: s.id,
    businessName: s.businessName,
    ownerName: s.ownerName,
    claimCode: s.claimCode,
    site: prospectSiteUrl({ liveUrl: s.liveUrl, slug: s.slug }),
    phone: s.phone || "+10000000000",
  };

  const history: SmsTurn[] | undefined = body.history?.map((h) =>
    h.from === "them" ? { role: "user" as const, text: h.text } : { role: "assistant" as const, text: h.text },
  );

  const started = Date.now();
  const reply = await smsAgentReply(prospect, message, history, body.model ? { model: body.model } : undefined);
  return NextResponse.json({
    model: body.model ? `ollama-cloud/${body.model}` : smsAgentModel(),
    business: prospect.businessName,
    them: message,
    reply,
    ms: Date.now() - started,
  });
}
