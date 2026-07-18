"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";

import {
  checkDomain,
  registerFreeDomain,
  startDomainCheckout,
  type DomainCheckState,
  type DomainRegisterState,
  type DomainCheckoutState,
} from "../actions";
import { cardClass } from "@/components/ui";

const checkInit: DomainCheckState = { ok: false, message: "" };
const regInit: DomainRegisterState = { ok: false, message: "" };
const buyInit: DomainCheckoutState = { ok: false, message: "" };

export function DomainForm() {
  const [check, checkAction, checking] = useActionState(checkDomain, checkInit);
  const [reg, regAction, registering] = useActionState(registerFreeDomain, regInit);
  const [buy, buyAction, buying] = useActionState(startDomainCheckout, buyInit);

  useEffect(() => {
    if (buy.url) window.location.href = buy.url;
  }, [buy.url]);

  // Registered successfully → done.
  if (reg.ok) {
    return (
      <div className="rounded-2xl border border-brand bg-brand-tint p-8">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">Domain claimed</p>
        <p className="mt-2 text-ink-soft">{reg.message}</p>
        <Link
          href="/portal"
          className="mt-6 inline-flex items-center justify-center rounded-full border border-line bg-background px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface"
        >
          Back to your portal
        </Link>
      </div>
    );
  }

  const showResult = check.ok && check.domain;

  return (
    <div className="space-y-4">
      {/* Step 1 — search */}
      <form action={checkAction} className={cardClass({ tone: "surface", padding: "xl" })}>
        <label htmlFor="domain" className="block text-sm font-semibold text-ink">
          The domain you want
        </label>
        <p className="mt-1 text-sm text-ink-soft">We'll check if it's available.</p>
        <div className="mt-4 flex gap-2">
          <input
            id="domain"
            name="domain"
            autoFocus
            defaultValue={check.domain || ""}
            placeholder="yourbusiness.com"
            className="min-w-0 flex-1 rounded-xl border border-line bg-background px-4 py-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          <button
            type="submit"
            disabled={checking}
            className="rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-60"
          >
            {checking ? "Checking…" : "Check"}
          </button>
        </div>
        {check.message && !showResult && (
          <p className={`mt-3 text-sm font-medium ${check.ok ? "text-ink-soft" : "text-red-600"}`}>
            {check.message}
          </p>
        )}
      </form>

      {/* Step 2 — result */}
      {showResult && !check.available && (
        <div className={cardClass({ tone: "surface", padding: "lg" })}>
          <p className="text-sm font-medium text-ink">
            <span className="font-mono">{check.domain}</span> isn't available — try another above.
          </p>
        </div>
      )}

      {showResult && check.available && check.hasCredit && (
        <form action={regAction} className="rounded-2xl border border-brand bg-brand-tint p-6">
          <input type="hidden" name="domain" value={check.domain} />
          <p className="text-sm font-semibold text-brand">
            ✓ <span className="font-mono">{check.domain}</span> is available — free with your credit
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            Registered for a year and connected to your site, on us.
          </p>
          {reg.message && !reg.ok && (
            <p className="mt-2 text-sm font-medium text-red-600">{reg.message}</p>
          )}
          <button
            type="submit"
            disabled={registering}
            className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60 sm:w-auto"
          >
            {registering ? "Registering…" : `Register ${check.domain} free`}
          </button>
        </form>
      )}

      {showResult && check.available && !check.hasCredit && (
        <form action={buyAction} className={cardClass({ tone: "surface", padding: "lg" })}>
          <input type="hidden" name="domain" value={check.domain} />
          <p className="text-sm font-medium text-ink">
            <span className="font-mono">{check.domain}</span> is available for{" "}
            <span className="font-bold">${check.total?.toFixed(2)}</span>
            <span className="text-ink-soft"> (domain + $3.99 service fee)</span>.
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            Registered for a year and connected to your site.
          </p>
          {buy.message && !buy.ok && (
            <p className="mt-2 text-sm font-medium text-red-600">{buy.message}</p>
          )}
          <button
            type="submit"
            disabled={buying || Boolean(buy.url)}
            className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60 sm:w-auto"
          >
            {buying || buy.url ? "Starting checkout…" : `Buy ${check.domain} — $${check.total?.toFixed(2)}`}
          </button>
        </form>
      )}
    </div>
  );
}
