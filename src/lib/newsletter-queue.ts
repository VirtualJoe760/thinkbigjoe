/**
 * Paced newsletter sender — the resumable replacement for the synchronous for-loop in
 * `sendNewsletter`. That loop ran inside a request and times out on serverless past a few hundred
 * recipients; this splits the work into a queue (`newsletter_sends`, one row per recipient) drained
 * by a background tick that sends a bounded batch each run. See docs/EMAIL_SCALE.md.
 *
 * Enqueue (in the request) → send batches (launchd tick → /api/newsletter/send-batch) → each
 * recipient marked sent/failed/suppressed. A crash just leaves rows `queued`; the next tick resumes.
 */
import { and, eq, sql } from "drizzle-orm";

import { db, newsletters, newsletterContacts, newsletterSends, forgeSites } from "@/db";
import { sendNewsletterViaSes } from "@/lib/email";
import { renderNewsletter, type NewsletterBiz } from "@/lib/newsletter";
import { suppress, suppressedSet } from "@/lib/suppressions";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com").replace(/\/+$/, "");

/**
 * Queue every subscribed contact for a newsletter and flip it to `sending`. Idempotent per
 * (newsletter, email). Suppressed addresses are queued as `suppressed` up front, so they're
 * auditable but never sent. Returns how many are actually sendable.
 */
export async function enqueueNewsletter(newsletterId: number): Promise<{ ok: boolean; queued: number; message?: string }> {
  const [nl] = await db.select().from(newsletters).where(eq(newsletters.id, newsletterId)).limit(1);
  if (!nl) return { ok: false, queued: 0, message: "Newsletter not found." };
  if (nl.status === "sent") return { ok: false, queued: 0, message: "This newsletter was already sent." };
  if (!nl.subject.trim() || !nl.bodyHtml.trim()) return { ok: false, queued: 0, message: "Add a subject and body before sending." };

  const contacts = await db
    .select({ email: newsletterContacts.email, name: newsletterContacts.name })
    .from(newsletterContacts)
    .where(and(eq(newsletterContacts.siteId, nl.siteId), eq(newsletterContacts.status, "subscribed")));
  if (contacts.length === 0) return { ok: false, queued: 0, message: "No subscribers on the list yet." };

  const suppressed = await suppressedSet(contacts.map((c) => c.email));

  const rows = contacts.map((c) => ({
    newsletterId,
    siteId: nl.siteId,
    email: c.email,
    name: c.name,
    status: suppressed.has(c.email.trim().toLowerCase()) ? "suppressed" : "queued",
  }));
  // De-dupe against a prior enqueue of the same newsletter.
  await db.insert(newsletterSends).values(rows).onConflictDoNothing();

  const sendable = rows.filter((r) => r.status === "queued").length;
  await db
    .update(newsletters)
    .set({ status: "sending", updatedAt: new Date().toISOString() })
    .where(eq(newsletters.id, newsletterId));

  return { ok: true, queued: sendable };
}

type QueuedRow = {
  id: number;
  newsletterId: number;
  siteId: number;
  email: string;
  subject: string;
  bodyHtml: string;
};

const bizCache = new Map<number, NewsletterBiz | null>();
async function bizForSite(siteId: number): Promise<NewsletterBiz | null> {
  if (bizCache.has(siteId)) return bizCache.get(siteId)!;
  const [biz] = await db
    .select({
      id: forgeSites.id, businessName: forgeSites.businessName, niche: forgeSites.niche,
      city: forgeSites.city, serviceArea: forgeSites.serviceArea, phone: forgeSites.phone,
      liveUrl: forgeSites.liveUrl, slug: forgeSites.slug,
    })
    .from(forgeSites).where(eq(forgeSites.id, siteId)).limit(1);
  bizCache.set(siteId, biz ?? null);
  return biz ?? null;
}

/**
 * Send up to `limit` queued recipients. Called each tick. Sends via SES, records the Message-ID (so
 * an SNS bounce can be matched back), and on a hard bounce/complaint the SNS webhook — not this —
 * writes the suppression. This function only suppresses proactively (an address suppressed since
 * enqueue). Marks a newsletter `sent` once its queue drains.
 */
export async function sendNewsletterBatch(limit = 40): Promise<{ processed: number; sent: number; failed: number; suppressed: number }> {
  const rows = (
    await db.execute(sql`
      SELECT ns.id, ns.newsletter_id AS "newsletterId", ns.site_id AS "siteId", ns.email,
             n.subject, n.body_html AS "bodyHtml"
      FROM newsletter_sends ns
      JOIN newsletters n ON n.id = ns.newsletter_id
      WHERE ns.status = 'queued' AND n.status = 'sending'
      ORDER BY ns.created_at ASC
      LIMIT ${limit}`)
  ).rows as QueuedRow[];

  let sent = 0, failed = 0, suppressed = 0;
  const touchedNewsletters = new Set<number>();

  // Re-check suppression for the whole batch (an address may have bounced from an earlier send).
  const supSet = await suppressedSet(rows.map((r) => r.email));

  for (const r of rows) {
    touchedNewsletters.add(r.newsletterId);
    const mark = (patch: Record<string, unknown>) =>
      db.update(newsletterSends)
        .set({ ...patch, attempts: sql`attempts + 1`, updatedAt: new Date().toISOString() })
        .where(eq(newsletterSends.id, r.id));

    if (supSet.has(r.email.trim().toLowerCase())) {
      await mark({ status: "suppressed" });
      suppressed++;
      continue;
    }

    const biz = await bizForSite(r.siteId);
    if (!biz) { await mark({ status: "failed", error: "business not found" }); failed++; continue; }

    // The contact's own unsubscribe token (per site + email).
    const [contact] = await db
      .select({ token: newsletterContacts.unsubscribeToken })
      .from(newsletterContacts)
      .where(and(eq(newsletterContacts.siteId, r.siteId), sql`lower(email) = ${r.email.trim().toLowerCase()}`))
      .limit(1);
    const unsubscribeUrl = `${SITE}/api/newsletter/unsubscribe?t=${contact?.token ?? ""}`;
    const html = renderNewsletter(biz, r.bodyHtml, unsubscribeUrl);

    const res = await sendNewsletterViaSes({ to: r.email, subject: r.subject, html, fromName: biz.businessName, unsubscribeUrl });
    if (res.ok) {
      await mark({ status: "sent", messageId: res.messageId ?? null, sentAt: new Date().toISOString(), error: null });
      sent++;
    } else {
      // A permanent rejection at send time (bad address) → suppress proactively too.
      if (/550|5\.1\.1|no such user|does not exist|invalid recipient/i.test(res.error)) {
        await suppress(r.email, "bounce", `send-time: ${res.error.slice(0, 200)}`);
        await mark({ status: "bounced", error: res.error.slice(0, 300) });
      } else {
        await mark({ status: "failed", error: res.error.slice(0, 300) });
      }
      failed++;
    }
  }

  // Finalize any newsletter whose queue is now empty.
  for (const nid of touchedNewsletters) {
    const [{ remaining }] = (
      await db.execute(sql`SELECT count(*)::int AS remaining FROM newsletter_sends WHERE newsletter_id = ${nid} AND status = 'queued'`)
    ).rows as Array<{ remaining: number }>;
    if (remaining === 0) {
      const [{ delivered }] = (
        await db.execute(sql`SELECT count(*)::int AS delivered FROM newsletter_sends WHERE newsletter_id = ${nid} AND status = 'sent'`)
      ).rows as Array<{ delivered: number }>;
      await db.update(newsletters)
        .set({ status: "sent", sentAt: new Date().toISOString(), recipientCount: delivered, updatedAt: new Date().toISOString() })
        .where(eq(newsletters.id, nid));
    }
  }

  bizCache.clear();
  return { processed: rows.length, sent, failed, suppressed };
}
