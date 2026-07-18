"use client";

import { useState, useTransition } from "react";

import { Card, cardClass } from "@/components/ui";

import { setTemplateEnabled, retireTemplate, restoreTemplate, requestTemplateFix } from "../actions";

export type TemplateRow = {
  id: string;
  dir: string;
  name: string;
  bestFor: string | null;
  enabled: boolean;
  archived?: boolean;
  previewPath: string | null;
  mood: string | null;
  composition: string[] | null;
};

type Stats = { research: number; awaiting: number; live: number };

/**
 * Visual review + lifecycle for the forge's design templates. The `templates` table is the
 * source of truth; forge-poll.mjs mirrors enabled flags into the forge's registry.json.
 * Each card can be approved/disabled, re-prompted to the forge for a rebuild (fix), or retired
 * (soft-deleted into the collapsible "Retired" tray, restorable).
 */
export function TemplateManager({
  templates,
  retired,
  stats,
}: {
  templates: TemplateRow[];
  retired: TemplateRow[];
  stats: Stats;
}) {
  const [rows, setRows] = useState(templates);
  const [tray, setTray] = useState(retired);
  const [showTray, setShowTray] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<TemplateRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [, start] = useTransition();

  const enabledCount = rows.filter((r) => r.enabled).length;
  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 6000);
  };

  function toggle(id: string, next: boolean) {
    setPendingId(id);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, enabled: next } : r)));
    start(async () => {
      const res = await setTemplateEnabled(id, next);
      if (!res.ok) setRows((rs) => rs.map((r) => (r.id === id ? { ...r, enabled: !next } : r)));
      setPendingId(null);
    });
  }

  function retire(t: TemplateRow) {
    setRows((rs) => rs.filter((r) => r.id !== t.id));
    setTray((ts) => [{ ...t, enabled: false, archived: true }, ...ts]);
    start(async () => {
      const res = await retireTemplate(t.id);
      flash(res.message);
    });
  }

  function restore(t: TemplateRow) {
    setTray((ts) => ts.filter((r) => r.id !== t.id));
    setRows((rs) => [{ ...t, archived: false, enabled: false }, ...rs]);
    start(async () => {
      const res = await restoreTemplate(t.id);
      flash(res.message);
    });
  }

  function fix(t: TemplateRow) {
    if (!confirm(`Re-prompt the forge to rebuild "${t.name}" from its design brief?\n\nThis runs on your Mac (~30 min) and uses one forge run.`)) return;
    setPendingId(t.id);
    start(async () => {
      const res = await requestTemplateFix(t.id, t.dir);
      flash(res.message);
      setPendingId(null);
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">Templates</h2>
          <p className="mt-1 text-sm text-ink-soft">
            The design library the forge picks from. Review each preview, approve it into rotation, or
            re-prompt / retire a broken one.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-ink-soft">
          {enabledCount} / {rows.length} live
        </span>
      </div>

      {msg && (
        <div className="mt-3 rounded-xl border border-brand/30 bg-brand-tint/50 px-4 py-2.5 text-sm text-brand">
          {msg}
        </div>
      )}

      {/* Pipeline flow */}
      <div className="mt-4 flex flex-wrap items-stretch gap-2">
        <FlowStep n={stats.research} label="In research" sub="design reports proposed" tone="neutral" />
        <Arrow />
        <FlowStep n={stats.awaiting} label="Awaiting review" sub="built · not yet approved" tone={stats.awaiting > 0 ? "amber" : "neutral"} />
        <Arrow />
        <FlowStep n={stats.live} label="In rotation" sub="live for new builds" tone="brand" />
      </div>

      {/* Gallery */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((t) => (
          <div
            key={t.id}
            className={`flex flex-col overflow-hidden rounded-xl border bg-surface transition-colors ${
              t.enabled ? "border-line" : "border-amber-300 ring-1 ring-amber-200"
            }`}
          >
            <button
              type="button"
              onClick={() => t.previewPath && setZoom(t)}
              className="group relative block h-40 w-full overflow-hidden bg-background"
              aria-label={t.previewPath ? `Enlarge ${t.name} preview` : t.name}
            >
              {t.previewPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.previewPath} alt={`${t.name} template preview`} loading="lazy" className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]" />
              ) : (
                <div className="grid h-full w-full place-items-center text-xs text-ink-soft">No preview</div>
              )}
              {!t.enabled && (
                <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow">
                  Needs review
                </span>
              )}
              {t.previewPath && (
                <span className="absolute bottom-2 right-2 rounded-md bg-ink/70 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                  ⤢ enlarge
                </span>
              )}
            </button>

            <div className="flex flex-1 flex-col p-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold tracking-tight">{t.name}</span>
                <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">{t.id}</span>
              </div>
              {t.mood && <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-ink-soft">{t.mood}</p>}
              {t.bestFor && (
                <p className="mt-2 line-clamp-1 text-[11px] text-ink-soft">
                  <span className="font-semibold text-ink">Best for:</span> {t.bestFor}
                </p>
              )}
              {t.composition && t.composition.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.composition.slice(0, 6).map((s, i) => (
                    <span key={i} className="rounded bg-background px-1.5 py-0.5 text-[10px] text-ink-soft">{s}</span>
                  ))}
                </div>
              )}
              <div className="mt-auto pt-3">
                <button
                  type="button"
                  onClick={() => toggle(t.id, !t.enabled)}
                  disabled={pendingId === t.id}
                  className={`w-full rounded-full px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    t.enabled ? "bg-green-100 text-green-800 hover:bg-green-200" : "bg-brand text-white hover:bg-brand-dark"
                  }`}
                >
                  {pendingId === t.id ? "…" : t.enabled ? "Live ✓ — click to disable" : "Approve → add to rotation"}
                </button>
                <div className="mt-2 flex items-center justify-center gap-4 text-[11px]">
                  <button type="button" onClick={() => fix(t)} disabled={pendingId === t.id} className="font-semibold text-ink-soft transition-colors hover:text-brand disabled:opacity-50">
                    ↻ Reprompt to fix
                  </button>
                  <span className="text-line">·</span>
                  <button type="button" onClick={() => retire(t)} className="font-semibold text-ink-soft transition-colors hover:text-red-600">
                    🗑 Retire
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Retired tray */}
      {tray.length > 0 && (
        <div className={cardClass({ radius: "xl", tone: "surface", padding: "sm", className: "mt-5" })}>
          <button type="button" onClick={() => setShowTray((s) => !s)} className="flex w-full items-center justify-between text-sm font-semibold text-ink-soft">
            <span>Retired ({tray.length})</span>
            <span>{showTray ? "Hide" : "Show"}</span>
          </button>
          {showTray && (
            <div className="mt-3 space-y-2">
              {tray.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-background px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-sm font-medium text-ink-soft line-through">{t.name}</span>
                    <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">{t.id}</span>
                  </div>
                  <button type="button" onClick={() => restore(t)} className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface hover:text-ink">
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lightbox */}
      {zoom && zoom.previewPath && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm" onClick={() => setZoom(null)}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
              <div className="min-w-0">
                <p className="font-bold tracking-tight">{zoom.name}</p>
                {zoom.mood && <p className="mt-0.5 line-clamp-1 text-xs text-ink-soft">{zoom.mood}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => { toggle(zoom.id, !zoom.enabled); setZoom({ ...zoom, enabled: !zoom.enabled }); }} className={`rounded-full px-4 py-1.5 text-xs font-semibold ${zoom.enabled ? "bg-green-100 text-green-800" : "bg-brand text-white hover:bg-brand-dark"}`}>
                  {zoom.enabled ? "Live ✓" : "Approve →"}
                </button>
                <button type="button" onClick={() => setZoom(null)} className="grid h-8 w-8 place-items-center rounded-lg text-ink-soft hover:bg-surface" aria-label="Close">✕</button>
              </div>
            </div>
            <div className="overflow-y-auto bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={zoom.previewPath} alt={`${zoom.name} full preview`} className="w-full" />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function FlowStep({ n, label, sub, tone }: { n: number; label: string; sub: string; tone: "neutral" | "amber" | "brand" }) {
  const toneCls =
    tone === "amber" ? "border-amber-300 bg-amber-50" : tone === "brand" ? "border-brand/30 bg-brand-tint/50" : "border-line bg-surface";
  const numCls = tone === "amber" ? "text-amber-700" : tone === "brand" ? "text-brand" : "text-ink";
  return (
    <div className={`min-w-[120px] flex-1 rounded-xl border p-3 ${toneCls}`}>
      <div className={`text-2xl font-extrabold tabular-nums ${numCls}`}>{n}</div>
      <div className="mt-0.5 text-xs font-semibold tracking-tight text-ink">{label}</div>
      <div className="text-[11px] text-ink-soft">{sub}</div>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center self-center text-ink-soft" aria-hidden>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </div>
  );
}
