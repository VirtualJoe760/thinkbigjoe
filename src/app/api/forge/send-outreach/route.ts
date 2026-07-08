import { NextResponse } from "next/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db, forgeSites, activityLog, outreachEngine } from "@/db";
import { sendForgeOutreachEmail } from "@/lib/email";
import { composeOutreach } from "@/lib/forge-outreach";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Batch owner-outreach for BUILT + marketing-approved sites (the "your new site is live —
 * claim it" first-touch). Fired by the 7am launchd job (com.thinkbigjoe.outreach7am) which
 * curls this with CRON_SECRET. Sends the branded template (reply-to Joe) to each eligible site,
 * marks it sent, logs forge_outreach_sent.
 *
 * Guards: master kill-switch (outreach_engine.enabled), daily_goal cap, only sites with a real
 * email + claim code + not already contacted. Idempotent. `?dry=1` composes without sending —
 * used to preview exactly who/what goes out.
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === expected;
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";

  // ?sampleTo=addr — send ONE fully-rendered outreach email (first eligible site's data) to a
  // chosen address so you can preview exactly what a business receives. Marks nothing as sent.
  const sampleTo = url.searchParams.get("sampleTo");
  if (sampleTo && /.+@.+\..+/.test(sampleTo)) {
    const [s] = await db
      .select({ businessName: forgeSites.businessName, claimCode: forgeSites.claimCode, liveUrl: forgeSites.liveUrl, city: forgeSites.city, ownerName: forgeSites.ownerName, googleRating: forgeSites.googleRating, reviewCount: forgeSites.reviewCount })
      .from(forgeSites)
      .where(and(eq(forgeSites.status, "built"), isNotNull(forgeSites.marketingApprovedAt), isNotNull(forgeSites.email), isNotNull(forgeSites.claimCode), isNotNull(forgeSites.liveUrl)))
      .orderBy(forgeSites.businessName).limit(1);
    if (!s) return NextResponse.json({ ok: false, error: "no eligible site to sample" });
    const { subject, body } = composeOutreach(s);
    const r = await sendForgeOutreachEmail({ to: sampleTo, subject: `[SAMPLE] ${subject}`, body, businessName: s.businessName, liveUrl: s.liveUrl, claimCode: s.claimCode! });
    return NextResponse.json({ ok: !("error" in r), sample: true, to: sampleTo, using: s.businessName });
  }

  const cfg = await db.select().from(outreachEngine).where(eq(outreachEngine.id, 1)).limit(1).then((r) => r[0]);
  if (!dry && cfg && cfg.enabled === false) {
    return NextResponse.json({ ok: true, skipped: "outreach engine is OFF (outreach_engine.enabled=false)", sent: 0 });
  }
  const dailyGoal = cfg?.dailyGoal ?? 15;

  // Eligible: built, marketing-approved, has email + claim code, not already contacted, not claimed.
  const eligible = await db
    .select({
      id: forgeSites.id, businessName: forgeSites.businessName, email: forgeSites.email,
      claimCode: forgeSites.claimCode, liveUrl: forgeSites.liveUrl, city: forgeSites.city,
      ownerName: forgeSites.ownerName, googleRating: forgeSites.googleRating, reviewCount: forgeSites.reviewCount,
    })
    .from(forgeSites)
    .where(and(
      eq(forgeSites.status, "built"),
      isNotNull(forgeSites.marketingApprovedAt),
      isNotNull(forgeSites.email),
      isNotNull(forgeSites.claimCode),
      isNotNull(forgeSites.liveUrl),
      sql`(outreach_status IS NULL OR outreach_status = 'none' OR outreach_status = '')`,
      sql`claimed_by_user_id IS NULL`,
    ))
    .orderBy(forgeSites.businessName);

  // Respect the daily send cap (count today's sends already logged).
  const sentToday = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activityLog)
    .where(sql`event_type = 'forge_outreach_sent' AND created_at >= date_trunc('day', now())`)
    .then((r) => r[0]?.n ?? 0);
  const room = Math.max(0, dailyGoal - sentToday);
  const batch = eligible.slice(0, room);

  const results: { businessName: string; email: string; subject: string; ok?: boolean; error?: string }[] = [];
  for (const s of batch) {
    const { subject, body } = composeOutreach(s);
    if (dry) { results.push({ businessName: s.businessName, email: s.email!, subject }); continue; }
    try {
      const r = await sendForgeOutreachEmail({
        to: s.email!, subject, body, businessName: s.businessName, liveUrl: s.liveUrl, claimCode: s.claimCode!,
      });
      const ok = !("error" in r);
      if (ok) {
        await db.update(forgeSites).set({ outreachStatus: "sent", updatedAt: sql`now()` }).where(eq(forgeSites.id, s.id));
        await db.insert(activityLog).values({
          actor: "joe", eventType: "forge_outreach_sent",
          summary: `Sent owner outreach — ${s.businessName} (${s.email})`,
          metadata: { auto: true, detail: { siteId: s.id, channel: "email" } },
        });
      }
      results.push({ businessName: s.businessName, email: s.email!, subject, ok });
    } catch (err) {
      results.push({ businessName: s.businessName, email: s.email!, subject, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const skippedNoContact = eligible.length === 0
    ? "no eligible sites (need built + approved + email + claim code + not yet contacted)"
    : undefined;
  return NextResponse.json({
    ok: true, dry, dailyGoal, sentToday, eligible: eligible.length,
    attempted: batch.length, sent: dry ? 0 : results.filter((r) => r.ok).length,
    results, skippedNoContact,
  });
}
