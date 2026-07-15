import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { and, desc, eq, ne } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db, forgeSites } from "@/db";
import { getConnection, getValidAccessToken, listCalendarEvents, isGoogleOAuthConfigured } from "@/lib/google-oauth";
import { type CalEvent } from "../../command/appointments/appointments-calendar";
import { ClientCalendar } from "./calendar-view";
import { disconnectGoogleAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Calendar", robots: { index: false, follow: false } };

const DAY = 86_400_000;

export default async function PortalCalendarPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/portal");
  const sp = await searchParams;
  const { user } = session;

  const [site] = await db
    .select({ id: forgeSites.id, businessName: forgeSites.businessName })
    .from(forgeSites)
    .where(and(eq(forgeSites.claimedByUserId, user.id), ne(forgeSites.status, "deleted")))
    .orderBy(desc(forgeSites.claimedAt))
    .limit(1);

  const conn = await getConnection(user.id);
  const connected = !!conn?.calendarConnected;
  const bookingLabel = conn?.bookingLabel || "Website & AI bookings";

  let events: CalEvent[] = [];
  if (connected) {
    const token = await getValidAccessToken(conn!);
    if (token) {
      const now = Date.now();
      const raw = await listCalendarEvents(token, new Date(now - 45 * DAY).toISOString(), new Date(now + 120 * DAY).toISOString());
      events = raw.map((e): CalEvent => ({
        id: `g-${e.id}`,
        kind: e.tbjBooking ? "appt" : "other", // website/AI bookings vs the customer's personal events
        title: e.summary, start: e.start, end: e.end, allDay: e.allDay,
        meetLink: e.hangoutLink, htmlLink: e.htmlLink,
        note: e.description ? e.description.slice(0, 500) : undefined, sub: e.location || undefined,
      }));
    }
  }

  const connectUrl = `/api/google/connect${site ? `?siteId=${site.id}` : ""}`;
  const status = sp.google;

  return (
    <>
      <div className="mx-auto w-full max-w-5xl px-5 py-8">
        <Link href="/portal" className="text-sm font-semibold text-brand hover:underline">← Back to portal</Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Calendar</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Your appointments in one place. Website &amp; AI bookings land here automatically; your personal calendar stays private unless you choose to show it.
        </p>

        {status === "connected" && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">✅ Google connected — you&apos;re all set.</div>
        )}
        {status === "error" && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">Something went wrong connecting Google. Please try again.</div>
        )}
        {status === "unconfigured" && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">Google connection isn&apos;t available yet — check back shortly.</div>
        )}

        {/* connection card */}
        <div className="mt-5 rounded-2xl border border-line bg-background p-5">
          {connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span className="text-sm font-bold text-ink">Google connected</span>
                </div>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {conn?.googleEmail || "your Google account"} · calendar{conn?.contactsConnected ? " + contacts" : ""} · your receptionist books here.
                </p>
              </div>
              <form action={disconnectGoogleAction}>
                <button type="submit" className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-surface">Disconnect</button>
              </form>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-ink">Connect your Google Calendar &amp; Contacts</div>
                <p className="mt-0.5 max-w-lg text-xs text-ink-soft">
                  Your AI receptionist will book appointments directly into your calendar, and your Google Contacts can sync to your monthly newsletter list. You can disconnect anytime.
                </p>
              </div>
              {isGoogleOAuthConfigured() ? (
                <a href={connectUrl} className="shrink-0 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark">Connect Google</a>
              ) : (
                <span className="shrink-0 rounded-full bg-surface px-4 py-2 text-sm font-medium text-ink-soft">Coming soon</span>
              )}
            </div>
          )}
        </div>

        {/* their calendar, once connected — with their own show/hide filters */}
        {connected && (
          <div className="mt-8">
            <ClientCalendar events={events} initialLabel={bookingLabel} />
          </div>
        )}
      </div>
    </>
  );
}
