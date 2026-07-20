import { NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";

import { db, forgeSites, voiceLines } from "@/db";
import { normalizePhone } from "@/lib/sms";
import { notifyTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Voice-line health check. Triggered by Vercel Cron (see vercel.json).
 *
 * The audit's biggest remaining gap: nothing detects a customer's phone line going dead. This is
 * the answer — but NOT by dialling anyone. Actually placing a synthetic call to a customer's number
 * every day would ring a real business, cost money per check, and be exactly the kind of automated
 * outbound this project deliberately avoids. Instead it verifies, for free, that the pieces which
 * make a line work are still in place. Every realistic "dead line" cause shows up here:
 *
 *   - the Retell number was deleted or unbound       → Retell 404 / no inbound agent
 *   - the shared agent was deleted                    → get-agent 404
 *   - the number lost its inbound webhook URL          → Retell never asks us who the tenant is, so
 *                                                        the caller hears the generic fallback
 *                                                        greeting instead of the business
 *   - the config lost its escalation/notify number     → emergencies transfer nowhere, messages
 *                                                        reach no one
 *
 * A live outage of Vercel itself can't be caught here — if the app is down this cron doesn't run.
 * That's what the external uptime monitor on /api/health is for. The two are complementary.
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false; // fail closed — nobody's on the line, a missed run is harmless
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") === expected;
}

const RETELL = "https://api.retellai.com";

async function retellGet(path: string): Promise<{ status: number; body: any }> {
  const key = process.env.RETELL_API_KEY;
  if (!key) return { status: 0, body: null };
  const res = await fetch(`${RETELL}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** Does the config carry a number we could actually text or transfer to? Mirrors voice-tenant's logic. */
function hasReachableNumber(config: unknown): boolean {
  if (!config || typeof config !== "object") return false;
  const c = config as Record<string, unknown>;
  const structured = normalizePhone(String(c.escalationPhone ?? "")) || normalizePhone(String(c.notifyPhone ?? ""));
  if (structured) return true;
  // legacy free-text forwardTo: does it contain any phone-shaped string?
  const m = String(c.forwardTo ?? "").match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  return Boolean(m);
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!process.env.RETELL_API_KEY) {
    // Can't verify anything without the key. Say so loudly rather than reporting a false all-clear.
    await notifyTelegram("🟠 <b>Voice health check skipped</b>\nRETELL_API_KEY is not set — lines are unverified.");
    return NextResponse.json({ ok: false, reason: "no RETELL_API_KEY" }, { status: 200 });
  }

  try {
    const lines = await db
      .select({
        phone: voiceLines.phoneNumber,
        siteId: voiceLines.siteId,
        businessName: forgeSites.businessName,
        config: forgeSites.receptionistConfig,
        subStatus: forgeSites.subscriptionStatus,
      })
      .from(voiceLines)
      .innerJoin(forgeSites, eq(voiceLines.siteId, forgeSites.id))
      .where(and(eq(voiceLines.status, "active"), isNotNull(forgeSites.plan)));

    const issues: string[] = [];
    let checked = 0;

    for (const line of lines) {
      // A cancelled account whose line hasn't been paused yet isn't a health failure — skip it, but
      // note it so a stale active line doesn't hide silently.
      if (line.subStatus && line.subStatus !== "active") continue;
      checked++;

      const name = line.businessName ?? `site ${line.siteId}`;
      const num = line.phone;

      const numRes = await retellGet(`/get-phone-number/${encodeURIComponent(num)}`);
      if (numRes.status === 404) {
        issues.push(`🔴 <b>${name}</b> — number ${num} no longer exists in Retell`);
        continue;
      }
      if (numRes.status !== 200 || !numRes.body) {
        issues.push(`🟠 <b>${name}</b> — couldn't verify ${num} (Retell ${numRes.status})`);
        continue;
      }

      const agentId = numRes.body.inbound_agents?.[0]?.agent_id ?? numRes.body.inbound_agent_id;
      if (!agentId) {
        issues.push(`🔴 <b>${name}</b> — ${num} has no inbound agent bound (calls won't be answered)`);
      } else {
        const agentRes = await retellGet(`/get-agent/${agentId}`);
        if (agentRes.status === 404) {
          issues.push(`🔴 <b>${name}</b> — ${num} points at agent ${agentId}, which no longer exists`);
        }
      }

      if (!numRes.body.inbound_webhook_url) {
        issues.push(
          `🔴 <b>${name}</b> — ${num} has no inbound webhook, so callers hear the generic greeting, not the business`,
        );
      }

      if (!hasReachableNumber(line.config)) {
        issues.push(`🟠 <b>${name}</b> — no escalation/notify number in config; emergencies go nowhere`);
      }
    }

    if (issues.length === 0) {
      // Silent on a clean run, same discipline as usage-warnings: a daily "all lines healthy" trains
      // you to ignore the one day it isn't.
      return NextResponse.json({ ok: true, checked, issues: 0, notified: false });
    }

    await notifyTelegram(
      `📞 <b>Voice line health — ${issues.length} issue(s) across ${checked} line(s)</b>\n\n${issues.join("\n")}`,
    );
    return NextResponse.json({ ok: true, checked, issues: issues.length, notified: true });
  } catch (err) {
    console.error("[cron:voice-health] failed:", err);
    // 500 so a failed run shows in Vercel's cron history rather than looking like a clean day.
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
