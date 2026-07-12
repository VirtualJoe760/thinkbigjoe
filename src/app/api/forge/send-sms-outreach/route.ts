import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db, forgeSites, activityLog } from "@/db";
import { sendSms } from "@/lib/sms";
import { composeSmsOutreach } from "@/lib/forge-outreach";
import { notifyTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * First-touch SMS outreach for marketing-approved prospects with a phone + claim code
 * + a preview/live site. Mirrors the email drip: fired frequently, each run sends a
 * SMALL jittered number (weekday 9am–6pm PT) so it trickles like a real person. A
 * Telegram receipt fires after every send. `?batch=N` sends up to N now, bypassing
 * the window/jitter (for a manual kickoff). `?dry=1` previews without sending.
 *
 * Eligibility excludes anyone already SMS-first-touched (a logged sms_outreach_sent),
 * already a claimed customer, or without a reachable number/code/site.
 * Auth: Bearer CRON_SECRET.
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === expected;
}

const DAILY_GOAL = Number(process.env.SMS_OUTREACH_DAILY_GOAL || 15);

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const batch = Number(url.searchParams.get("batch") || 0); // manual kickoff: send up to N now

  // Eligible new prospects — never SMS-first-touched, reachable, not yet a customer.
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
        AND NOT EXISTS (
          SELECT 1 FROM activity_log al
          WHERE al.event_type = 'sms_outreach_sent'
            AND (al.metadata->'detail'->>'siteId') = fs.id::text
        )
      -- Highest-performing first: rated businesses, best rating, most reviews. This
      -- is who we're pitching ("high Google rating, no website") — so the
      -- personalized rating hook always lands, and top prospects get reached first.
      ORDER BY (google_rating ~ '^[0-9.]+$') DESC,
               (CASE WHEN google_rating ~ '^[0-9.]+$' THEN google_rating::numeric ELSE 0 END) DESC,
               (CASE WHEN review_count ~ '^[0-9]+$' THEN review_count::int ELSE 0 END) DESC,
               created_at DESC`)
  ).rows as Array<{
    id: number; businessName: string; ownerName: string | null;
    phone: string; claimCode: string; liveUrl: string | null; slug: string | null;
    googleRating: string | null; reviewCount: string | null;
  }>;

  // Daily cap (today's sms_outreach_sent).
  const sentToday = Number(
    (await db.execute(sql`
      SELECT count(*)::int AS n FROM activity_log
      WHERE event_type = 'sms_outreach_sent' AND created_at >= date_trunc('day', now())`)
    ).rows[0]?.n ?? 0,
  );
  const room = Math.max(0, DAILY_GOAL - sentToday);

  let perRun: number;
  if (batch > 0) {
    perRun = Math.min(batch, eligible.length); // manual kickoff — send up to N regardless of window
  } else if (dry) {
    perRun = eligible.length;
  } else {
    // Drip pacing: weekday business hours (PT), small jittered count, min gap.
    const pt = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const hour = pt.getHours(), dow = pt.getDay();
    if (!(dow >= 1 && dow <= 5 && hour >= 9 && hour < 18)) {
      return NextResponse.json({ ok: true, skipped: "outside sending window (Mon–Fri 9am–6pm PT)", sent: 0, sentToday, dailyGoal: DAILY_GOAL });
    }
    const lastAt = (await db.execute(sql`
      SELECT max(created_at) AS at FROM activity_log WHERE event_type = 'sms_outreach_sent'`)
    ).rows[0]?.at as string | null;
    const sinceMin = lastAt ? (Date.now() - new Date(lastAt).getTime()) / 60000 : Infinity;
    const jitter = [0, 1, 1, 1, 2][Math.floor(Math.random() * 5)];
    perRun = sinceMin < 8 ? 0 : Math.min(jitter, room);
  }

  const toSend = eligible.slice(0, Math.min(perRun, batch > 0 ? perRun : room || perRun));

  if (dry) {
    return NextResponse.json({
      ok: true, dry: true, eligible: eligible.length, sentToday, dailyGoal: DAILY_GOAL,
      preview: toSend.slice(0, 10).map((p) => ({ business: p.businessName, phone: p.phone, text: composeSmsOutreach(p) })),
    });
  }

  const results: Array<{ business: string; phone: string; ok: boolean; error?: string }> = [];
  for (const p of toSend) {
    const msg = composeSmsOutreach(p);
    const res = await sendSms(p.phone, msg);
    const ok = "ok" in res && res.ok === true;
    results.push({ business: p.businessName, phone: p.phone, ok, error: !ok ? ("error" in res ? res.error : "not configured") : undefined });

    // Log the attempt so it never re-fires (success or hard fail) + shows on the lead timeline.
    await db.insert(activityLog).values({
      actor: "joe",
      eventType: "sms_outreach_sent",
      summary: `${ok ? "📱 Texted" : "⚠️ Text failed"} ${p.businessName} (${p.phone})`,
      metadata: { detail: { siteId: p.id, channel: "text", note: msg, to: p.phone, sent: ok } },
    }).catch(() => {});
    if (ok) {
      await db.update(forgeSites).set({ contactedAt: sql`now()` }).where(eq(forgeSites.id, p.id)).catch(() => {});
      await notifyTelegram(`📱 Texted ${p.businessName} (${p.phone}):\n${msg}`);
    } else {
      await notifyTelegram(`⚠️ Text to ${p.businessName} (${p.phone}) failed: ${results.at(-1)!.error}`);
    }
  }

  return NextResponse.json({
    ok: true, sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length,
    eligible: eligible.length, sentToday: sentToday + results.filter((r) => r.ok).length, dailyGoal: DAILY_GOAL, results,
  });
}
