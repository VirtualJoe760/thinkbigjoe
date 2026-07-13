import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { calendarHealth, listEvents } from "@/lib/gcal";
import { AppointmentCalendar, type CalEvent } from "./appointments-calendar";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Calendar",
  robots: { index: false, follow: false },
};

const TZ = "America/Los_Angeles";
const DAY = 86_400_000;

/**
 * Google Calendar event descriptions are HTML (often pasted from external booking tools like Fyxer),
 * so rendering them verbatim shows raw <b>/<br>/<a> tags + &amp; entities. Flatten to clean, readable
 * text: links become "text (url)", block tags become line breaks, entities decode, tags strip out.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis, (_m, url, text) => {
      const t = text.replace(/<[^>]+>/g, "").trim();
      return t && !/^https?:/i.test(t) ? `${t} (${url})` : url;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default async function AppointmentsPage() {
  await requireAdmin();

  const now = new Date();
  const timeMin = new Date(now.getTime() - 45 * DAY).toISOString();
  const timeMax = new Date(now.getTime() + 120 * DAY).toISOString();

  const [gcalEvents, cal, callbackRows] = await Promise.all([
    listEvents(timeMin, timeMax),
    calendarHealth(),
    db.execute(sql`
      SELECT id, business_name AS "businessName", callback_at AS "callbackAt",
             callback_note AS "callbackNote", phone
      FROM forge_sites
      WHERE callback_at IS NOT NULL
        AND callback_at BETWEEN ${timeMin} AND ${timeMax}
        AND status <> 'deleted'
      ORDER BY callback_at ASC`),
  ]);

  const callbacks = (Array.isArray(callbackRows) ? callbackRows : (callbackRows as { rows?: unknown[] }).rows ?? []) as Array<{
    id: number; businessName: string; callbackAt: string; callbackNote: string | null; phone: string | null;
  }>;

  // Keep only TBJ bookings — the calendar is the PRIMARY Google Calendar, so it's full of Joe's
  // personal events (birthdays, etc.). Every TBJ booking is created with a Google Meet link and a
  // "Strategy Call —" / "Call —" summary (see the 5 createEvent callers); nothing personal matches
  // all of that, so filter on it. Never all-day (bookings are timed 30-min slots).
  const TBJ_SUMMARY = /^(strategy call|call|booked strategy call)\b|thinkbigjoe|\btbj\b/i;
  const tbjEvents = gcalEvents.filter(
    (e) => !e.allDay && (!!e.hangoutLink || TBJ_SUMMARY.test(e.summary) || /thinkbigjoe|call room|claim code|booked from/i.test(e.description)),
  );

  // Unify Google Calendar events (booked calls, however created) + scheduled call-backs.
  const events: CalEvent[] = [
    ...tbjEvents.map((e): CalEvent => {
      const guest = e.attendees.map((a) => a.displayName || a.email).filter(Boolean)[0] as string | undefined;
      return {
        id: `g-${e.id}`,
        kind: "appt",
        title: e.summary,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        meetLink: e.hangoutLink,
        htmlLink: e.htmlLink,
        note: e.description ? htmlToText(e.description).slice(0, 600) : undefined,
        sub: [guest, e.location].filter(Boolean).join(" · ") || undefined,
      };
    }),
    ...callbacks.map((c): CalEvent => ({
      id: `c-${c.id}`,
      kind: "callback",
      title: `Call back — ${c.businessName}`,
      start: c.callbackAt,
      end: new Date(new Date(c.callbackAt).getTime() + 30 * 60000).toISOString(),
      allDay: false,
      note: c.callbackNote || undefined,
      sub: c.phone || undefined,
      href: "/command/leads",
    })),
  ];

  // A compact "next up" rail — soonest upcoming items across both types.
  const upcoming = [...events]
    .filter((e) => new Date(e.start).getTime() >= now.getTime() - 60 * 60000)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, 6);

  const fmtWhen = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight">Calendar</h1>
          <span
            title={cal.ok ? "Live free/busy check succeeded" : cal.configured ? `Check failed: ${cal.error || "unknown"}` : "GCAL_* not set"}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              cal.ok ? "bg-green-100 text-green-800" : cal.configured ? "bg-amber-100 text-amber-800" : "bg-surface text-ink-soft"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${cal.ok ? "bg-green-600" : cal.configured ? "bg-amber-500" : "bg-ink-soft"}`} />
            {cal.ok ? "Calendar connected" : cal.configured ? "Calendar needs attention" : "Calendar not connected"}
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          Every TBJ commitment in one place — booked strategy calls (Google Calendar), plus the call-backs you scheduled from the leads room. Switch between month, week, and day.
        </p>

        <div className="mt-6">
          <AppointmentCalendar events={events} />
        </div>

        {/* Next up — the soonest handful, for a quick linear read */}
        {upcoming.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-soft">Next up</h2>
            <div className="space-y-2">
              {upcoming.map((e) => (
                <div key={e.id} className="flex items-center gap-3 rounded-xl border border-line bg-background px-4 py-3">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${e.kind === "callback" ? "bg-amber-500" : "bg-brand"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">{e.title}</div>
                    <div className="truncate text-xs text-ink-soft">{fmtWhen(e.start)} PT{e.sub ? ` · ${e.sub}` : ""}</div>
                  </div>
                  {e.meetLink && (
                    <a href={e.meetLink} target="_blank" rel="noreferrer" className="shrink-0 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-dark">Join</a>
                  )}
                  {!e.meetLink && e.href && (
                    <Link href={e.href} className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink hover:bg-surface">Open</Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {events.length === 0 && (
          <div className="mt-6 rounded-2xl border border-line bg-background p-10 text-center text-ink-soft">
            Nothing scheduled in this window. Booked calls and scheduled call-backs will appear here.
          </div>
        )}
      </div>
    </div>
  );
}
