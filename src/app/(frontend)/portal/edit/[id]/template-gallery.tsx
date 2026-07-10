"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { FORGE_TEMPLATES } from "@/lib/forge-templates";
import { chooseTemplate } from "../../actions";

// Templates that have a preview screenshot bundled in /public/templates/.
const HAS_PREVIEW = new Set(["bold-trades", "clean-corporate", "friendly-local", "modern-tech", "premium-service"]);

/** Review the design templates and switch — applying re-queues a rebuild on the new design. */
export function TemplateGallery({ siteId, current }: { siteId: number; current: string | null }) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | null>(current);
  const [message, setMessage] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null); // full-screen preview sheet
  const [activeIdx, setActiveIdx] = useState(0);                    // carousel page (mobile dots)
  const trackRef = useRef<HTMLDivElement>(null);
  const previewT = FORGE_TEMPLATES.find((t) => t.id === previewId) || null;

  // Preview sheet is a modal: close on Escape while it's open (backdrop + ✕ already close it).
  useEffect(() => {
    if (!previewId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPreviewId(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [previewId]);

  function onScroll() {
    const el = trackRef.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    const step = card.getBoundingClientRect().width + 16; // card + gap-4
    setActiveIdx(Math.max(0, Math.min(FORGE_TEMPLATES.length - 1, Math.round(el.scrollLeft / step))));
  }

  function apply(id: string) {
    if (pending || id === selected) return;
    setSelected(id);
    setMessage(null);
    startTransition(async () => {
      const res = await chooseTemplate(siteId, id);
      setMessage(res.message);
    });
  }

  return (
    <div className={`min-h-0 flex-1 bg-surface p-6 ${previewT ? "overflow-hidden" : "overflow-y-auto"}`}>
      <div className="mx-auto max-w-5xl">
        <h2 className="text-xl font-bold tracking-tight">Choose your design</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Review a template and apply it — we&apos;ll rebuild your site on the new design (takes a few minutes). Your
          content carries over.
        </p>
        {message && (
          <p className="mt-3 rounded-xl border border-brand/40 bg-brand-tint px-4 py-2 text-sm font-medium text-brand">
            {message}
          </p>
        )}

        {/* Swipeable snap-carousel on phones (with page dots), a grid on larger screens. */}
        <div
          ref={trackRef}
          onScroll={onScroll}
          className="-mx-6 mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 md:mx-0 md:grid md:grid-cols-2 md:gap-5 md:overflow-visible md:px-0 lg:grid-cols-3"
        >
          {FORGE_TEMPLATES.map((t) => {
            const active = selected === t.id;
            return (
              <div
                key={t.id}
                className={`w-[82vw] shrink-0 snap-center overflow-hidden rounded-2xl border bg-background md:w-auto md:shrink ${active ? "border-brand ring-2 ring-brand/30" : "border-line"}`}
              >
                <button
                  type="button"
                  onClick={() => setPreviewId(t.id)}
                  className="block aspect-[3/4] w-full overflow-hidden bg-surface text-left"
                  aria-label={`Preview ${t.name}`}
                >
                  {HAS_PREVIEW.has(t.id) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/templates/${t.id}.jpg`} alt={t.name} className="h-full w-full object-cover object-top" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-ink text-lg font-bold text-white">
                      {t.name}
                    </div>
                  )}
                </button>
                <div className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{t.name}</h3>
                    {active && (
                      <span className="shrink-0 rounded-full bg-brand-tint px-2 py-0.5 text-xs font-semibold text-brand">Current</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">{t.description}</p>
                  <p className="mt-1 text-[11px] leading-snug text-ink-soft/70">Best for: {t.bestFor}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setPreviewId(t.id)}
                      className="rounded-full border border-line px-3 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-surface md:hidden"
                    >
                      Preview
                    </button>
                    <button
                      onClick={() => apply(t.id)}
                      disabled={pending || active}
                      className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
                        active ? "border border-line text-ink-soft" : "bg-brand text-white hover:bg-brand-dark"
                      }`}
                    >
                      {active ? "Current design" : pending ? "Applying…" : "Apply this design"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Page dots — carousel position (mobile only) */}
        <div className="mt-3 flex justify-center gap-1.5 md:hidden">
          {FORGE_TEMPLATES.map((t, i) => (
            <span key={t.id} className={`h-1.5 rounded-full transition-all ${i === activeIdx ? "w-4 bg-brand" : "w-1.5 bg-line"}`} />
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-line bg-background p-6 text-center">
          <p className="font-semibold">Want something totally custom?</p>
          <p className="mt-1 text-sm text-ink-soft">
            We can hand-build a bespoke design just for your business — just ask and we&apos;ll take it from here.
          </p>
        </div>
      </div>

      {/* Full-screen preview sheet (mobile) / centered modal (desktop) */}
      {previewT && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${previewT.name} preview`}
          className="fixed inset-0 z-50 flex flex-col bg-background md:items-center md:justify-center md:bg-black/50 md:p-6"
          onClick={() => setPreviewId(null)}
        >
          <div
            className="flex min-h-0 flex-1 flex-col bg-background md:h-auto md:max-h-[86vh] md:w-full md:max-w-md md:overflow-hidden md:rounded-2xl md:border md:border-line md:shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate font-bold tracking-tight">{previewT.name}</h3>
                <p className="truncate text-xs text-ink-soft">{previewT.description}</p>
              </div>
              <button onClick={() => setPreviewId(null)} aria-label="Close" autoFocus className="shrink-0 rounded-full p-1.5 text-ink-soft hover:bg-surface">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
              {HAS_PREVIEW.has(previewT.id) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/templates/${previewT.id}.jpg`} alt={previewT.name} className="w-full" />
              ) : (
                <div className="flex aspect-[3/4] w-full items-center justify-center bg-ink text-2xl font-bold text-white">{previewT.name}</div>
              )}
              <p className="px-4 py-3 text-sm text-ink-soft">Best for: {previewT.bestFor}</p>
            </div>
            <div className="border-t border-line p-4" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
              <button
                onClick={() => { apply(previewT.id); setPreviewId(null); }}
                disabled={pending || selected === previewT.id}
                className="w-full rounded-full bg-brand px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
              >
                {selected === previewT.id ? "Current design" : pending ? "Applying…" : "Apply this design"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
