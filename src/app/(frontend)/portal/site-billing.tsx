"use client";

import { useActionState, useEffect, useState } from "react";

import { startCheckout, type CheckoutState } from "./actions";
import { PLANS, PLAN_KEYS, ONE_TIME_BUILD_AMOUNT, firstMonthFree, type PlanKey, type BillingInterval } from "@/lib/plans";

const initial: CheckoutState = { ok: false, message: "" };

/** Plan picker + billing-interval toggle + "Activate" for a claimed-but-unpaid site → Stripe Checkout. */
export function SiteBilling({ siteId }: { siteId: number }) {
  const [plan, setPlan] = useState<PlanKey>("voice");
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [state, action, pending] = useActionState(startCheckout, initial);

  useEffect(() => {
    if (state.url) window.location.href = state.url;
  }, [state.url]);

  const yearly = interval === "year";
  const priceOf = (k: PlanKey) => (yearly ? `$${PLANS[k].annual.toLocaleString()}/yr` : `$${PLANS[k].monthly}/mo`);
  const recurring = yearly ? `$${PLANS[plan].annual.toLocaleString()}/yr` : `$${PLANS[plan].monthly}/mo`;
  // Basic (Website) = first month free, so only the $300 build is due today. Other tiers are charged
  // their first period up front (build + first month/year).
  const dueLabel = firstMonthFree(plan)
    ? `$${ONE_TIME_BUILD_AMOUNT} today · first month free, then ${recurring}`
    : `$${(ONE_TIME_BUILD_AMOUNT + (yearly ? PLANS[plan].annual : PLANS[plan].monthly)).toLocaleString()} today, then ${recurring}`;

  return (
    <form action={action} className="mt-4">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="interval" value={interval} />

      {/* Billing interval */}
      <div className="mb-3 inline-flex rounded-full border border-line bg-background p-1 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setInterval("month")}
          className={`rounded-full px-3 py-1 transition-colors ${!yearly ? "bg-brand text-white" : "text-ink-soft hover:text-ink"}`}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => setInterval("year")}
          className={`rounded-full px-3 py-1 transition-colors ${yearly ? "bg-brand text-white" : "text-ink-soft hover:text-ink"}`}
        >
          Yearly <span className={yearly ? "text-white/80" : "text-brand"}>· save ~2 mo</span>
        </button>
      </div>

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
              <span className="whitespace-nowrap font-bold">{priceOf(k)}</span>
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
        {pending || state.url ? "Starting checkout…" : `Activate — ${dueLabel}`}
      </button>
      <p className="mt-2 text-center text-xs text-ink-soft">
        Includes a free domain. Secure checkout · cancel anytime.
      </p>
    </form>
  );
}
