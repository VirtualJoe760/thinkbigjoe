import type { Metadata } from "next";
import { eq, sql } from "drizzle-orm";

import { db, automationSettings } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Automation",
  robots: { index: false, follow: false },
};

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

export default async function AutomationPage() {
  await requireAdmin();

  const cfg = (
    await db.select().from(automationSettings).where(eq(automationSettings.id, 1)).limit(1)
  )[0];

  const sentToday = await scalar(
    sql`SELECT count(*)::int AS n FROM outreach WHERE status = 'sent' AND sent_at >= date_trunc('day', now() AT TIME ZONE ${cfg.timezone}) AT TIME ZONE ${cfg.timezone}`,
  );

  const now = new Date();
  const ptHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: cfg.timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
  const ptDay = new Intl.DateTimeFormat("en-US", { timeZone: cfg.timezone, weekday: "short" }).format(now);
  const workDays = cfg.workDays.split(",").map((d) => d.trim());
  const isWorkDay = workDays.includes(ptDay);
  const inHours = ptHour >= cfg.workStartHour && ptHour < cfg.workEndHour;
  const target = todaysTarget(cfg);

  let statusLine: string;
  if (!cfg.enabled) statusLine = "Off — turn it on below to start the daily drip.";
  else if (!isWorkDay) statusLine = `On — idle today (${ptDay} isn't a working day).`;
  else if (!inHours) statusLine = `On — outside working hours (resumes ${cfg.workStartHour}:00 PT).`;
  else statusLine = `On & active — sending ${sentToday}/${target} for today.`;

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Automation</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Control the autonomous prospecting drip — when it runs, how many it sends, and how it ramps.
          The sender reads these settings; sending stays supervised and human-paced.
        </p>

        {/* Live status */}
        <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
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
            {cfg.rampEnabled && cfg.dailyGoal > target && (
              <span>Ramping → goal <b className="text-ink">{cfg.dailyGoal}</b></span>
            )}
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
      </div>
    </div>
  );
}
