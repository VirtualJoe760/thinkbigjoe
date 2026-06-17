"use client";

import { useState, useTransition } from "react";

import { saveAutomationSettings, type AutomationInput } from "./actions";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function SettingsForm({ initial }: { initial: AutomationInput }) {
  const [s, setS] = useState<AutomationInput>(initial);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const days = new Set(s.workDays.split(",").map((d) => d.trim()).filter(Boolean));
  function toggleDay(d: string) {
    const next = new Set(days);
    next.has(d) ? next.delete(d) : next.add(d);
    setS({ ...s, workDays: DAYS.filter((x) => next.has(x)).join(",") });
  }

  function save() {
    setSaved(false);
    start(async () => {
      await saveAutomationSettings(s);
      setSaved(true);
    });
  }

  return (
    <div className="mt-6 space-y-5">
      {/* Master switch */}
      <div className="flex items-center justify-between rounded-2xl border border-line bg-background p-5">
        <div>
          <div className="font-semibold">Automated prospecting</div>
          <div className="text-sm text-ink-soft">
            {s.enabled ? "On — the sender works your queue during working hours." : "Off — nothing is sent automatically."}
          </div>
        </div>
        <button
          onClick={() => setS({ ...s, enabled: !s.enabled })}
          aria-pressed={s.enabled}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${s.enabled ? "bg-brand" : "bg-line"}`}
        >
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${s.enabled ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>

      {/* Working hours */}
      <div className="rounded-2xl border border-line bg-background p-5">
        <div className="font-semibold">Working hours</div>
        <p className="mt-1 text-sm text-ink-soft">Sends only happen on these days, between these hours (Pacific).</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <button
              key={d}
              onClick={() => toggleDay(d)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${days.has(d) ? "bg-brand-tint text-brand" : "bg-surface text-ink-soft hover:text-ink"}`}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3 text-sm">
          <span className="text-ink-soft">From</span>
          <input type="number" min={0} max={23} value={s.workStartHour}
            onChange={(e) => setS({ ...s, workStartHour: Number(e.target.value) })}
            className="w-16 rounded-lg border border-line bg-surface px-2 py-1" />
          <span className="text-ink-soft">to</span>
          <input type="number" min={1} max={24} value={s.workEndHour}
            onChange={(e) => setS({ ...s, workEndHour: Number(e.target.value) })}
            className="w-16 rounded-lg border border-line bg-surface px-2 py-1" />
          <span className="text-ink-soft">(24h, PT)</span>
        </div>
      </div>

      {/* Daily goal + ramp */}
      <div className="rounded-2xl border border-line bg-background p-5">
        <div className="flex items-center gap-3">
          <span className="font-semibold">Daily goal</span>
          <input type="number" min={1} max={100} value={s.dailyGoal}
            onChange={(e) => setS({ ...s, dailyGoal: Number(e.target.value) })}
            className="w-20 rounded-lg border border-line bg-surface px-2 py-1 text-sm" />
          <span className="text-sm text-ink-soft">connection requests / working day</span>
        </div>

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={s.rampEnabled}
            onChange={(e) => setS({ ...s, rampEnabled: e.target.checked })} />
          <span className="font-medium">Ramp up gradually</span>
          <span className="text-ink-soft">(safer for LinkedIn — start low, increase weekly)</span>
        </label>
        {s.rampEnabled && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-ink-soft">
            <span>Start at</span>
            <input type="number" min={1} max={100} value={s.rampStart}
              onChange={(e) => setS({ ...s, rampStart: Number(e.target.value) })}
              className="w-16 rounded-lg border border-line bg-surface px-2 py-1" />
            <span>/day, add</span>
            <input type="number" min={1} max={50} value={s.rampWeeklyStep}
              onChange={(e) => setS({ ...s, rampWeeklyStep: Number(e.target.value) })}
              className="w-16 rounded-lg border border-line bg-surface px-2 py-1" />
            <span>/week until it reaches the goal.</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={pending}
          className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {pending ? "Saving…" : "Save settings"}
        </button>
        {saved && !pending && <span className="text-sm text-green-600">Saved ✓</span>}
      </div>
    </div>
  );
}
