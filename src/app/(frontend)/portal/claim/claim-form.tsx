"use client";

import { useActionState } from "react";
import Link from "next/link";

import { claimSite, type ClaimState } from "../actions";

const initial: ClaimState = { ok: false, message: "" };

export function ClaimForm() {
  const [state, action, pending] = useActionState(claimSite, initial);

  if (state.ok && state.site) {
    return (
      <div className="rounded-2xl border border-brand bg-brand-tint p-8">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">
          Site claimed
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">
          {state.site.businessName} is yours.
        </h2>
        <p className="mt-2 text-ink-soft">{state.message}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          {state.site.liveUrl && (
            <a
              href={state.site.liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
            >
              View your site →
            </a>
          )}
          <Link
            href="/portal"
            className="inline-flex items-center justify-center rounded-full border border-line bg-background px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface"
          >
            Go to your portal
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="rounded-2xl border border-line bg-surface p-8">
      <label htmlFor="code" className="block text-sm font-semibold text-ink">
        Claim code
      </label>
      <p className="mt-1 text-sm text-ink-soft">
        Enter the code from your welcome email — it looks like{" "}
        <span className="font-mono font-semibold">TBJ-XXXX-XXXX</span>.
      </p>
      <input
        id="code"
        name="code"
        autoFocus
        autoComplete="off"
        placeholder="TBJ-••••-••••"
        className="mt-4 w-full rounded-xl border border-line bg-background px-4 py-3 font-mono text-lg tracking-wide uppercase focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
      {state.message && !state.ok && (
        <p className="mt-3 text-sm font-medium text-red-600">{state.message}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Claiming…" : "Claim my site"}
      </button>
    </form>
  );
}
