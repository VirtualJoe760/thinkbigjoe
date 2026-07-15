import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { db, forgeSites, newsletters } from "@/db";
import { draftNewsletter, monthLabel } from "@/lib/newsletter";
import { enqueueNewsletter } from "@/lib/newsletter-queue";
import { sendNotificationEmail } from "@/lib/email";
import { notifyTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Monthly customer-newsletter engine (the $99 plan). Runs on a cron (~hourly) and gates on the
 * Pacific calendar so every client's newsletter behaves the same regardless of the business's own
 * time zone:
 *   • Before the 15th @ noon PT → GENERATE: draft this month's newsletter for each eligible client
 *     that doesn't have one yet, and email them to review it in the portal.
 *   • On/after the 15th @ noon PT → SEND: auto-send this month's draft (unless the client paused it
 *     by setting status='cancelled', or already sent early). Missing drafts are generated then sent.
 * Idempotent: never re-generates an existing period, never re-sends a 'sent' one. Only touches paying,
 * claimed clients that have at least one subscribed contact. Auth: Bearer CRON_SECRET.
 * `?force=generate|send` overrides the date gate (manual kickoff / testing).
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") === expected;
}

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";
const SEND_DAY = 15;
const SEND_HOUR = 12; // noon Pacific

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const force = new URL(req.url).searchParams.get("force"); // 'generate' | 'send'
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false })
      .formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  const period = `${p.year}-${p.month}`;
  const label = monthLabel(period);
  const ptDay = Number(p.day), ptHour = Number(p.hour) % 24;
  const doSend = force === "send" || (force !== "generate" && (ptDay > SEND_DAY || (ptDay === SEND_DAY && ptHour >= SEND_HOUR)));

  // Eligible: paying + claimed client with at least one subscribed contact.
  const clients = (
    await db.execute(sql`
      SELECT fs.id, fs.business_name AS "businessName", fs.niche, fs.city, fs.service_area AS "serviceArea",
             fs.phone, fs.live_url AS "liveUrl", fs.slug, u.email AS "clientEmail",
             (SELECT count(*) FROM newsletter_contacts nc WHERE nc.site_id = fs.id AND nc.status = 'subscribed')::int AS subs
      FROM forge_sites fs
      LEFT JOIN better_auth."user" u ON u.id = fs.claimed_by_user_id
      WHERE fs.claimed_by_user_id IS NOT NULL
        AND (fs.one_time_paid = true OR fs.subscription_status IN ('active','trialing'))
        AND fs.status <> 'deleted'`)
  ).rows as Array<{
    id: number; businessName: string; niche: string | null; city: string | null; serviceArea: string | null;
    phone: string | null; liveUrl: string | null; slug: string | null; clientEmail: string | null; subs: number;
  }>;

  let generated = 0, sent = 0, notified = 0;
  for (const c of clients) {
    if (c.subs === 0) continue; // no subscriber list yet — nothing to send
    const biz = { id: c.id, businessName: c.businessName, niche: c.niche, city: c.city, serviceArea: c.serviceArea, phone: c.phone, liveUrl: c.liveUrl, slug: c.slug };
    const [nl] = await db.select({ id: newsletters.id, status: newsletters.status })
      .from(newsletters).where(and(eq(newsletters.siteId, c.id), eq(newsletters.period, period))).limit(1);

    if (!doSend) {
      // Generation window — make sure a reviewable draft exists, then nudge the client once.
      if (nl) continue;
      const d = await draftNewsletter(biz, label);
      if (!d) continue;
      await db.insert(newsletters).values({ siteId: c.id, period, subject: d.subject, bodyHtml: d.html, status: "draft" });
      generated++;
      if (c.clientEmail) {
        await sendNotificationEmail({
          to: c.clientEmail,
          subject: `Your ${label} newsletter is ready to review`,
          heading: `${label} newsletter drafted`,
          message: `We drafted this month's newsletter for ${c.businessName}. Review or edit it in your portal — it sends automatically on the 15th at noon Pacific unless you pause it.`,
          ctaUrl: `${SITE}/portal/newsletter`,
          ctaLabel: "Review your newsletter",
        }).then(() => { notified++; }).catch(() => {});
      }
    } else {
      // Send window — send this month's draft (generate if missing); skip sent/cancelled.
      let id: number | null = null;
      if (!nl) {
        const d = await draftNewsletter(biz, label);
        if (d) {
          const [ins] = await db.insert(newsletters).values({ siteId: c.id, period, subject: d.subject, bodyHtml: d.html, status: "draft" }).returning({ id: newsletters.id });
          id = ins?.id ?? null;
        }
      } else if (nl.status === "draft") {
        id = nl.id;
      }
      if (id) {
        // Queue it; the send-batch tick drains it (paced). Counts newsletters queued this run.
        const r = await enqueueNewsletter(id);
        if (r.ok) sent++;
      }
    }
  }

  await notifyTelegram(
    `📰 Newsletter cron (${period}, PT ${p.month}/${p.day} ${ptHour}h): ${doSend ? `sent ${sent}` : `drafted ${generated}, nudged ${notified}`} · ${clients.length} client(s).`,
  ).catch(() => {});

  return NextResponse.json({ ok: true, period, window: doSend ? "send" : "generate", generated, sent, notified, clients: clients.length });
}
