"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db, forgeSites, newsletters, newsletterContacts } from "@/db";
import { draftNewsletter, sendNewsletter, monthKey, monthLabel, newsletterToken, type NewsletterBiz } from "@/lib/newsletter";
import { getConnection, getValidAccessToken, listGoogleContacts } from "@/lib/google-oauth";

/** Resolve the caller's claimed business (site). Every action is scoped to it. */
async function requireOwnedSite(siteId: number): Promise<NewsletterBiz> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Not signed in.");
  const [site] = await db
    .select({
      id: forgeSites.id, businessName: forgeSites.businessName, niche: forgeSites.niche,
      city: forgeSites.city, serviceArea: forgeSites.serviceArea, phone: forgeSites.phone,
      liveUrl: forgeSites.liveUrl, slug: forgeSites.slug, claimedByUserId: forgeSites.claimedByUserId,
    })
    .from(forgeSites).where(eq(forgeSites.id, siteId)).limit(1);
  if (!site || site.claimedByUserId !== session.user.id) throw new Error("Not your site.");
  return site;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Import a pasted/uploaded customer list (CSV or newline list of "email, name"). */
export async function uploadContacts(siteId: number, raw: string): Promise<{ ok: boolean; added: number; skipped: number; message?: string }> {
  await requireOwnedSite(siteId);
  const rows = (raw || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let added = 0, skipped = 0;
  for (const line of rows) {
    // split on comma/tab/semicolon; find the field that looks like an email
    const parts = line.split(/[,;\t]/).map((p) => p.trim().replace(/^["']|["']$/g, ""));
    const email = (parts.find((p) => EMAIL_RE.test(p)) || "").toLowerCase();
    if (!email) { skipped++; continue; }
    const name = parts.filter((p) => p && p.toLowerCase() !== email).slice(0, 1)[0] || null;
    if (/^(email|e-mail|address)$/i.test(name || "")) continue; // header row
    try {
      const res = await db
        .insert(newsletterContacts)
        .values({ siteId, email, name, unsubscribeToken: newsletterToken() })
        .onConflictDoNothing({ target: [newsletterContacts.siteId, newsletterContacts.email] })
        .returning({ id: newsletterContacts.id });
      if (res.length) added++; else skipped++;
    } catch { skipped++; }
  }
  revalidatePath("/portal/newsletter");
  return { ok: true, added, skipped, message: `Added ${added} contact${added === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}.` };
}

/** Pull the client's Google Contacts (People API) into their newsletter list — needs Google connected. */
export async function syncGoogleContacts(siteId: number): Promise<{ ok: boolean; added: number; message?: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, added: 0, message: "Please sign in." };
  await requireOwnedSite(siteId);
  const conn = await getConnection(session.user.id);
  if (!conn?.contactsConnected) return { ok: false, added: 0, message: "Connect your Google account on the Calendar page first." };
  const token = await getValidAccessToken(conn);
  if (!token) return { ok: false, added: 0, message: "Google connection expired — reconnect on the Calendar page." };

  const contacts = (await listGoogleContacts(token)).filter((c) => c.email && EMAIL_RE.test(c.email));
  let added = 0;
  for (const c of contacts) {
    try {
      const res = await db
        .insert(newsletterContacts)
        .values({ siteId, email: c.email!.toLowerCase(), name: c.name || null, unsubscribeToken: newsletterToken() })
        .onConflictDoNothing({ target: [newsletterContacts.siteId, newsletterContacts.email] })
        .returning({ id: newsletterContacts.id });
      if (res.length) added++;
    } catch { /* skip bad row */ }
  }
  revalidatePath("/portal/newsletter");
  return { ok: true, added, message: `Synced ${added} contact${added === 1 ? "" : "s"} from Google.` };
}

/** Remove a contact from the list. */
export async function removeContact(siteId: number, contactId: number): Promise<{ ok: boolean }> {
  await requireOwnedSite(siteId);
  await db.delete(newsletterContacts).where(and(eq(newsletterContacts.id, contactId), eq(newsletterContacts.siteId, siteId)));
  revalidatePath("/portal/newsletter");
  return { ok: true };
}

/** Generate (or regenerate) this month's AI draft. Upserts the current-period newsletter row. */
export async function generateDraft(siteId: number): Promise<{ ok: boolean; message?: string }> {
  const biz = await requireOwnedSite(siteId);
  const key = monthKey();
  const draft = await draftNewsletter(biz, monthLabel(key));
  if (!draft) return { ok: false, message: "Couldn't draft right now — try again in a moment." };

  const [existing] = await db.select({ id: newsletters.id, status: newsletters.status })
    .from(newsletters).where(and(eq(newsletters.siteId, siteId), eq(newsletters.period, key))).limit(1);
  if (existing) {
    if (existing.status === "sent") return { ok: false, message: "This month's newsletter already went out." };
    await db.update(newsletters).set({ subject: draft.subject, bodyHtml: draft.html, status: "draft", updatedAt: new Date().toISOString() }).where(eq(newsletters.id, existing.id));
  } else {
    await db.insert(newsletters).values({ siteId, period: key, subject: draft.subject, bodyHtml: draft.html, status: "draft" });
  }
  revalidatePath("/portal/newsletter");
  return { ok: true };
}

/**
 * Pause (or resume) this month's auto-send. Paused = status 'cancelled' → the monthly cron skips it;
 * resuming puts it back to 'draft' so it auto-sends on the 15th again. Only affects the current month.
 */
export async function setNewsletterPaused(siteId: number, newsletterId: number, paused: boolean): Promise<{ ok: boolean; message?: string }> {
  await requireOwnedSite(siteId);
  const [nl] = await db.select({ status: newsletters.status }).from(newsletters)
    .where(and(eq(newsletters.id, newsletterId), eq(newsletters.siteId, siteId))).limit(1);
  if (!nl) return { ok: false, message: "Newsletter not found." };
  if (nl.status === "sent") return { ok: false, message: "This month's newsletter already went out." };
  await db.update(newsletters)
    .set({ status: paused ? "cancelled" : "draft", updatedAt: new Date().toISOString() })
    .where(and(eq(newsletters.id, newsletterId), eq(newsletters.siteId, siteId)));
  revalidatePath("/portal/newsletter");
  return { ok: true, message: paused ? "Paused — this month's newsletter won't auto-send." : "Resumed — it'll auto-send on the 15th." };
}

/** Save the client's edits to a draft. */
export async function saveDraft(siteId: number, newsletterId: number, subject: string, bodyHtml: string): Promise<{ ok: boolean }> {
  await requireOwnedSite(siteId);
  await db.update(newsletters)
    .set({ subject: subject.slice(0, 200), bodyHtml, updatedAt: new Date().toISOString() })
    .where(and(eq(newsletters.id, newsletterId), eq(newsletters.siteId, siteId)));
  revalidatePath("/portal/newsletter");
  return { ok: true };
}

/** Approve + send this newsletter to the whole subscribed list. */
export async function approveAndSend(siteId: number, newsletterId: number, subject: string, bodyHtml: string): Promise<{ ok: boolean; sent?: number; message?: string }> {
  await requireOwnedSite(siteId);
  await saveDraft(siteId, newsletterId, subject, bodyHtml);
  const r = await sendNewsletter(newsletterId);
  revalidatePath("/portal/newsletter");
  return r.ok ? { ok: true, sent: r.sent, message: `Sent to ${r.sent} customer${r.sent === 1 ? "" : "s"}. 🎉` } : { ok: false, message: r.message };
}
