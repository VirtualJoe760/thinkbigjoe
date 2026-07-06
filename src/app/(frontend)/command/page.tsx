import type { Metadata } from "next";
import Link from "next/link";
import { eq, sql } from "drizzle-orm";

import { db, outreach, prospects, leads, activityLog } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { calendarHealth } from "@/lib/gcal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Overview",
  robots: { index: false, follow: false },
};

const PIPELINE: Array<{ key: string; label: string }> = [
  { key: "new", label: "New" },
  { key: "qualified", label: "Qualified" },
  { key: "note_ready", label: "Note ready" },
  { key: "connected", label: "Connected" },
  { key: "replied", label: "Replied" },
  { key: "meeting", label: "Booked" },
];

export default async function OverviewPage() {
  await requireAdmin();

  const [rows, leadRows, upcomingAppointments, recentActivity, calHealth] = await Promise.all([
    db
      .select({
        outreachStatus: outreach.status,
        sentAt: outreach.sentAt,
        fitScore: prospects.fitScore,
        name: prospects.name,
        prospectId: prospects.id,
        vertical: prospects.vertical,
        pstatus: prospects.status,
      })
      .from(outreach)
      .innerJoin(prospects, eq(outreach.prospectId, prospects.id))
      .where(eq(outreach.step, "connection")),
    db.select().from(leads),
    db
      .select({
        id: leads.id,
        name: leads.name,
        company: leads.company,
        email: leads.email,
        phone: leads.phone,
        role: leads.role,
        industry: leads.industry,
        teamSize: leads.teamSize,
        timeline: leads.timeline,
        problem: leads.problem,
        source: leads.source,
        bookedSlot: leads.bookedSlot,
        gcalHtmlLink: leads.gcalHtmlLink,
        meetLink: leads.meetLink,
      })
      .from(leads)
      .where(
        sql`${leads.bookedSlot} IS NOT NULL AND ${leads.bookedSlot} >= now()::text`,
      )
      .orderBy(leads.bookedSlot)
      .limit(6),
    db
      .select({
        id: activityLog.id,
        actor: activityLog.actor,
        eventType: activityLog.eventType,
        summary: activityLog.summary,
        createdAt: activityLog.createdAt,
      })
      .from(activityLog)
      .orderBy(sql`${activityLog.createdAt} DESC`)
      .limit(8),
    calendarHealth(),
  ]);

  const pending = rows.filter(
    (r) => r.outreachStatus === "draft" || r.outreachStatus === "edited",
  );
  const priority = pending.filter((r) => Number(r.fitScore || 0) >= 5);
  const ready = rows.filter((r) => r.outreachStatus === "approved").length;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const sentWeek = rows.filter(
    (r) => r.outreachStatus === "sent" && r.sentAt && new Date(r.sentAt).getTime() > weekAgo,
  ).length;

  const booked = leadRows.filter((l) => l.status === "booked" || l.bookedSlot).length;

  const pipelineCounts: Record<string, number> = {};
  for (const r of rows) {
    const s = String(r.pstatus || "new");
    pipelineCounts[s] = (pipelineCounts[s] || 0) + 1;
  }

  const topPriority = [...priority]
    .sort((a, b) => Number(b.fitScore || 0) - Number(a.fitScore || 0))
    .slice(0, 5);

  const recentLeads = [...leadRows]
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 5);

  const metrics = [
    { label: "Prospects", value: rows.length, accent: "" },
    { label: "Priority", value: priority.length, accent: "text-brand" },
    { label: "Ready to send", value: ready, accent: "" },
    { label: "Sent this week", value: sentWeek, accent: "" },
    { label: "Inbound leads", value: leadRows.length, accent: "" },
    { label: "Booked calls", value: booked, accent: "text-brand" },
  ];

  function relativeTime(iso: string) {
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
  }

  // Forward-looking label for an upcoming appointment ("today" / "tomorrow" / "in 3 days").
  function untilLabel(when: Date) {
    const ms = when.getTime() - Date.now();
    if (ms < 0) return "now";
    const hrs = ms / 3600_000;
    if (hrs < 1) return `in ${Math.max(1, Math.round(ms / 60000))} min`;
    if (hrs < 24) return `in ${Math.round(hrs)}h`;
    const days = Math.round(hrs / 24);
    return days <= 1 ? "tomorrow" : `in ${days} days`;
  }

  function activityIcon(eventType: string) {
    switch (eventType) {
      case "scout_complete": return "🔍";
      case "outreach_sent": return "📤";
      case "followup_sent": return "💬";
      case "booking_made": return "📅";
      case "inbox_checked": return "📬";
      default: return "✦";
    }
  }

  const BOOKING_TZ = "America/Los_Angeles";

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-ink-soft">Your prospecting and pipeline at a glance.</p>

        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-xl bg-surface p-4">
              <div className="text-sm text-ink-soft">{m.label}</div>
              <div className={`mt-1 text-3xl font-extrabold tracking-tight ${m.accent}`}>
                {m.value}
              </div>
            </div>
          ))}
        </div>

        <h2 className="mt-8 mb-2 text-sm font-bold tracking-wide text-ink-soft uppercase">
          Pipeline
        </h2>
        <div className="flex items-stretch gap-1.5 overflow-x-auto">
          {PIPELINE.map((stage, i) => (
            <div key={stage.key} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-ink-soft/40">›</span>}
              <div className="min-w-[84px] rounded-xl bg-surface px-3 py-2 text-center">
                <div className="text-lg font-bold">{pipelineCounts[stage.key] || 0}</div>
                <div className="text-[11px] text-ink-soft">{stage.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-line bg-background p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Top priority</h2>
              <Link href="/command/prospects?view=priority" className="text-xs font-semibold text-brand hover:underline">
                Open queue
              </Link>
            </div>
            {topPriority.length === 0 ? (
              <p className="text-sm text-ink-soft">No priority prospects pending.</p>
            ) : (
              <ul className="space-y-2">
                {topPriority.map((p) => (
                  <li key={p.prospectId}>
                    <Link
                      href={`/command/${p.prospectId}`}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface"
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                        fit {Number(p.fitScore || 0)}/6
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-background p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Recent inbound leads</h2>
              <Link href="/command/leads" className="text-xs font-semibold text-brand hover:underline">
                All leads
              </Link>
            </div>
            {recentLeads.length === 0 ? (
              <p className="text-sm text-ink-soft">No inbound leads yet — they arrive via the site forms.</p>
            ) : (
              <ul className="space-y-2">
                {recentLeads.map((l) => (
                  <li key={l.id} className="rounded-lg px-2 py-1.5 text-sm">
                    <span className="font-medium">{l.name}</span>
                    {l.company ? <span className="text-ink-soft"> · {l.company}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
          <div className="mt-8 rounded-2xl border border-line bg-background p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold tracking-tight">Upcoming appointments</h2>
                <span
                  title={
                    calHealth.ok
                      ? `Live free/busy check succeeded on ${calHealth.calendarId}`
                      : calHealth.configured
                        ? `Credentials set but the API call failed: ${calHealth.error || "unknown"}`
                        : "GCAL_* env vars are not set"
                  }
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    calHealth.ok
                      ? "bg-green-100 text-green-800"
                      : calHealth.configured
                        ? "bg-amber-100 text-amber-800"
                        : "bg-surface text-ink-soft"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${calHealth.ok ? "bg-green-600" : calHealth.configured ? "bg-amber-500" : "bg-ink-soft"}`} />
                  {calHealth.ok ? "Calendar connected" : calHealth.configured ? "Calendar needs attention" : "Calendar not connected"}
                </span>
              </div>
              <Link href="/command/appointments" className="text-xs font-semibold text-brand hover:underline">
                View all
              </Link>
            </div>
            {upcomingAppointments.length === 0 ? (
              <p className="text-sm text-ink-soft">No upcoming calls booked.</p>
            ) : (
              <ul className="space-y-3">
                {upcomingAppointments.map((appt) => {
                  const when = appt.bookedSlot ? new Date(appt.bookedSlot) : null;
                  const dateStr = when
                    ? when.toLocaleString("en-US", {
                        timeZone: BOOKING_TZ,
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                      })
                    : "";
                  const chips = [
                    appt.industry,
                    appt.teamSize ? `${appt.teamSize} team` : null,
                    appt.timeline ? `timeline: ${appt.timeline}` : null,
                  ].filter(Boolean) as string[];
                  return (
                    <li key={appt.id} className="rounded-xl border border-line bg-surface p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-ink">
                            {appt.name}
                            {appt.company ? <span className="font-normal text-ink-soft"> · {appt.company}</span> : null}
                            {appt.role ? <span className="font-normal text-ink-soft"> · {appt.role}</span> : null}
                          </div>
                          {dateStr && (
                            <div className="text-xs font-semibold text-brand">
                              {dateStr} PT{when ? <span className="font-normal text-ink-soft"> · {untilLabel(when)}</span> : null}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {appt.meetLink && (
                            <a href={appt.meetLink} target="_blank" rel="noreferrer" className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-dark">
                              Join
                            </a>
                          )}
                          {appt.gcalHtmlLink && (
                            <a href={appt.gcalHtmlLink} target="_blank" rel="noreferrer" className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:bg-background">
                              Calendar
                            </a>
                          )}
                        </div>
                      </div>
                      {chips.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {chips.map((c, i) => (
                            <span key={i} className="rounded-full bg-background px-2 py-0.5 text-[11px] text-ink-soft">{c}</span>
                          ))}
                        </div>
                      )}
                      {appt.problem && (
                        <p className="mt-2 line-clamp-3 text-sm text-ink-soft">
                          <span className="font-medium text-ink">Wants: </span>
                          {appt.problem}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft">
                        {appt.email && <a href={`mailto:${appt.email}`} className="hover:text-ink">{appt.email}</a>}
                        {appt.phone && <a href={`tel:${appt.phone}`} className="hover:text-ink">{appt.phone}</a>}
                        {appt.source && <span>via {String(appt.source).replace(/-/g, " ")}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-line bg-background p-5">
            <h2 className="mb-3 text-sm font-bold tracking-tight">Venus activity</h2>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-ink-soft">Nothing logged yet.</p>
            ) : (
              <ul className="space-y-3">
                {recentActivity.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 shrink-0 text-base leading-none">{activityIcon(entry.eventType)}</span>
                    <span className="min-w-0 flex-1 text-ink">{entry.summary}</span>
                    <span className="shrink-0 text-xs text-ink-soft">{relativeTime(entry.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
      </div>
    </div>
  );
}
