"use client";

import { useState, useTransition } from "react";

import { FORGE_TEMPLATES } from "@/lib/forge-templates";
import { chooseTemplate } from "../../actions";

// Templates that have a preview screenshot bundled in /public/templates/.
const HAS_PREVIEW = new Set(["bold-trades", "clean-corporate", "friendly-local", "modern-tech", "premium-service"]);

/** Review the design templates and switch — applying re-queues a rebuild on the new design. */
export function TemplateGallery({ siteId, current }: { siteId: number; current: string | null }) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | null>(current);
  const [message, setMessage] = useState<string | null>(null);

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
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface p-6">
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

        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FORGE_TEMPLATES.map((t) => {
            const active = selected === t.id;
            return (
              <div
                key={t.id}
                className={`overflow-hidden rounded-2xl border bg-background ${active ? "border-brand ring-2 ring-brand/30" : "border-line"}`}
              >
                <div className="aspect-[3/4] w-full overflow-hidden bg-surface">
                  {HAS_PREVIEW.has(t.id) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/templates/${t.id}.jpg`} alt={t.name} className="h-full w-full object-cover object-top" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-ink text-lg font-bold text-white">
                      {t.name}
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{t.name}</h3>
                    {active && (
                      <span className="shrink-0 rounded-full bg-brand-tint px-2 py-0.5 text-xs font-semibold text-brand">Current</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">{t.description}</p>
                  <p className="mt-1 text-[11px] leading-snug text-ink-soft/70">Best for: {t.bestFor}</p>
                  <button
                    onClick={() => apply(t.id)}
                    disabled={pending || active}
                    className={`mt-3 w-full rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
                      active ? "border border-line text-ink-soft" : "bg-brand text-white hover:bg-brand-dark"
                    }`}
                  >
                    {active ? "Current design" : pending ? "Applying…" : "Apply this design"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 rounded-2xl border border-line bg-background p-6 text-center">
          <p className="font-semibold">Want something totally custom?</p>
          <p className="mt-1 text-sm text-ink-soft">
            We can hand-build a bespoke design just for your business — just ask and we&apos;ll take it from here.
          </p>
        </div>
      </div>
    </div>
  );
}
