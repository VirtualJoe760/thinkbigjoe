"use client";

import { useState, useTransition } from "react";

import { toggleForge } from "../actions";

export type ForgeQueueItem = {
  id: number;
  businessName: string;
  status: string; // "building" | "approved"
  elapsedMin: number | null;
};
export type ForgeEngineStats = {
  enabled: boolean;
  avgBuildMinutes: number;
  queue: ForgeQueueItem[]; // building first, then approved in build order
};

function fmtEta(min: number) {
  if (min < 1) return "under a minute";
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `~${h}h${m ? ` ${m}m` : ""}`;
}

export function ForgePanel({ stats }: { stats: ForgeEngineStats }) {
  const [enabled, setEnabled] = useState(stats.enabled);
  const [pending, start] = useTransition();

  const building = stats.queue.filter((q) => q.status === "building");
  const isBuilding = building.length > 0;

  function flip() {
    const next = !enabled;
    setEnabled(next);
    start(async () => {
      await toggleForge(next);
    });
  }

  // ETA cursor: an approved site starts after the current build finishes + everything ahead of it.
  let cursor = isBuilding ? Math.max(1, stats.avgBuildMinutes - (building[0].elapsedMin ?? 0)) : 0;

  return (
    <section className="rounded-2xl border border-line bg-background p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold tracking-tight">Build engine (forge)</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                isBuilding ? "bg-blue-100 text-blue-700" : enabled ? "bg-green-100 text-green-700" : "bg-line text-ink-soft"
              }`}
            >
              {isBuilding ? "Building" : enabled ? "On · idle" : "Off"}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            Turns approved sites into live, deployed websites — one at a time (~{stats.avgBuildMinutes} min each). Flip it
            off to pause every build instantly.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{enabled ? "On" : "Off"}</span>
          <button
            type="button"
            onClick={flip}
            disabled={pending}
            aria-pressed={enabled}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${enabled ? "bg-green-600" : "bg-line"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </label>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">Build queue</span>
          <span className="text-ink-soft">{stats.queue.length} in line</span>
        </div>

        {stats.queue.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">Queue is empty — approve a site to add it.</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-2">
            {stats.queue.map((q, i) => {
              const rowBuilding = q.status === "building";
              let etaLabel: string;
              if (rowBuilding) {
                etaLabel = `building now${q.elapsedMin != null ? ` · ~${q.elapsedMin}m in` : ""}`;
              } else {
                cursor += stats.avgBuildMinutes;
                etaLabel = enabled ? `${fmtEta(cursor)} to start` : "waiting — engine off";
              }
              return (
                <li
                  key={q.id}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${rowBuilding ? "border-blue-300 bg-blue-50" : "border-line bg-surface"}`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${rowBuilding ? "bg-blue-600 text-white" : "bg-ink text-white"}`}
                  >
                    {rowBuilding ? "▶" : i + 1 - building.length}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{q.businessName}</span>
                  <span className={`shrink-0 text-xs font-medium ${rowBuilding ? "text-blue-700" : "text-ink-soft"}`}>{etaLabel}</span>
                </li>
              );
            })}
          </ol>
        )}

        {!enabled && stats.queue.length > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
            Engine is off — nothing builds until you flip it on.
          </p>
        )}
      </div>
    </section>
  );
}
