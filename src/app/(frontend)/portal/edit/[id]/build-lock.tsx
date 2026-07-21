"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * The editor's locked state while a build is applying this site's last batch of edits.
 *
 * One batch = one build: letting more edits queue mid-build would apply them against a moving
 * target (the forge is rewriting the site source right now). So the workspace swaps to this
 * screen, polls the pending-build check, and reloads itself into the editor the moment the
 * build lands — no manual refresh needed.
 */
export function BuildLock({ siteId, businessName, liveUrl }: { siteId: number; businessName: string; liveUrl: string | null }) {
  const [checking, setChecking] = useState(false);
  const [dots, setDots] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setDots((d) => (d + 1) % 4), 600);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const res = await fetch(`/api/edit-requests?siteId=${siteId}`, { credentials: "include" });
        const j = (await res.json()) as { ok?: boolean; pending?: boolean };
        if (!stop && j.ok && j.pending === false) window.location.reload();
      } catch {
        /* transient — next poll retries */
      }
    }
    const iv = setInterval(poll, 20_000);
    return () => { stop = true; clearInterval(iv); };
  }, [siteId]);

  async function checkNow() {
    setChecking(true);
    try {
      const res = await fetch(`/api/edit-requests?siteId=${siteId}`, { credentials: "include" });
      const j = (await res.json()) as { ok?: boolean; pending?: boolean };
      if (j.ok && j.pending === false) { window.location.reload(); return; }
    } catch { /* fall through to the message below */ }
    setChecking(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background px-6 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-tint text-3xl" aria-hidden>
        🔨
      </span>
      <h1 className="mt-6 text-2xl font-extrabold tracking-tight">
        Building your changes{".".repeat(dots)}
      </h1>
      <p className="mt-3 max-w-md leading-relaxed text-ink-soft">
        We&apos;re applying your last batch of edits to <span className="font-semibold text-ink">{businessName}</span>.
        Builds usually take <span className="font-semibold text-ink">5–15 minutes</span>. Editing is locked until
        your updated site is live — this page unlocks itself automatically.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={checkNow}
          disabled={checking}
          className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
        >
          {checking ? "Checking…" : "Check again now"}
        </button>
        <Link
          href="/portal"
          className="inline-flex items-center justify-center rounded-full border border-line bg-background px-6 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface"
        >
          Back to portal
        </Link>
      </div>
      {liveUrl && (
        <p className="mt-6 text-xs text-ink-soft">
          The finished result goes live at{" "}
          <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="text-brand underline">
            {liveUrl.replace(/^https?:\/\//, "")}
          </a>.
        </p>
      )}
    </div>
  );
}
