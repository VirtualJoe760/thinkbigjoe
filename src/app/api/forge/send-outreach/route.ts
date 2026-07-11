import { NextResponse } from "next/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db, forgeSites, activityLog, outreachEngine } from "@/db";
import { sendForgeOutreachEmail } from "@/lib/email";
import { composeOutreach } from "@/lib/forge-outreach";
import { notifyTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Owner-outreach for BUILT + marketing-approved sites (the "your new site is live — claim it"
 * first-touch). Fired FREQUENTLY (every ~20 min, weekday business hours) by launchd, NOT once at a
 * cron time: each run DRIPS out a small jittered number of emails so outreach trickles like a human
 * instead of blasting — better deliverability + looks like real use. Sends the branded template
 * (reply-to the monitored mailbox), marks sent, logs forge_outreach_sent.
 *
 * Guards: master kill-switch (outreach_engine.enabled), daily_goal cap, weekday 9am–6pm PT window,
 * a minimum gap between sends, and only sites with a real email + claim code + not already contacted.
 * Idempotent. `?dry=1` composes without sending (and bypasses pacing) to preview who/what goes out.
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

  // Drip pacing: instead of blasting the whole day's allowance at cron time, send a SMALL, jittered
  // number per invocation so outreach trickles out like a human. The launchd job fires every ~20 min;
  // gated to weekday business hours (Pacific) with a minimum gap between sends. `dry` previews the full
  // eligible list (no pacing). Same model will drive the paced GV texting.
  let perRun = room;
  if (!dry) {
    const pt = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const hour = pt.getHours(), dow = pt.getDay();
    if (!(dow >= 1 && dow <= 5 && hour >= 9 && hour < 18)) {
      return NextResponse.json({ ok: true, skipped: "outside sending window (Mon–Fri 9am–6pm PT)", sent: 0, sentToday, dailyGoal });
    }
    const lastAt = await db
      .select({ at: sql<string | null>`max(created_at)` })
      .from(activityLog)
      .where(sql`event_type = 'forge_outreach_sent'`)
      .then((r) => r[0]?.at ?? null);
    const sinceMin = lastAt ? (Date.now() - new Date(lastAt).getTime()) / 60000 : Infinity;
    const MIN_GAP_MIN = 8; // never two sends closer than this, even on adjacent runs
    const jitter = [0, 1, 1, 1, 2][Math.floor(Math.random() * 5)]; // mostly 1, sometimes 0 or 2
    perRun = sinceMin < MIN_GAP_MIN ? 0 : Math.min(jitter, room);
  }
  const batch = eligible.slice(0, perRun);

  const results: { businessName: string; email: string; subject: string; ok?: boolean; error?: string; bounced?: boolean }[] = [];
  // A permanent SMTP rejection (5xx / rejected recipient) means the address is dead — retire it and
  // record a bounce (NOT "sent"), exactly like the inbox poller. So we never mark a lead contacted
  // when delivery failed. Async bounces (accepted-then-DSN) still need the IMAP poller.
  const markSyncBounce = async (siteId: number, addr: string) => {
    await db.update(forgeSites).set({
      outreachStatus: "bounced", email: null, contactEnrichedAt: null,
      contactNotes: sql`coalesce(contact_notes || E'\n', '') || ${`⚠️ Email rejected at send ${new Date().toISOString().slice(0, 10)}: ${addr} — dead address, find a new email or a social.`}`,
      updatedAt: sql`now()`,
    }).where(eq(forgeSites.id, siteId));
    await db.insert(activityLog).values({
      actor: "system", eventType: "email_bounced",
      summary: `Bounced at send — ${addr} (address retired · handed to research)`,
      metadata: { detail: { siteId, address: addr, sync: true } },
    });
  };
  const isPermanentReject = (err: unknown) => {
    const e = err as { responseCode?: number; code?: string; rejected?: unknown[] };
    return (typeof e?.responseCode === "number" && e.responseCode >= 500) ||
      e?.code === "EENVELOPE" || (Array.isArray(e?.rejected) && e.rejected.length > 0);
  };

  for (const s of batch) {
    const { subject, body } = composeOutreach(s);
    if (dry) { results.push({ businessName: s.businessName, email: s.email!, subject }); continue; }
    try {
      const r = await sendForgeOutreachEmail({
        to: s.email!, subject, body, businessName: s.businessName, liveUrl: s.liveUrl, claimCode: s.claimCode!,
      });
      const info = ("data" in r ? r.data : null) as { accepted?: unknown[]; rejected?: unknown[] } | null;
      const rejected = !!info && Array.isArray(info.rejected) && info.rejected.length > 0 &&
        !(Array.isArray(info.accepted) && info.accepted.length > 0);
      if (rejected) {
        await markSyncBounce(s.id, s.email!);
        results.push({ businessName: s.businessName, email: s.email!, subject, ok: false, bounced: true });
      } else if (!("error" in r)) {
        await db.update(forgeSites).set({ outreachStatus: "sent", updatedAt: sql`now()` }).where(eq(forgeSites.id, s.id));
        await db.insert(activityLog).values({
          actor: "joe", eventType: "forge_outreach_sent",
          summary: `Sent owner outreach — ${s.businessName} (${s.email})`,
          metadata: { auto: true, detail: { siteId: s.id, channel: "email" } },
        });
        await notifyTelegram(`📧 Emailed ${s.businessName} (${s.email}) — "${subject}"`);
        results.push({ businessName: s.businessName, email: s.email!, subject, ok: true });
      } else {
        results.push({ businessName: s.businessName, email: s.email!, subject, ok: false });
      }
    } catch (err) {
      if (isPermanentReject(err)) {
        await markSyncBounce(s.id, s.email!).catch(() => {});
        results.push({ businessName: s.businessName, email: s.email!, subject, ok: false, bounced: true });
      } else {
        results.push({ businessName: s.businessName, email: s.email!, subject, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const skippedNoContact = eligible.length === 0
    ? "no eligible sites (need built + approved + email + claim code + not yet contacted)"
    : undefined;
  return NextResponse.json({
    ok: true, dry, dailyGoal, sentToday, eligible: eligible.length, perRun,
    attempted: batch.length, sent: dry ? 0 : results.filter((r) => r.ok).length,
    results, skippedNoContact,
  });
}
