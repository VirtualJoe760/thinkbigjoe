import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, isNotNull, sql } from "drizzle-orm";

import { db, forgeSites, leads, activityLog } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { calendarHealth } from "@/lib/gcal";
import { getForgeDigest } from "@/lib/forge-stats";
import { getPendingReplies } from "@/lib/forge-outreach";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, cardClass, StatGrid } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Overview",
  robots: { index: false, follow: false },
};

const BOOKING_TZ = "America/Los_Angeles";

// neon-http db.execute returns either an array or {rows}; normalize + read one row.
function firstRow(res: unknown): Record<string, unknown> {
  const rows = Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? []);
  return (rows[0] as Record<string, unknown>) ?? {};
}
const num = (v: unknown) => (v == null ? 0 : Number(v));

export default async function OverviewPage() {
  await requireAdmin();

  const [digest, counts, recentSales, recentBuilds, pendingReplies, upcomingAppointments, recentActivity, calHealth, signupCounts, recentSignups, commsCounts] =
    await Promise.all([
      getForgeDigest(),
      db.execute(sql`SELECT
          count(*) FILTER (WHERE one_time_paid = true) AS customers,
          count(*) FILTER (WHERE one_time_paid = true AND paid_at > now()-interval '30 days') AS customers_30d,
          count(*) FILTER (WHERE live_url IS NOT NULL) AS live_sites,
          count(*) FILTER (WHERE marketing_approved_at IS NOT NULL) AS leads,
          count(*) FILTER (WHERE contacted_at IS NOT NULL) AS contacted
        FROM forge_sites`),
      db
        .select({ id: forgeSites.id, businessName: forgeSites.businessName, plan: forgeSites.plan, paidAt: forgeSites.paidAt, liveUrl: forgeSites.liveUrl })
        .from(forgeSites)
        .where(eq(forgeSites.oneTimePaid, true))
        .orderBy(sql`${forgeSites.paidAt} DESC NULLS LAST`)
        .limit(6),
      db
        .select({ id: forgeSites.id, businessName: forgeSites.businessName, liveUrl: forgeSites.liveUrl, builtAt: forgeSites.builtAt })
        .from(forgeSites)
        .where(isNotNull(forgeSites.builtAt))
        .orderBy(desc(forgeSites.builtAt))
        .limit(6),
      getPendingReplies(),
      db
        .select({
          id: leads.id, name: leads.name, company: leads.company, email: leads.email, phone: leads.phone,
          role: leads.role, industry: leads.industry, teamSize: leads.teamSize, timeline: leads.timeline,
          problem: leads.problem, source: leads.source, bookedSlot: leads.bookedSlot,
          gcalHtmlLink: leads.gcalHtmlLink, meetLink: leads.meetLink,
        })
        .from(leads)
        .where(sql`${leads.bookedSlot} IS NOT NULL AND ${leads.bookedSlot} >= now()::text`)
        .orderBy(leads.bookedSlot)
        .limit(6),
      db
        .select({ id: activityLog.id, actor: activityLog.actor, eventType: activityLog.eventType, summary: activityLog.summary, createdAt: activityLog.createdAt })
        .from(activityLog)
        .orderBy(sql`${activityLog.createdAt} DESC`)
        .limit(10),
      calendarHealth(),
      db.execute(sql`SELECT count(*)::int AS total,
          count(*) FILTER (WHERE "createdAt" > now()-interval '30 days')::int AS recent30
        FROM better_auth."user"`),
      db.execute(sql`SELECT u.email, u.name, u."createdAt" AS created_at,
          EXISTS(SELECT 1 FROM forge_sites f WHERE f.claimed_by_user_id = u.id) AS claimed,
          EXISTS(SELECT 1 FROM forge_sites f WHERE f.claimed_by_user_id = u.id AND f.one_time_paid = true) AS paid
        FROM better_auth."user" u ORDER BY u."createdAt" DESC LIMIT 6`),
      // Outreach volume — texts sent + voicemail drops (today PT + last 7d) so Joe sees results.
      db.execute(sql`SELECT
          count(*) FILTER (WHERE event_type = 'sms_outreach_sent' AND created_at >= date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles') AS texts_today,
          count(*) FILTER (WHERE event_type = 'sms_outreach_sent' AND created_at > now()-interval '7 days') AS texts_7d,
          count(*) FILTER (WHERE event_type = 'voicemail_dropped' AND created_at >= date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles') AS drops_today,
          count(*) FILTER (WHERE event_type = 'voicemail_dropped' AND created_at > now()-interval '7 days') AS drops_7d,
          count(*) FILTER (WHERE event_type = 'voicemail_delivered' AND created_at > now()-interval '7 days') AS delivered_7d
        FROM activity_log`),
    ]);

  const c = firstRow(counts);
  const customers = num(c.customers);
  const customers30d = num(c.customers_30d);
  const liveSites = num(c.live_sites);
  const leadCount = num(c.leads);
  const repliesWaiting = pendingReplies.length;
  const booked = upcomingAppointments.length;
  const signups = num(firstRow(signupCounts).total);
  const signups30d = num(firstRow(signupCounts).recent30);
  const cc = firstRow(commsCounts);
  const textsToday = num(cc.texts_today);
  const texts7d = num(cc.texts_7d);
  const dropsToday = num(cc.drops_today);
  const drops7d = num(cc.drops_7d);
  const delivered7d = num(cc.delivered_7d);
  const signupRows = (Array.isArray(recentSignups) ? recentSignups : (recentSignups as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[];

  // Growth-oriented health tiles — is the machine producing, and is the pipeline moving?
  const metrics = [
    { label: "Sites built · 7d", value: digest.throughput.built7d, sub: `${liveSites} live`, accent: "" },
    { label: "Emails sent · 7d", value: digest.throughput.outreachSent7d, sub: `${digest.throughput.previews7d} previews`, accent: "" },
    { label: "Texts sent · 7d", value: texts7d, sub: `${textsToday} today`, accent: textsToday > 0 ? "text-brand" : "" },
    { label: "Voicemails · 7d", value: drops7d, sub: `${dropsToday} today${delivered7d ? ` · ${delivered7d} delivered` : ""}`, accent: dropsToday > 0 ? "text-brand" : "" },
    { label: "Replies to handle", value: repliesWaiting, sub: "inbound", accent: repliesWaiting > 0 ? "text-brand" : "" },
    { label: "Customers", value: customers, sub: `${customers30d} in 30d`, accent: "text-brand" },
    { label: "Sign-ups", value: signups, sub: `${signups30d} in 30d`, accent: signups30d > 0 ? "text-brand" : "" },
    { label: "Booked calls", value: booked, sub: "upcoming", accent: "text-brand" },
    { label: "Leads in room", value: leadCount, sub: "approved", accent: "" },
  ];

  function relativeTime(iso: string) {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }
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
      case "site_paid": return "💰";
      case "forge_site_built": return "🔨";
      case "forge_marketing_approved": return "✅";
      case "forge_outreach_sent":
      case "outreach_sent": return "📤";
      case "forge_outreach_drafted": return "✍️";
      case "forge_preview_generated": return "🖼️";
      case "forge_prospect_added":
      case "forge_scout_complete":
      case "scout_complete": return "🔍";
      case "forge_contact_enriched": return "📇";
      case "lead_engine_run": return "🧲";
      case "booking_made": return "📅";
      case "inbox_checked": return "📬";
      case "email_bounced": return "⚠️";
      default: return "✦";
    }
  }
  function shortWhen(iso: string | null) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  return (
    <div className="px-6 py-8">
      <AutoRefresh seconds={90} />
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-ink-soft">
          The pulse of the business — what the agents built, who they reached, who bought, and what&apos;s on the calendar.
        </p>

        {/* Health tiles — growth + throughput at a glance */}
        <StatGrid cols={3} className="mt-6">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-xl bg-surface p-4">
              <div className="text-sm text-ink-soft">{m.label}</div>
              <div className={`mt-1 text-3xl font-extrabold tracking-tight ${m.accent}`}>{m.value}</div>
              <div className="mt-0.5 text-xs text-ink-soft">{m.sub}</div>
            </div>
          ))}
        </StatGrid>

        {/* Engine flow — the forge digest at a glance (are the build agents running?) */}
        <div className="mt-8 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Engine flow</h2>
          <Link href="/command/engine" className="text-xs font-semibold text-brand hover:underline">
            Engine room →
          </Link>
        </div>
        <div className={cardClass({ className: "mt-2" })}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">
              Forge{" "}
              <span className={digest.config.masterEnabled ? "text-green-600" : "text-ink-soft"}>
                {digest.config.masterEnabled ? "running" : "stopped"}
              </span>
            </span>
            <span className="text-sm text-ink-soft">
              <span className="font-semibold text-ink tabular-nums">{digest.budget.weekRunsUsed}</span>/
              {digest.budget.weeklyRunBudget} runs this week
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line">
            <div
              className={`h-full rounded-full ${digest.budget.pct >= 90 ? "bg-red-500" : digest.budget.pct >= 75 ? "bg-amber-500" : "bg-green-500"}`}
              style={{ width: `${Math.min(100, digest.budget.pct)}%` }}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Built 7d", value: digest.throughput.built7d },
              { label: "Edits 7d", value: digest.throughput.edits7d },
              { label: "Outreach 7d", value: digest.throughput.outreachSent7d },
              { label: "Previews 7d", value: digest.throughput.previews7d },
            ].map((s) => (
              <div key={s.label}>
                <div className="text-xl font-bold tabular-nums">{s.value}</div>
                <div className="text-[11px] text-ink-soft">{s.label}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            {digest.buildQueue.total} in build queue · {digest.editQueue.total} edits waiting · builds{" "}
            {digest.config.buildsEnabled ? "on" : "off"} · edits {digest.config.editsEnabled ? "on" : "off"}
          </p>
        </div>

        {/* Communications + Sales */}
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Recent communications</h2>
              <Link href="/command/leads" className="text-xs font-semibold text-brand hover:underline">
                Inbox
              </Link>
            </div>
            {pendingReplies.length === 0 ? (
              <p className="text-sm text-ink-soft">
                No replies waiting. {digest.throughput.outreachSent7d} outreach emails went out in the last 7 days.
              </p>
            ) : (
              <ul className="space-y-2">
                {pendingReplies.slice(0, 5).map((r) => (
                  <li key={r.id} className="rounded-lg px-2 py-1.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{r.businessName}</span>
                      <span className="shrink-0 text-xs text-ink-soft">{relativeTime(r.createdAt)}</span>
                    </div>
                    {r.subject && <div className="truncate text-xs text-ink-soft">{r.subject}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Recent sales</h2>
              <span className="text-xs font-semibold text-ink-soft">{customers} total</span>
            </div>
            {recentSales.length === 0 ? (
              <p className="text-sm text-ink-soft">No sales yet — customers appear here the moment they activate a plan.</p>
            ) : (
              <ul className="space-y-2">
                {recentSales.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm">
                    <span className="min-w-0 truncate font-medium">{s.businessName}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {s.plan && <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">{s.plan}</span>}
                      <span className="text-xs text-ink-soft">{shortWhen(s.paidAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Recent builds */}
        <div className={cardClass({ className: "mt-4" })}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-tight">Recent builds</h2>
            <Link href="/command/prospects" className="text-xs font-semibold text-brand hover:underline">
              Prospecting
            </Link>
          </div>
          {recentBuilds.length === 0 ? (
            <p className="text-sm text-ink-soft">Nothing built yet — the forge queues sites from approved prospects.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {recentBuilds.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
                  <span className="min-w-0 truncate font-medium">{b.businessName}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-ink-soft">{shortWhen(b.builtAt)}</span>
                    {b.liveUrl && (
                      <a href={b.liveUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand hover:underline">
                        View
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent sign-ups — did the people we reached actually create an account? */}
        <div className={cardClass({ className: "mt-4" })}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-tight">Recent sign-ups</h2>
            <span className="text-xs font-semibold text-ink-soft">{signups} accounts</span>
          </div>
          {signupRows.length === 0 ? (
            <p className="text-sm text-ink-soft">No accounts yet — sign-ups from your outreach show up here.</p>
          ) : (
            <ul className="space-y-2">
              {signupRows.map((u, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{String(u.name || u.email)}</span>
                    {u.name ? <span className="text-ink-soft"> · {String(u.email)}</span> : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {u.paid ? (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">paid</span>
                    ) : u.claimed ? (
                      <span className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-semibold text-brand">claimed</span>
                    ) : (
                      <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-soft">no site yet</span>
                    )}
                    <span className="text-xs text-ink-soft">{u.created_at ? relativeTime(String(u.created_at)) : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Upcoming appointments */}
        <div className={cardClass({ className: "mt-4" })}>
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
                  calHealth.ok ? "bg-green-100 text-green-800" : calHealth.configured ? "bg-amber-100 text-amber-800" : "bg-surface text-ink-soft"
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
                      timeZone: BOOKING_TZ, weekday: "short", month: "short", day: "numeric",
                      hour: "numeric", minute: "2-digit", hour12: true,
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
                        {chips.map((chip, i) => (
                          <span key={i} className="rounded-full bg-background px-2 py-0.5 text-[11px] text-ink-soft">{chip}</span>
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

        {/* Agent activity — proof the OpenClaw crew is working */}
        <div className={cardClass({ className: "mt-4" })}>
          <h2 className="mb-3 text-sm font-bold tracking-tight">Agent activity</h2>
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
