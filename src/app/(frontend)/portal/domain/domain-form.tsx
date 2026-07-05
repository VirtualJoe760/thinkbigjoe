"use client";

import { useActionState } from "react";
import Link from "next/link";

import { requestDomain, type DomainState } from "../actions";

const initial: DomainState = { ok: false, message: "" };

export function DomainForm() {
  const [state, action, pending] = useActionState(requestDomain, initial);

  if (state.ok) {
    return (
      <div className="rounded-2xl border border-brand bg-brand-tint p-8">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">On it</p>
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
      <label htmlFor="domain" className="block text-sm font-semibold text-ink">
        The domain you want
      </label>
      <p className="mt-1 text-sm text-ink-soft">
        New or one you already own — we'll register or transfer it and point it at
        your site.
      </p>
      <input
        id="domain"
        name="domain"
        autoFocus
        placeholder="yourbusiness.com"
        className="mt-4 w-full rounded-xl border border-line bg-background px-4 py-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
      {state.message && !state.ok && (
        <p className="mt-3 text-sm font-medium text-red-600">{state.message}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Submitting…" : "Use my free domain"}
      </button>
    </form>
  );
}
