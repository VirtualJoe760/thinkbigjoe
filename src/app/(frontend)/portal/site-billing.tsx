"use client";

import { useActionState, useEffect, useState } from "react";

import { startCheckout, type CheckoutState } from "./actions";
import { PLANS, PLAN_KEYS, ONE_TIME_BUILD_AMOUNT, type PlanKey } from "@/lib/plans";

const initial: CheckoutState = { ok: false, message: "" };

/** Plan picker + "Activate" for a claimed-but-unpaid site → Stripe Checkout. */
export function SiteBilling({ siteId }: { siteId: number }) {
  const [plan, setPlan] = useState<PlanKey>("voice");
  const [state, action, pending] = useActionState(startCheckout, initial);

  useEffect(() => {
    if (state.url) window.location.href = state.url;
  }, [state.url]);

  return (
    <form action={action} className="mt-4">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="plan" value={plan} />

      <div className="grid gap-2">
        {PLAN_KEYS.map((k) => {
          const active = k === plan;
          return (
            <button
              type="button"
              key={k}
              onClick={() => setPlan(k)}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                active ? "border-brand bg-brand-tint" : "border-line bg-background hover:bg-surface"
              }`}
            >
              <span>
                <span className="font-semibold">{PLANS[k].label}</span>
                <span className="block text-xs text-ink-soft">{PLANS[k].blurb}</span>
              </span>
              <span className="whitespace-nowrap font-bold">${PLANS[k].monthly}/mo</span>
            </button>
          );
        })}
      </div>

      {state.message && !state.ok && (
        <p className="mt-2 text-sm font-medium text-red-600">{state.message}</p>
      )}

      <button
        type="submit"
        disabled={pending || Boolean(state.url)}
        className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
      >
        {pending || state.url
          ? "Starting checkout…"
          : `Activate — $${ONE_TIME_BUILD_AMOUNT} today + $${PLANS[plan].monthly}/mo`}
      </button>
      <p className="mt-2 text-center text-xs text-ink-soft">
        Includes a free domain. Secure checkout via Stripe · cancel anytime.
      </p>
    </form>
  );
}
