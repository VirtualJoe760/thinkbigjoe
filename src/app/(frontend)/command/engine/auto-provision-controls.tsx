"use client";

import { useState, useTransition } from "react";

import { toggleAutoProvision, toggleAutoBuild, setWeeklyLineBudget, masterKill } from "../actions";
import type { AutoProvisionStatus } from "@/lib/auto-provision";

function Toggle({ on, disabled, onFlip }: { on: boolean; disabled?: boolean; onFlip: () => void }) {
  return (
    <button
      type="button"
      onClick={onFlip}
      disabled={disabled}
      aria-pressed={on}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-green-600" : "bg-line"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/**
 * The automation cockpit's money-spend controls. The master switch here is the ONE act that turns
 * "money spend manual" into "money spend automatic" for voice provisioning — off by default. The cap
 * bounds a runaway; the master kill button stops everything (forge + provisioning) at once.
 */
export function AutoProvisionControls({ status }: { status: AutoProvisionStatus }) {
  const [s, setS] = useState(status);
  const [pending, start] = useTransition();
  const [budget, setBudget] = useState(String(status.weeklyLineBudget));
  const [budgetMsg, setBudgetMsg] = useState<string | null>(null);
  const [killMsg, setKillMsg] = useState<string | null>(null);

  const flipMaster = () => {
    const next = !s.enabled;
    setS((c) => ({ ...c, enabled: next }));
    start(() => void toggleAutoProvision(next));
  };
  const flipBuild = () => {
    const next = !s.autoBuildEnabled;
    setS((c) => ({ ...c, autoBuildEnabled: next }));
    start(() => void toggleAutoBuild(next));
  };
  const saveBudget = () => {
    start(async () => {
      const r = await setWeeklyLineBudget(Number(budget));
      setBudgetMsg(r.message);
      setTimeout(() => setBudgetMsg(null), 5000);
    });
  };
  const doKill = () => {
    if (!window.confirm("Stop ALL automated spend now — forge builds and voice auto-provisioning? Queued work is preserved and resumes when you switch things back on.")) return;
    setS((c) => ({ ...c, enabled: false, autoBuildEnabled: false }));
    start(async () => {
      const r = await masterKill();
      setKillMsg(r.message);
      setTimeout(() => setKillMsg(null), 6000);
    });
  };

  const pct = s.weeklyLineBudget > 0 ? Math.round((s.linesThisWeek / s.weeklyLineBudget) * 100) : 0;
  const gaugeColor = pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-green-600";
  const off = !s.enabled;

  return (
    <section className="rounded-2xl border border-line bg-background p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">Auto-provision voice</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            When a customer pays for voice, buy their number and take the receptionist live automatically.
            <span className="font-semibold text-ink"> Off = you provision by hand</span> (they still queue below).
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{s.enabled ? "Automatic" : "Manual"}</span>
          <Toggle on={s.enabled} disabled={pending} onFlip={flipMaster} />
        </label>
      </div>

      {/* Spend gauge — numbers bought this week vs the cap */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-ink-soft">
          <span>Numbers bought this week</span>
          <span className="tabular-nums">
            <span className="font-semibold text-ink">{s.linesThisWeek}</span> / {s.weeklyLineBudget} ({s.remaining} left)
          </span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-line">
          <div className={`h-full rounded-full ${gaugeColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        {s.overCap && s.enabled && (
          <p className="mt-1.5 text-xs font-medium text-red-600">
            Cap reached — new provisions are paused. Queued customers wait; raise the cap or provision by hand.
          </p>
        )}
      </div>

      {/* Queue state */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line bg-surface px-3 py-2">
          <p className="text-lg font-bold tabular-nums text-ink">{s.queued}</p>
          <p className="text-xs text-ink-soft">queued for a line</p>
        </div>
        <div className={`rounded-xl border px-3 py-2 ${s.failed > 0 ? "border-red-200 bg-red-50" : "border-line bg-surface"}`}>
          <p className={`text-lg font-bold tabular-nums ${s.failed > 0 ? "text-red-700" : "text-ink"}`}>{s.failed}</p>
          <p className={`text-xs ${s.failed > 0 ? "text-red-600" : "text-ink-soft"}`}>failed — need a human</p>
        </div>
      </div>

      {/* Auto-build sub-switch */}
      <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Also build the site on payment</p>
          <p className="text-xs text-ink-soft">Auto-approve the forge build when they pay (the forge budget still gates the build spend).</p>
        </div>
        <Toggle on={s.autoBuildEnabled} disabled={pending} onFlip={flipBuild} />
      </div>

      {/* Weekly line budget */}
      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <label className="text-sm">
          <span className="block font-medium text-ink">Weekly line-budget</span>
          <span className="text-xs text-ink-soft">Max phone numbers bought per 7 days</span>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={500}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="w-24 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm tabular-nums text-ink"
            />
            <button
              type="button"
              onClick={saveBudget}
              disabled={pending || budget === String(s.weeklyLineBudget)}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:text-ink disabled:opacity-40"
            >
              Save
            </button>
            {budgetMsg && <span className="text-xs font-medium text-brand">{budgetMsg}</span>}
          </div>
        </label>
      </div>

      {off && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
          Manual mode — paid voice customers queue here and wait for you to run{" "}
          <code className="rounded bg-amber-100 px-1">provision-line --apply</code>. Flip to Automatic to have the drainer do it, capped.
        </p>
      )}

      {/* Master kill */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-xs text-ink-soft">
          Stops <span className="font-semibold text-ink">everything</span> — forge builds and voice provisioning. Queues are kept.
        </p>
        <div className="flex items-center gap-2">
          {killMsg && <span className="text-xs font-medium text-brand">{killMsg}</span>}
          <button
            type="button"
            onClick={doKill}
            disabled={pending}
            className="rounded-lg border border-red-300 bg-red-50 px-4 py-1.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-40"
          >
            🛑 Stop all automation
          </button>
        </div>
      </div>
    </section>
  );
}
