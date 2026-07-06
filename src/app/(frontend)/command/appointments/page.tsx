import type { Metadata } from "next";
import Link from "next/link";
import { desc, isNotNull } from "drizzle-orm";

import { db, leads } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { calendarHealth } from "@/lib/gcal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Appointments",
  robots: { index: false, follow: false },
};

const TZ = "America/Los_Angeles";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function whenLabel(ms: number): { text: string; tone: "soon" | "upcoming" | "past" } {
  if (ms < 0) return { text: "past", tone: "past" };
  const hrs = ms / 3_600_000;
  if (hrs < 2) return { text: `in ${Math.max(1, Math.round(ms / 60000))} min`, tone: "soon" };
  if (hrs < 24) return { text: `in ${Math.round(hrs)}h`, tone: hrs < 3 ? "soon" : "upcoming" };
  const days = Math.round(hrs / 24);
  return { text: days <= 1 ? "tomorrow" : `in ${days} days`, tone: "upcoming" };
}

export default async function AppointmentsPage() {
  await requireAdmin();

  const [rows, cal] = await Promise.all([
    db.select().from(leads).where(isNotNull(leads.bookedSlot)).orderBy(desc(leads.bookedSlot)).limit(200),
    calendarHealth(),
  ]);

  const now = Date.now();
  const upcoming = rows
    .filter((r) => r.bookedSlot && new Date(r.bookedSlot).getTime() >= now)
    .sort((a, b) => new Date(a.bookedSlot!).getTime() - new Date(b.bookedSlot!).getTime());
  const past = rows.filter((r) => !r.bookedSlot || new Date(r.bookedSlot).getTime() < now);

  type Row = (typeof rows)[number];
  const Card = ({ l, isPast }: { l: Row; isPast?: boolean }) => {
    const t = l.bookedSlot ? new Date(l.bookedSlot).getTime() : 0;
    const rel = whenLabel(t - now);
    const chips = [l.industry, l.teamSize ? `${l.teamSize} team` : null, l.timeline ? `timeline: ${l.timeline}` : null].filter(Boolean) as string[];
    return (
      <div className={`rounded-2xl border border-line bg-background p-5 ${isPast ? "opacity-70" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {l.prospectId ? (
                <Link href={`/command/${l.prospectId}`} className="font-bold text-ink hover:text-brand hover:underline">{l.name}</Link>
              ) : (
                <span className="font-bold text-ink">{l.name}</span>
              )}
              {l.company ? <span className="text-sm text-ink-soft">· {l.company}</span> : null}
              {l.role ? <span className="text-sm text-ink-soft">· {l.role}</span> : null}
            </div>
            {l.bookedSlot && (
              <div className="mt-0.5 text-sm font-semibold text-brand">
                {fmtDate(l.bookedSlot)} PT
                <span className="font-normal text-ink-soft"> · 30 min{!isPast ? ` · ${rel.text}` : ""}</span>
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {!isPast && (
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  rel.tone === "soon" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                }`}
              >
                {rel.tone === "soon" ? "Starting soon" : "Upcoming"}
              </span>
            )}
            <div className="flex items-center gap-1.5">
              {l.meetLink && (
                <a href={l.meetLink} target="_blank" rel="noreferrer" className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-dark">Join</a>
              )}
              {l.gcalHtmlLink && (
                <a href={l.gcalHtmlLink} target="_blank" rel="noreferrer" className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:bg-surface">Calendar</a>
              )}
            </div>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c, i) => (
              <span key={i} className="rounded-full bg-surface px-2.5 py-0.5 text-[11px] text-ink-soft">{c}</span>
            ))}
          </div>
        )}

        {l.problem && (
          <p className="mt-3 rounded-xl bg-surface px-4 py-3 text-sm leading-relaxed">
            <span className="font-semibold text-ink">What they want: </span>
            {l.problem}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
          <a href={`mailto:${l.email}`} className="hover:text-ink">{l.email}</a>
          {l.phone && <a href={`tel:${l.phone}`} className="hover:text-ink">{l.phone}</a>}
          {l.source && <span>via {String(l.source).replace(/-/g, " ")}</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight">Appointments</h1>
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
          Booked strategy calls, with the intake each person filled out. Invites + Meet links go out via Google Calendar.
        </p>

        {rows.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-line bg-background p-10 text-center text-ink-soft">
            No booked calls yet. They appear here when someone completes the intake and books.
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-soft">
                Upcoming <span className="text-ink">{upcoming.length}</span>
              </h2>
              {upcoming.length === 0 ? (
                <p className="text-sm text-ink-soft">Nothing on the books right now.</p>
              ) : (
                <div className="space-y-3">{upcoming.map((l) => <Card key={l.id} l={l} />)}</div>
              )}
            </section>

            {past.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-soft">
                  Past <span className="text-ink">{past.length}</span>
                </h2>
                <div className="space-y-3">{past.map((l) => <Card key={l.id} l={l} isPast />)}</div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
