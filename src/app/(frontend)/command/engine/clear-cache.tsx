"use client";

import { useState, useTransition } from "react";

import { resetStuckBuilds } from "../actions";

export function ClearBuildCache() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    start(async () => {
      const r = await resetStuckBuilds();
      setMsg(r.message);
      setTimeout(() => setMsg(null), 6000);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={run}
        disabled={pending}
        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:text-ink disabled:opacity-50"
      >
        {pending ? "Clearing…" : "🧹 Clear stuck builds"}
      </button>
      {msg && <span className="text-sm font-medium text-brand">{msg}</span>}
    </div>
  );
}
