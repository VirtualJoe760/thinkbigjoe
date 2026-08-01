import type { Metadata } from "next";
import { inArray, desc } from "drizzle-orm";

import { db, activityLog } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { VENUS_CRONS } from "@/lib/venus-crons.mjs";
import { SubNav, VENUS_TABS } from "../sub-nav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Venus crons",
  robots: { index: false, follow: false },
};

// crude but readable cron → English (covers the patterns we actually use)
function humanSchedule(expr: string): string {
  const map: Record<string, string> = {
    "0 2 * * *": "Daily · 2:00am",
    "0 * * * *": "Hourly",
    "*/30 8-20 * * *": "Every 30 min · 8am–8pm",
    "0 10 * * 1-5": "Weekdays · 10:00am",
    "0 3 * * 0": "Sundays · 3:00am",
  };
  return map[expr] ?? expr;
}

function relativeTime(iso: string | Date | null): string {
  if (!iso) return "never";
  const d = new Date(iso as string);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default async function CronsPage() {
  await requireAdmin();

  // Pull recent activity for every event type any cron emits, then match per cron.
  const allEventTypes = Array.from(new Set(VENUS_CRONS.flatMap((c) => c.eventTypes)));
  const recent = allEventTypes.length
    ? await db
        .select({ eventType: activityLog.eventType, createdAt: activityLog.createdAt })
        .from(activityLog)
        .where(inArray(activityLog.eventType, allEventTypes))
        .orderBy(desc(activityLog.createdAt))
        .limit(500)
    : [];

  const lastByEvent = new Map<string, string>();
  for (const r of recent) {
    if (!lastByEvent.has(r.eventType)) lastByEvent.set(r.eventType, r.createdAt as string);
  }
  function lastRun(eventTypes: string[]): string | null {
    let newest: string | null = null;
    for (const et of eventTypes) {
      const t = lastByEvent.get(et);
      if (t && (!newest || new Date(t) > new Date(newest))) newest = t;
    }
    return newest;
  }

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <SubNav items={VENUS_TABS} />
        <h1 className="text-2xl font-extrabold tracking-tight">Venus crons</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every scheduled Venus workflow — its schedule, the tools it calls, and the surfaces it
          feeds. Source of truth is{" "}
          <code className="rounded bg-surface px-1.5 py-0.5 text-xs">src/lib/venus-crons.mjs</code>.
          Edit there, then run{" "}
          <code className="rounded bg-surface px-1.5 py-0.5 text-xs">npm run venus:sync</code>.
        </p>

        <div className="mt-6 space-y-3">
          {VENUS_CRONS.map((cron) => {
            const last = lastRun(cron.eventTypes);
            return (
              <details
                key={cron.name}
                className="group rounded-2xl border border-line bg-background p-5 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer list-none flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{cron.name}</span>
                    <span className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand">
                      {humanSchedule(cron.schedule)}
                    </span>
                    {cron.enabled === false && (
                      <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-ink-soft">
                        ⏸ disabled — not synced
                      </span>
                    )}
                    <span className="ml-auto text-xs text-ink-soft whitespace-nowrap">
                      last ran {relativeTime(last)}
                    </span>
                  </div>
                  <p className="text-sm text-ink-soft">{cron.summary}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {cron.tools.map((t) => (
                      <span
                        key={t}
                        className="rounded-md bg-surface px-2 py-0.5 font-mono text-[11px] text-ink-soft"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-ink-soft">
                    <span className="font-medium text-ink">Feeds:</span> {cron.uiSurface.join(" · ")}
                  </p>
                </summary>

                <div className="mt-4 border-t border-line pt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                    Prompt Venus runs
                  </p>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-surface px-4 py-3 text-xs leading-relaxed text-ink">
                    {cron.prompt}
                  </pre>
                  <p className="mt-2 font-mono text-[11px] text-ink-soft">
                    cron: {cron.schedule} · id: {cron.id}
                  </p>
                </div>
              </details>
            );
          })}
        </div>

        <p className="mt-6 text-xs text-ink-soft">
          {VENUS_CRONS.length} crons declared. They run on the OpenClaw gateway (Joe&apos;s Mac) —
          if every &ldquo;last ran&rdquo; is stale, the gateway is likely down.
        </p>
      </div>
    </div>
  );
}
