"use client";

import { useState, useTransition } from "react";

import { syncContactsToGoogleAction } from "./actions";

/**
 * Admin control to push TBJ's engaged contacts into Google Contacts on demand. The cron keeps it up
 * to date on its own; this is the "do it now" button + a place to see the result.
 */
export function SyncContactsCard({ group, connected }: { group: string; connected: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-bold tracking-tight">Sync contacts to Google Contacts</h3>
          <p className="mt-2 max-w-xl leading-relaxed text-ink-soft">
            Adds everyone you&apos;re actually in touch with — anyone who replied, booked, or became a
            client — into your Google Contacts under <span className="font-semibold text-ink">“{group}”</span>,
            so they&apos;re on your phone. Cold, never-contacted prospects stay out. Runs automatically;
            use this to sync right now.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!connected || pending}
          onClick={() =>
            start(async () => {
              const r = await syncContactsToGoogleAction();
              setMsg({ ok: r.ok, text: r.message });
            })
          }
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Syncing…" : "Sync now"}
        </button>
        {!connected && <span className="text-sm text-ink-soft">Connect Google Contacts above first.</span>}
        {msg && (
          <span className={`text-sm font-medium ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>
            {msg.ok ? "✓ " : ""}
            {msg.text}
          </span>
        )}
      </div>
    </section>
  );
}
