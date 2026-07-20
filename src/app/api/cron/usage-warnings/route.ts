import { NextResponse } from "next/server";

import { MINUTES_WARN_THRESHOLDS, PLANS } from "@/lib/plans";
import { notifyTelegram } from "@/lib/telegram";
import { sitesOverThreshold, type ThresholdSite } from "@/lib/voice-usage";

export const dynamic = "force-dynamic";

/**
 * Daily voice-minute warning. Triggered by Vercel Cron (see vercel.json).
 *
 * WHY THIS EXISTS: the minutes allowance was previously a number in a config file. sitesOverThreshold()
 * and MINUTES_WARN_THRESHOLDS both existed with ZERO consumers, which meant the protection was
 * entirely passive — a customer could run 4x their allowance and nobody would know until someone
 * happened to look at a margin report weeks later. By then the only options are eat it or send a
 * surprise invoice, and both are bad.
 *
 * Told the day it happens, an overrun is a five-minute call that usually ends in an upgrade. That
 * conversation is the whole point of this file.
 *
 * IT WARNS. IT DOES NOT GATE. Nothing here touches voice_lines, receptionist status, or anything
 * else that could stop a call being answered — that is their business phone. See voice-usage.ts.
 */
function authed(req: Request): boolean {
  // Vercel sets Authorization: Bearer <CRON_SECRET> automatically when the var is set. Fail closed:
  // unlike the voice webhooks, nobody is waiting on the line here, so a missed run is harmless and
  // an open endpoint is not.
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") === expected;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function line(s: ThresholdSite): string {
  const name = s.businessName ?? `site ${s.siteId}`;
  const tier = s.tier ? PLANS[s.tier].label : "unknown plan";
  const base = `<b>${name}</b> — ${s.minutes}/${s.includedMinutes} min (${s.pctUsed}%) · ${tier}`;
  if (!s.overageMinutes) return base;
  return (
    `${base}\n    ${s.overageMinutes} min over · ${money(s.overageDueCents)} to bill` +
    `\n    → call them: upgrade, or invoice the overage`
  );
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [warnPct, overPct] = MINUTES_WARN_THRESHOLDS;

  try {
    // One query at the lower threshold, then split in JS — running it twice would double the work
    // and could report a site in both buckets if usage moved between the two calls.
    const flagged = await sitesOverThreshold(warnPct);
    const over = flagged.filter((s) => s.pctUsed >= overPct);
    const approaching = flagged.filter((s) => s.pctUsed < overPct);

    if (flagged.length === 0) {
      // Deliberately silent on a clean day. A daily "all good" trains you to ignore the channel,
      // and this alert only works if it's rare enough to still mean something.
      return NextResponse.json({ ok: true, flagged: 0, notified: false });
    }

    const parts: string[] = ["📞 <b>Voice minutes</b>"];
    if (over.length) {
      parts.push(`\n<b>OVER ALLOWANCE (${over.length})</b>`, ...over.map(line));
    }
    if (approaching.length) {
      parts.push(`\n<b>Approaching (${approaching.length})</b>`, ...approaching.map(line));
    }
    const totalDue = over.reduce((n, s) => n + s.overageDueCents, 0);
    if (totalDue > 0) parts.push(`\n<b>${money(totalDue)}</b> of overage to bill this period.`);

    await notifyTelegram(parts.join("\n"));

    return NextResponse.json({
      ok: true,
      flagged: flagged.length,
      over: over.length,
      approaching: approaching.length,
      overageDueCents: totalDue,
      notified: true,
    });
  } catch (err) {
    console.error("[cron:usage-warnings] failed:", err);
    // 500 so a failed run is visible in Vercel's cron history rather than looking like a quiet day —
    // which is exactly what a silent-on-clean alert would otherwise be mistaken for.
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
