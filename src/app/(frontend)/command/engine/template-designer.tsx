"use client";

import { useState, useTransition } from "react";

import { requestTemplateDesign } from "../actions";

/**
 * Human-gated trigger for the forge template designer. brand-lead authors new design
 * languages into the forge's design-languages.json; this builds the next unbuilt one
 * into a real, structurally-distinct template (registers disabled for review).
 */
export function TemplateDesigner() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="rounded-2xl border border-line bg-background p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-tight">Template designer</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Build the next new design the Brand Lead proposed. One at a time · registers disabled for your review.
          </p>
        </div>
        <button
          onClick={() => start(async () => setMsg((await requestTemplateDesign()).message))}
          disabled={pending}
          className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Queuing…" : "Design a new template →"}
        </button>
      </div>
      {msg && <p className="mt-3 text-sm text-ink-soft">{msg}</p>}
    </div>
  );
}
