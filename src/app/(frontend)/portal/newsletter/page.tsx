import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { and, desc, eq, ne } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db, forgeSites, newsletters, newsletterContacts } from "@/db";
import { monthKey, monthLabel } from "@/lib/newsletter";
import { NewsletterClient, type NewsletterView } from "./newsletter-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Newsletter", robots: { index: false, follow: false } };

export default async function NewsletterPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/newsletter");
  const { user } = session;

  // The client's claimed business (first non-deleted claimed site).
  const [site] = await db
    .select({ id: forgeSites.id, businessName: forgeSites.businessName })
    .from(forgeSites)
    .where(and(eq(forgeSites.claimedByUserId, user.id), ne(forgeSites.status, "deleted")))
    .orderBy(desc(forgeSites.claimedAt))
    .limit(1);

  if (!site) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-extrabold tracking-tight">Monthly Newsletter</h1>
        <p className="mt-3 rounded-2xl border border-line bg-surface p-6 text-sm text-ink-soft">
          Claim your website first — then you can send your customers a branded monthly newsletter to stay top of mind.
        </p>
      </div>
    );
  }

  const contacts = await db
    .select({ id: newsletterContacts.id, email: newsletterContacts.email, name: newsletterContacts.name, status: newsletterContacts.status })
    .from(newsletterContacts)
    .where(eq(newsletterContacts.siteId, site.id))
    .orderBy(desc(newsletterContacts.createdAt))
    .limit(500);
  const subscribed = contacts.filter((c) => c.status === "subscribed").length;

  const key = monthKey();
  const [current] = await db
    .select({ id: newsletters.id, subject: newsletters.subject, bodyHtml: newsletters.bodyHtml, status: newsletters.status })
    .from(newsletters)
    .where(and(eq(newsletters.siteId, site.id), eq(newsletters.period, key)))
    .limit(1);

  const history = await db
    .select({ id: newsletters.id, period: newsletters.period, subject: newsletters.subject, sentAt: newsletters.sentAt, recipientCount: newsletters.recipientCount, status: newsletters.status })
    .from(newsletters)
    .where(and(eq(newsletters.siteId, site.id), eq(newsletters.status, "sent")))
    .orderBy(desc(newsletters.sentAt))
    .limit(12);

  const view: NewsletterView = {
    siteId: site.id,
    businessName: site.businessName,
    monthLabel: monthLabel(key),
    subscribed,
    totalContacts: contacts.length,
    contacts: contacts.slice(0, 100),
    current: current ? { id: current.id, subject: current.subject, bodyHtml: current.bodyHtml, status: current.status } : null,
    history: history.map((h) => ({ id: h.id, label: monthLabel(h.period), subject: h.subject, sentAt: h.sentAt, recipients: h.recipientCount })),
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <NewsletterClient view={view} />
    </div>
  );
}
