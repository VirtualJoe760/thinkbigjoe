"use client";

import { useState, useTransition } from "react";

import { FORGE_TEMPLATES } from "@/lib/forge-templates";
import { chooseTemplate } from "./actions";

/** Lets a claimed owner switch their site's design template — re-queues a rebuild. */
export function TemplatePicker({
  siteId,
  current,
}: {
  siteId: number;
  current: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | null>(current);
  const [message, setMessage] = useState<string | null>(null);

  function pick(id: string) {
    if (pending || id === selected) return;
    setSelected(id);
    setMessage(null);
    startTransition(async () => {
      const res = await chooseTemplate(siteId, id);
      setMessage(res.message);
    });
  }

  return (
    <details className="mt-4 rounded-xl border border-line bg-background p-4">
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        🎨 Change design
      </summary>
      <p className="mt-1 text-xs text-ink-soft">
        Pick a look — we&apos;ll rebuild your site on it. Switching starts a fresh build.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {FORGE_TEMPLATES.map((t) => {
          const active = selected === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => pick(t.id)}
              disabled={pending}
              className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
                active
                  ? "border-brand bg-brand-tint"
                  : "border-line bg-surface hover:border-brand"
              }`}
            >
              <span className={`block text-sm font-semibold ${active ? "text-brand" : "text-ink"}`}>
                {t.name}
                {active ? " ✓" : ""}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-ink-soft">
                {t.description}
              </span>
            </button>
          );
        })}
      </div>
      {message && <p className="mt-3 text-sm font-medium text-brand">{message}</p>}
    </details>
  );
}
