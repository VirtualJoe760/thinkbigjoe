"use client";

import { useState, useTransition } from "react";

import { updateShowroomEngines } from "../actions";

export type ShowroomStats = {
  outreachGoal: number;
  outreachEnabled: boolean;
  previewBudget: number;
  previewEnabled: boolean;
  discovered: number;
  withPreview: number;
  sent: number;
  claimed: number;
  built: number;
  paid: number;
  draftedToday: number;
  generatedToday: number;
};

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (n: number, d: number) => (d > 0 ? Math.min(100, Math.round((n / d) * 100)) : 0);

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  return (
    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct(value, max)}%` }} />
    </div>
  );
}

function Stage({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-xl font-extrabold tracking-tight">{fmt(value)}</div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">{label}</div>
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-brand" : "bg-line"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export function ShowroomPanel({ stats, bare = false }: { stats: ShowroomStats; bare?: boolean }) {
  const [goal, setGoal] = useState(stats.outreachGoal);
  const [budget, setBudget] = useState(stats.previewBudget);
  const [oEnabled, setOEnabled] = useState(stats.outreachEnabled);
  const [pEnabled, setPEnabled] = useState(stats.previewEnabled);
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const running = stats.outreachEnabled || stats.previewEnabled;

  function save() {
    setSaved(false);
    start(async () => {
      await updateShowroomEngines({ dailyGoal: goal, dailyBudget: budget, outreachEnabled: oEnabled, previewEnabled: pEnabled });
      setSaved(true);
      setEditing(false);
    });
  }

  return (
    <section className={bare ? "" : "rounded-2xl border border-line bg-background p-5"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold tracking-tight">Showroom engine</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${running ? "bg-green-100 text-green-700" : "bg-line text-ink-soft"}`}>
              {running ? "Running" : "Paused"}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            Sell-first: generate cheap previews in paced waves, then first-touch up to the daily goal. Claims trigger the real build.
          </p>
        </div>
        <button onClick={() => setEditing((v) => !v)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink-soft hover:text-ink">
          {editing ? "Cancel" : "Adjust"}
        </button>
      </div>

      {/* Funnel */}
      <div className="mt-5 flex items-center justify-between gap-1 overflow-x-auto rounded-xl bg-surface px-3 py-4">
        <Stage label="Discovered" value={stats.discovered} />
        <span className="text-ink-soft">→</span>
        <Stage label="Preview" value={stats.withPreview} />
        <span className="text-ink-soft">→</span>
        <Stage label="Sent" value={stats.sent} />
        <span className="text-ink-soft">→</span>
        <Stage label="Claimed" value={stats.claimed} />
        <span className="text-ink-soft">→</span>
        <Stage label="Built" value={stats.built} />
        <span className="text-ink-soft">→</span>
        <Stage label="Paid" value={stats.paid} />
      </div>

      {/* Today */}
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold">Outreach today</span>
            <span className="text-sm text-ink-soft">{pct(stats.draftedToday, stats.outreachGoal)}%</span>
          </div>
          <div className="mt-1 text-2xl font-extrabold tracking-tight">
            {fmt(stats.draftedToday)}
            <span className="text-base font-semibold text-ink-soft"> / {fmt(stats.outreachGoal)}</span>
          </div>
          <Bar value={stats.draftedToday} max={stats.outreachGoal} tone="bg-brand" />
          <div className="mt-1 text-xs text-ink-soft">first-touches drafted (the goal caps daily token spend)</div>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold">Previews today</span>
            <span className="text-sm text-ink-soft">{pct(stats.generatedToday, stats.previewBudget)}%</span>
          </div>
          <div className="mt-1 text-2xl font-extrabold tracking-tight">
            {fmt(stats.generatedToday)}
            <span className="text-base font-semibold text-ink-soft"> / {fmt(stats.previewBudget)}</span>
          </div>
          <Bar value={stats.generatedToday} max={stats.previewBudget} tone="bg-green-500" />
          <div className="mt-1 text-xs text-ink-soft">previews generated (~$0.0002 each · keep budget ~1.5× goal)</div>
        </div>
      </div>

      {editing && (
        <div className="mt-5 rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="font-semibold">Daily outreach goal</span>
              <input type="number" min={0} step={5} value={goal} onChange={(e) => setGoal(Number(e.target.value))} className="w-24 rounded-lg border border-line bg-background px-2 py-1" />
              <span className="text-ink-soft">/ day</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="font-semibold">Preview wave</span>
              <input type="number" min={0} step={5} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="w-24 rounded-lg border border-line bg-background px-2 py-1" />
              <span className="text-ink-soft">/ day</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="font-semibold">Outreach</span>
              <Toggle on={oEnabled} onClick={() => setOEnabled((v) => !v)} />
              <span className="text-ink-soft">{oEnabled ? "on" : "paused"}</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="font-semibold">Previews</span>
              <Toggle on={pEnabled} onClick={() => setPEnabled((v) => !v)} />
              <span className="text-ink-soft">{pEnabled ? "on" : "paused"}</span>
            </label>
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            The outreach goal is the token dial — ~{fmt(goal)} agent drafts/day is your flat daily spend. Keep the preview wave
            around {fmt(Math.round(goal * 1.5))} so there&apos;s always fresh inventory ahead of sends.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={save} disabled={pending} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {pending ? "Saving…" : "Save"}
            </button>
            {saved && !pending && <span className="text-sm text-green-600">Saved ✓</span>}
          </div>
        </div>
      )}
    </section>
  );
}
