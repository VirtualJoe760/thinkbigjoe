"use client";

import { useActionState } from "react";
import Link from "next/link";

import { requestRebuild, type RebuildState } from "../actions";

const initial: RebuildState = { ok: false, message: "" };

export function RebuildForm() {
  const [state, action, pending] = useActionState(requestRebuild, initial);

  if (state.ok) {
    return (
      <div className="rounded-2xl border border-brand bg-brand-tint p-8">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">
          Request received
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">You're in the queue.</h2>
        <p className="mt-2 text-ink-soft">{state.message}</p>
        <Link
          href="/portal"
          className="mt-6 inline-flex items-center justify-center rounded-full border border-line bg-background px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface"
        >
          Back to your portal
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="rounded-2xl border border-line bg-surface p-8">
      <label htmlFor="url" className="block text-sm font-semibold text-ink">
        Your current website
      </label>
      <input
        id="url"
        name="url"
        autoFocus
        placeholder="yourbusiness.com"
        className="mt-2 w-full rounded-xl border border-line bg-background px-4 py-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
      />

      <label htmlFor="businessName" className="mt-5 block text-sm font-semibold text-ink">
        Business name <span className="font-normal text-ink-soft">(optional)</span>
      </label>
      <input
        id="businessName"
        name="businessName"
        placeholder="Acme Plumbing"
        className="mt-2 w-full rounded-xl border border-line bg-background px-4 py-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
      />

      <label htmlFor="notes" className="mt-5 block text-sm font-semibold text-ink">
        Anything we should know? <span className="font-normal text-ink-soft">(optional)</span>
      </label>
      <textarea
        id="notes"
        name="notes"
        rows={3}
        placeholder="Pages to keep, what you'd change, etc."
        className="mt-2 w-full rounded-xl border border-line bg-background px-4 py-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
      />

      {state.message && !state.ok && (
        <p className="mt-3 text-sm font-medium text-red-600">{state.message}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Submitting…" : "Request my rebuild"}
      </button>
    </form>
  );
}
