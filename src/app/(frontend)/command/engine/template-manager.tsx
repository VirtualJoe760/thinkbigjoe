"use client";

import { useState, useTransition } from "react";

import { setTemplateEnabled } from "../actions";

export type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  bestFor: string | null;
  enabled: boolean;
};

/**
 * Review + approve the design templates the forge can use. The `templates` table is
 * the source of truth; toggling here flips `enabled`, and forge-poll.mjs mirrors it
 * into the forge's registry.json on its next tick (so the change reaches builds).
 */
export function TemplateManager({ templates }: { templates: TemplateRow[] }) {
  const [rows, setRows] = useState(templates);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();

  const enabledCount = rows.filter((r) => r.enabled).length;

  function toggle(id: string, next: boolean) {
    setPendingId(id);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, enabled: next } : r)));
    start(async () => {
      const res = await setTemplateEnabled(id, next);
      if (!res.ok) setRows((rs) => rs.map((r) => (r.id === id ? { ...r, enabled: !next } : r)));
      setPendingId(null);
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-background p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">Templates</h2>
          <p className="mt-1 text-sm text-ink-soft">
            The design library the forge picks from. Approve (enable) reviewed templates; disable to
            pull one out of rotation. Takes effect on the forge&apos;s next poll.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-ink-soft">
          {enabledCount} / {rows.length} enabled
        </span>
      </div>

      <div className="mt-4 divide-y divide-line">
        {rows.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold tracking-tight">{t.name}</span>
                <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">
                  {t.id}
                </span>
              </div>
              {t.bestFor && (
                <p className="mt-0.5 line-clamp-1 text-xs text-ink-soft">Best for: {t.bestFor}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => toggle(t.id, !t.enabled)}
              disabled={pendingId === t.id}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                t.enabled
                  ? "bg-green-100 text-green-800 hover:bg-green-200"
                  : "border border-line bg-background text-ink-soft hover:bg-surface"
              }`}
            >
              {pendingId === t.id ? "…" : t.enabled ? "Enabled ✓" : "Disabled — approve"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
