import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { isDropCowboyConfigured } from "@/lib/dropcowboy";
import { dropToSite, type VmSite } from "@/lib/voicemail-outreach";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ringless-voicemail first-touch — the "call, then follow up with a text" sequence. For each fresh
 * prospect (worst-first, never voicemailed or texted, reachable, not a customer, not opted out /
 * AI-paused) it drops a pre-recorded voicemail via Drop Cowboy, then sends the first-touch SMS with
 * the site link. `?dry=1` previews; `?batch=N` drops up to N now (manual kickoff); otherwise it
 * drips in a weekday window like the SMS sender. A Telegram receipt fires per drop + text.
 *
 * Auth: Bearer CRON_SECRET. Not auto-scheduled yet — verify a live drop first, then add the cron.
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") === expected;
}

const DAILY_GOAL = Number(process.env.VOICEMAIL_OUTREACH_DAILY_GOAL || 25);

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const batch = Number(url.searchParams.get("batch") || 0);
  const withText = url.searchParams.get("text") !== "0"; // default: also send the follow-up text

  if (!dry && !isDropCowboyConfigured) {
    return NextResponse.json({ ok: false, error: "Drop Cowboy not configured (set DROPCOWBOY_* env)." }, { status: 200 });
  }

  // Fresh prospects: never voicemailed AND never SMS-first-touched, reachable, not a customer.
  const eligible = (
    await db.execute(sql`
      SELECT id, business_name AS "businessName", owner_name AS "ownerName",
             phone, claim_code AS "claimCode", live_url AS "liveUrl", slug,
             google_rating AS "googleRating", review_count AS "reviewCount"
      FROM forge_sites fs
      WHERE marketing_approved_at IS NOT NULL
        AND phone IS NOT NULL AND phone <> ''
        AND claim_code IS NOT NULL
        AND (live_url IS NOT NULL OR slug IS NOT NULL)
        AND status <> 'deleted'
        AND claimed_by_user_id IS NULL
        AND ai_paused = false
        AND outreach_status IS DISTINCT FROM 'opted_out'
        AND NOT EXISTS (
          SELECT 1 FROM activity_log al
          WHERE al.event_type IN ('voicemail_dropped', 'sms_outreach_sent')
            AND (al.metadata->'detail'->>'siteId') = fs.id::text
        )
      ORDER BY (CASE WHEN google_rating ~ '^[0-9.]+$' THEN google_rating::numeric ELSE 0 END) ASC,
               (CASE WHEN review_count ~ '^[0-9]+$' THEN review_count::int ELSE 0 END) ASC,
               created_at DESC`)
  ).rows as VmSite[];

  const droppedToday = Number(
    (await db.execute(sql`
      SELECT count(*)::int AS n FROM activity_log
      WHERE event_type = 'voicemail_dropped' AND created_at >= date_trunc('day', now())`)
    ).rows[0]?.n ?? 0,
  );
  const room = Math.max(0, DAILY_GOAL - droppedToday);

  let perRun: number;
  if (batch > 0) {
    perRun = Math.min(batch, eligible.length);
  } else if (dry) {
    perRun = eligible.length;
  } else {
    const pt = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const hour = pt.getHours(), dow = pt.getDay();
    if (!(dow >= 1 && dow <= 5 && hour >= 9 && hour < 18)) {
      return NextResponse.json({ ok: true, skipped: "outside sending window (Mon–Fri 9am–6pm PT)", dropped: 0, droppedToday, dailyGoal: DAILY_GOAL });
    }
    const lastAt = (await db.execute(sql`
      SELECT max(created_at) AS at FROM activity_log WHERE event_type = 'voicemail_dropped'`)
    ).rows[0]?.at as string | null;
    const sinceMin = lastAt ? (Date.now() - new Date(lastAt).getTime()) / 60000 : Infinity;
    const jitter = [0, 1, 1, 1, 2][Math.floor(Math.random() * 5)];
    perRun = sinceMin < 8 ? 0 : Math.min(jitter, room);
  }

  const toSend = eligible.slice(0, batch > 0 ? perRun : Math.min(perRun, room || perRun));

  if (dry) {
    return NextResponse.json({
      ok: true, dry: true, eligible: eligible.length, droppedToday, dailyGoal: DAILY_GOAL, withText,
      preview: toSend.slice(0, 10).map((p) => ({ business: p.businessName, phone: p.phone })),
    });
  }

  const results: Array<{ business: string; phone: string | null; ok: boolean; texted?: boolean; error?: string }> = [];
  for (const p of toSend) {
    const r = await dropToSite(p, { withText });
    results.push({ business: p.businessName, phone: p.phone, ok: r.ok, texted: r.texted, error: r.ok ? undefined : r.message });
  }

  return NextResponse.json({
    ok: true,
    dropped: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    droppedToday: droppedToday + results.filter((r) => r.ok).length,
    dailyGoal: DAILY_GOAL,
    results,
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "forge/send-voicemail-outreach", configured: isDropCowboyConfigured });
}
