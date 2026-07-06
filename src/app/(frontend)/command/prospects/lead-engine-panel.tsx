"use client";

import { useState, useTransition } from "react";

import { updateLeadEngine } from "../actions";

export type LeadEngineStats = {
  monthlyLeadGoal: number;
  monthlyBudgetUsd: number;
  enabled: boolean;
  leadsThisMonth: number;
  leadsToday: number;
  dailyTarget: number;
  spendUsd: number;
  lastRunSummary: string | null;
  lastRunAt: string | null;
};

const pct = (n: number, d: number) => (d > 0 ? Math.min(100, Math.round((n / d) * 100)) : 0);
const fmt = (n: number) => n.toLocaleString("en-US");

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  return (
    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct(value, max)}%` }} />
    </div>
  );
}

export function LeadEnginePanel({ stats }: { stats: LeadEngineStats }) {
  const [goal, setGoal] = useState(stats.monthlyLeadGoal);
  const [budget, setBudget] = useState(stats.monthlyBudgetUsd);
  const [enabled, setEnabled] = useState(stats.enabled);
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const monthPct = pct(stats.leadsThisMonth, stats.monthlyLeadGoal);
  const overBudget = stats.spendUsd >= stats.monthlyBudgetUsd;
  const paceMet = stats.leadsToday >= stats.dailyTarget;

  function save() {
    setSaved(false);
    start(async () => {
      await updateLeadEngine({ monthlyLeadGoal: goal, monthlyBudgetUsd: budget, enabled });
      setSaved(true);
      setEditing(false);
    });
  }

  return (
    <section className="rounded-2xl border border-line bg-background p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold tracking-tight">Lead engine</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                enabled ? "bg-green-100 text-green-700" : "bg-line text-ink-soft"
              }`}
            >
              {enabled ? "Running" : "Paused"}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            Auto-scrapes new leads every 3h toward your monthly goal, spending up to your Apify cap. Falls back
            to browser scraping when the credit runs out.
          </p>
        </div>
        <button
          onClick={() => setEditing((v) => !v)}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink-soft hover:text-ink"
        >
          {editing ? "Cancel" : "Adjust goal / budget"}
        </button>
      </div>

      {/* Progress */}
      <div className="mt-5 grid gap-5 sm:grid-cols-3">
        {/* Monthly goal */}
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold">This month</span>
            <span className="text-sm text-ink-soft">{monthPct}%</span>
          </div>
          <div className="mt-1 text-2xl font-extrabold tracking-tight">
            {fmt(stats.leadsThisMonth)}
            <span className="text-base font-semibold text-ink-soft"> / {fmt(stats.monthlyLeadGoal)}</span>
          </div>
          <Bar value={stats.leadsThisMonth} max={stats.monthlyLeadGoal} tone="bg-brand" />
          <div className="mt-1 text-xs text-ink-soft">leads toward the monthly goal</div>
        </div>

        {/* Daily pace */}
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold">Today's pace</span>
            <span className={`text-sm ${paceMet ? "text-green-600" : "text-ink-soft"}`}>
              {paceMet ? "on track" : "catching up"}
            </span>
          </div>
          <div className="mt-1 text-2xl font-extrabold tracking-tight">
            {fmt(stats.leadsToday)}
            <span className="text-base font-semibold text-ink-soft"> / {fmt(stats.dailyTarget)}</span>
          </div>
          <Bar value={stats.leadsToday} max={stats.dailyTarget} tone={paceMet ? "bg-green-500" : "bg-amber-500"} />
          <div className="mt-1 text-xs text-ink-soft">leads added today (~{fmt(stats.dailyTarget)}/day pace)</div>
        </div>

        {/* Spend */}
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold">Apify spend</span>
            <span className={`text-sm ${overBudget ? "text-amber-600" : "text-ink-soft"}`}>
              {overBudget ? "cap reached" : "in budget"}
            </span>
          </div>
          <div className="mt-1 text-2xl font-extrabold tracking-tight">
            ${stats.spendUsd.toFixed(2)}
            <span className="text-base font-semibold text-ink-soft"> / ${stats.monthlyBudgetUsd.toFixed(0)}</span>
          </div>
          <Bar value={stats.spendUsd} max={stats.monthlyBudgetUsd} tone={overBudget ? "bg-amber-500" : "bg-brand"} />
          <div className="mt-1 text-xs text-ink-soft">this month · ~$0.02 / lead</div>
        </div>
      </div>

      {stats.lastRunSummary && (
        <div className="mt-4 rounded-xl bg-surface px-3 py-2 text-xs text-ink-soft">
          <span className="font-semibold text-ink">Last run:</span> {stats.lastRunSummary}
        </div>
      )}

      {/* Editor */}
      {editing && (
        <div className="mt-5 rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="font-semibold">Monthly lead goal</span>
              <input
                type="number"
                min={0}
                step={100}
                value={goal}
                onChange={(e) => setGoal(Number(e.target.value))}
                className="w-28 rounded-lg border border-line bg-background px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="font-semibold">Apify budget</span>
              <span className="text-ink-soft">$</span>
              <input
                type="number"
                min={0}
                step={5}
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className="w-24 rounded-lg border border-line bg-background px-2 py-1"
              />
              <span className="text-ink-soft">/ month</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <span className="font-semibold">Engine</span>
              <button
                type="button"
                onClick={() => setEnabled((v) => !v)}
                aria-pressed={enabled}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? "bg-brand" : "bg-line"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
              </button>
              <span className="text-ink-soft">{enabled ? "on" : "paused"}</span>
            </label>
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            At ~$0.02/lead, ${budget.toFixed(0)} buys ~{fmt(Math.round((budget / 0.02) || 0))} Apify leads; browser
            scraping covers the rest of the {fmt(goal)} goal. Apify's free tier caps at $5/mo — raising the budget
            above that needs a payment method on Apify.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={save}
              disabled={pending}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            {saved && !pending && <span className="text-sm text-green-600">Saved ✓</span>}
          </div>
        </div>
      )}
    </section>
  );
}
