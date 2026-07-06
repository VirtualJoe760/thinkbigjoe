import type { Metadata } from "next";
import { eq, sql } from "drizzle-orm";

import { db, automationSettings } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { calendarHealth } from "@/lib/gcal";
import { SettingsForm } from "../automation/settings-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

const VERCEL_ANALYTICS_URL = "https://vercel.com/joes-projects-e3fd5dcd/thinkbigjoe-cyio/analytics";

type Cfg = typeof automationSettings.$inferSelect;

function todaysTarget(cfg: Cfg): number {
  if (!cfg.rampEnabled || !cfg.rampStartedOn) return cfg.dailyGoal;
  const start = new Date(cfg.rampStartedOn + "T00:00:00Z").getTime();
  const weeks = Math.max(0, Math.floor((Date.now() - start) / (7 * 24 * 3600 * 1000)));
  return Math.min(cfg.dailyGoal, cfg.rampStart + weeks * cfg.rampWeeklyStep);
}

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const rows = (await db.execute(query)) as unknown as { rows?: { n: number }[] } | { n: number }[];
  const list = Array.isArray(rows) ? rows : rows.rows || [];
  return Number(list[0]?.n ?? 0);
}

export default async function SettingsPage() {
  await requireAdmin();

  const [cfg, cal] = await Promise.all([
    db.select().from(automationSettings).where(eq(automationSettings.id, 1)).limit(1).then((r) => r[0]),
    calendarHealth(),
  ]);

  const sentToday = await scalar(
    sql`SELECT count(*)::int AS n FROM outreach WHERE status = 'sent' AND sent_at >= date_trunc('day', now() AT TIME ZONE ${cfg.timezone}) AT TIME ZONE ${cfg.timezone}`,
  );

  const now = new Date();
  const ptHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: cfg.timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
  const ptDay = new Intl.DateTimeFormat("en-US", { timeZone: cfg.timezone, weekday: "short" }).format(now);
  const isWorkDay = cfg.workDays.split(",").map((d) => d.trim()).includes(ptDay);
  const inHours = ptHour >= cfg.workStartHour && ptHour < cfg.workEndHour;
  const target = todaysTarget(cfg);

  let statusLine: string;
  if (!cfg.enabled) statusLine = "Off — turn it on below to start the daily drip.";
  else if (!isWorkDay) statusLine = `On — idle today (${ptDay} isn't a working day).`;
  else if (!inHours) statusLine = `On — outside working hours (resumes ${cfg.workStartHour}:00 PT).`;
  else statusLine = `On & active — sending ${sentToday}/${target} for today.`;

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-2xl space-y-10">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-ink-soft">Automation, integrations, and analytics for the command center.</p>
        </div>

        {/* ── Google Calendar ── */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Google Calendar</h2>
          <div className="mt-2 rounded-2xl border border-line bg-background p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                  cal.ok ? "bg-green-100 text-green-800" : cal.configured ? "bg-amber-100 text-amber-800" : "bg-surface text-ink-soft"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${cal.ok ? "bg-green-600" : cal.configured ? "bg-amber-500" : "bg-ink-soft"}`} />
                {cal.ok ? "Connected" : cal.configured ? "Needs attention" : "Not connected"}
              </span>
              <span className="text-sm text-ink-soft">
                {cal.ok
                  ? "Booking is live — invites with a Meet link go out automatically."
                  : cal.configured
                    ? `Credentials are set but the last check failed${cal.error ? ` (${cal.error})` : ""} — the refresh token may need re-authing.`
                    : "GCAL_* environment variables aren't set."}
              </span>
            </div>
          </div>
        </section>

        {/* ── Outreach automation ── */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Outreach automation</h2>
          <p className="mt-1 text-sm text-ink-soft">
            The autonomous prospecting drip — when it runs, how many it sends, and how it ramps. Sending stays supervised.
          </p>
          <div className="mt-3 rounded-2xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.enabled ? "bg-green-50 text-green-700" : "bg-background text-ink-soft"}`}>
                {cfg.enabled ? "ENABLED" : "OFF"}
              </span>
              <span className="text-sm font-medium">{statusLine}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-soft">
              <span>Today&apos;s target: <b className="text-ink">{target}</b></span>
              <span>Sent today: <b className="text-ink">{sentToday}</b></span>
              <span>Window: <b className="text-ink">{cfg.workStartHour}:00–{cfg.workEndHour}:00 PT</b>, {cfg.workDays.replaceAll(",", " ")}</span>
            </div>
          </div>
          <SettingsForm
            initial={{
              enabled: cfg.enabled,
              workDays: cfg.workDays,
              workStartHour: cfg.workStartHour,
              workEndHour: cfg.workEndHour,
              dailyGoal: cfg.dailyGoal,
              rampEnabled: cfg.rampEnabled,
              rampStart: cfg.rampStart,
              rampWeeklyStep: cfg.rampWeeklyStep,
            }}
          />
        </section>

        {/* ── Analytics ── */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Analytics</h2>
          <div className="mt-2 rounded-2xl border border-line bg-background p-5">
            <p className="text-sm text-ink-soft">
              Visitor tracking runs on Vercel Web Analytics (privacy-friendly, no cookies). The dashboards live in the Vercel project.
            </p>
            <a
              href={VERCEL_ANALYTICS_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
            >
              Open Vercel Analytics ↗
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
