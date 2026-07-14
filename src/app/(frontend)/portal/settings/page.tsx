import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, ne } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { PortalHeader } from "@/components/portal/portal-header";
import { getConnection } from "@/lib/google-oauth";
import { ensureOwnerContact } from "@/lib/contacts";
import { DEFAULT_GROUP } from "@/lib/contact-sync";
import { disconnectGoogleAction } from "./actions";
import { ContactForm } from "./contact-form";
import { SyncContactsCard } from "./sync-contacts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings", robots: { index: false, follow: false } };

/**
 * Settings — where the customer grants Google access.
 *
 * Each permission is asked for SEPARATELY (`?feature=calendar` / `?feature=contacts`), in the place
 * where the feature it powers is explained. That's deliberate: Google's verification reviewers want
 * the narrowest scope requested in context, and a small business is far likelier to grant "see your
 * calendar events" next to a sentence about bookings than to accept one wall of permissions up front.
 * Grants are incremental, so connecting the second one keeps the first.
 */
export default async function PortalSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const { user } = session;
  const { google } = await searchParams;

  const [site] = await db
    .select({ id: forgeSites.id, businessName: forgeSites.businessName })
    .from(forgeSites)
    .where(and(eq(forgeSites.claimedByUserId, user.id), ne(forgeSites.status, "deleted")))
    .orderBy(desc(forgeSites.claimedAt))
    .limit(1);

  const conn = await getConnection(user.id);
  const siteParam = site ? `&siteId=${site.id}` : "";

  // Prepopulate contact details from the site's scraped data the first time they land here after
  // claiming, then let them review/correct it.
  const contact = site ? await ensureOwnerContact(site.id, user.id) : null;
  const contactValues = {
    businessName: contact?.businessName ?? "",
    name: contact?.name ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    address: contact?.address ?? "",
  };
  // "From scrape" = we haven't been told otherwise (no manual edit / enrichment yet).
  const prefilledFromScrape = contact?.source === "scrape" || contact?.source === "enrichment";

  const cards = [
    {
      key: "calendar" as const,
      title: "Google Calendar",
      connected: Boolean(conn?.calendarConnected),
      what: "Appointments booked on your website or by your AI receptionist are written straight onto your Google Calendar, and your schedule shows up in your portal.",
      permission: "We ask to see and edit events on your calendars — nothing else. We never read the contents of your personal events.",
      icon: "M8 2v4M16 2v4M3 9h18M5 5h14v16H5z",
    },
    {
      key: "contacts" as const,
      title: "Google Contacts",
      connected: Boolean(conn?.contactsConnected),
      what: "Import your existing contacts into your newsletter list — and every new customer who books gets saved to your contacts under “Website Leads”, so you can call them straight from your phone.",
      permission: "We ask to see your contacts (to import them) and to add contacts (to save new customers who book).",
      icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4z",
    },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <PortalHeader email={user.email} isAdmin={isAdminEmail(user.email)} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="text-3xl font-extrabold tracking-tight">Settings</h1>
        <p className="mt-2 leading-relaxed text-ink-soft">
          Connect the tools your website uses. You can disconnect at any time.
        </p>

        {google === "connected" && (
          <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            ✓ Google connected{conn?.googleEmail ? ` as ${conn.googleEmail}` : ""}.
          </p>
        )}
        {google === "error" && (
          <p className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            That didn&apos;t connect. Please try again.
          </p>
        )}
        {google === "unconfigured" && (
          <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            Google isn&apos;t configured yet — we&apos;re on it.
          </p>
        )}

        {site && (
          <div className="mt-8">
            <ContactForm values={contactValues} prefilledFromScrape={prefilledFromScrape} />
          </div>
        )}

        <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-ink-soft">Google</h2>

        <div className="mt-4 space-y-4">
          {cards.map((c) => (
            <section key={c.key} className="rounded-2xl border border-line bg-surface p-6">
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-tint/60 text-brand">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d={c.icon} />
                  </svg>
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold tracking-tight">{c.title}</h3>
                    {c.connected ? (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">Connected</span>
                    ) : (
                      <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold text-ink-soft">Not connected</span>
                    )}
                  </div>

                  <p className="mt-2 leading-relaxed text-ink-soft">{c.what}</p>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    <span className="font-semibold text-ink">What we ask for:</span> {c.permission}
                  </p>

                  <div className="mt-4">
                    {c.connected ? (
                      <p className="text-sm text-ink-soft">
                        Connected{conn?.googleEmail ? ` as ${conn.googleEmail}` : ""}.
                      </p>
                    ) : (
                      <Link
                        href={`/api/google/connect?feature=${c.key}${siteParam}`}
                        className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
                      >
                        Connect {c.title}
                      </Link>
                    )}
                  </div>

                  {c.key === "contacts" && (
                    <p className="mt-3 text-xs text-ink-soft">
                      Don&apos;t want to connect Google?{" "}
                      <Link href="/portal/newsletter" className="font-semibold text-brand hover:underline">
                        Upload a CSV instead
                      </Link>{" "}
                      — your newsletter list works either way.
                    </p>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* Admin-only: sync the TBJ CRM (engaged contacts) into Joe's Google Contacts. This is the
            company-contacts sync, distinct from the per-booking Website Leads write; a client's own
            customer sync is a separate future feature. */}
        {isAdminEmail(user.email) && (
          <div className="mt-4">
            <SyncContactsCard group={DEFAULT_GROUP} connected={Boolean(conn?.contactsConnected)} />
          </div>
        )}

        {conn && (
          <form action={disconnectGoogleAction} className="mt-6">
            <button
              type="submit"
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-surface"
            >
              Disconnect Google account
            </button>
            <p className="mt-2 text-xs text-ink-soft">
              Removes both permissions and deletes the tokens we stored. You can also revoke access from your{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-brand hover:underline"
              >
                Google account
              </a>
              .
            </p>
          </form>
        )}

        <p className="mt-10 border-t border-line pt-6 text-sm leading-relaxed text-ink-soft">
          We only use this access to run the features above. We never sell your data or use it for advertising —
          see our{" "}
          <Link href="/privacy-policy" className="font-semibold text-brand hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
