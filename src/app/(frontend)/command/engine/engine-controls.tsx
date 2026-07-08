"use client";

import { useState, useTransition } from "react";

import { toggleForge, setForgeCapability, setWeeklyRunBudget } from "../actions";
import type { ForgeDigest } from "@/lib/forge-stats";

type Cfg = ForgeDigest["config"];

function Toggle({
  on,
  disabled,
  onFlip,
}: {
  on: boolean;
  disabled?: boolean;
  onFlip: () => void;
}) {
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

function Row({
  title,
  desc,
  on,
  disabled,
  onFlip,
}: {
  title: string;
  desc: string;
  on: boolean;
  disabled?: boolean;
  onFlip: () => void;
}) {
  return (
    <div className={`flex items-center gap-3 py-3 ${disabled ? "opacity-50" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-xs text-ink-soft">{desc}</p>
      </div>
      <Toggle on={on} disabled={disabled} onFlip={onFlip} />
    </div>
  );
}

export function EngineControls({ config }: { config: Cfg }) {
  const [cfg, setCfg] = useState(config);
  const [pending, start] = useTransition();
  const [budget, setBudget] = useState(String(config.weeklyRunBudget));
  const [budgetMsg, setBudgetMsg] = useState<string | null>(null);

  const flipMaster = () => {
    const next = !cfg.masterEnabled;
    setCfg((c) => ({ ...c, masterEnabled: next }));
    start(() => void toggleForge(next));
  };
  const flipCap = (cap: "builds" | "edits" | "idleTemplates", key: keyof Cfg) => {
    const next = !cfg[key];
    setCfg((c) => ({ ...c, [key]: next }));
    start(() => void setForgeCapability(cap, next as boolean));
  };
  const saveBudget = () => {
    start(async () => {
      const r = await setWeeklyRunBudget(Number(budget));
      setBudgetMsg(r.message);
      setTimeout(() => setBudgetMsg(null), 5000);
    });
  };

  const off = !cfg.masterEnabled;

  return (
    <section className="rounded-2xl border border-line bg-background p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">Forge controls</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            Master switch, plus per-capability throttles. Turn on just what you want running.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{cfg.masterEnabled ? "Running" : "Stopped"}</span>
          <Toggle on={cfg.masterEnabled} disabled={pending} onFlip={flipMaster} />
        </label>
      </div>

      <div className="mt-3 divide-y divide-line border-t border-line">
        <Row
          title="New-site builds"
          desc="Build brand-new sites from approved prospects — the biggest quota draw."
          on={cfg.buildsEnabled}
          disabled={off || pending}
          onFlip={() => flipCap("builds", "buildsEnabled")}
        />
        <Row
          title="Customer edits"
          desc="Apply portal edit requests. Cheap + customer-facing — usually stays on."
          on={cfg.editsEnabled}
          disabled={off || pending}
          onFlip={() => flipCap("edits", "editsEnabled")}
        />
        <Row
          title="Idle template-building"
          desc="When the forge is otherwise free, design new templates (capped, spaced out)."
          on={cfg.idleTemplatesEnabled}
          disabled={off || pending}
          onFlip={() => flipCap("idleTemplates", "idleTemplatesEnabled")}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <label className="text-sm">
          <span className="block font-medium text-ink">Weekly run-budget</span>
          <span className="text-xs text-ink-soft">Cap on builds + edits + templates per 7 days</span>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={1000}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="w-24 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm tabular-nums text-ink"
            />
            <button
              type="button"
              onClick={saveBudget}
              disabled={pending || budget === String(cfg.weeklyRunBudget)}
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
          Master switch is off — nothing runs (builds, edits, or templates) until you turn it on. Edits still queue safely.
        </p>
      )}
    </section>
  );
}
