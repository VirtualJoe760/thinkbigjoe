"use client";

import { useActionState, useEffect, useState } from "react";

import { startCheckout, type CheckoutState } from "./actions";
import {
  PLANS, PLAN_KEYS, ONE_TIME_BUILD_AMOUNT, WEBSITE_FIRST_MONTH_CREDIT, firstMonthCouponFor,
  type PlanKey, type BillingInterval,
} from "@/lib/plans";

const initial: CheckoutState = { ok: false, message: "" };

// Plugins are the next thing customers will be able to add. Shown as a teaser now so the billing
// flow already reads as "website + subscription + add-ons".
const COMING_SOON_PLUGINS = [
  { name: "User authentication", icon: "M12 11c1.66 0 3-1.34 3-3S13.66 5 12 5 9 6.34 9 8s1.34 3 3 3zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" },
  { name: "Database schemas", icon: "M12 3C7.58 3 4 4.79 4 7s3.58 4 8 4 8-1.79 8-4-3.58-4-8-4zM4 9v3c0 2.21 3.58 4 8 4s8-1.79 8-4V9c0 2.21-3.58 4-8 4s-8-1.79-8-4zm0 5v3c0 2.21 3.58 4 8 4s8-1.79 8-4v-3c0 2.21-3.58 4-8 4s-8-1.79-8-4z" },
  { name: "Pay on my site", icon: "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z" },
];

/**
 * Guided activation for a claimed-but-unpaid site: pay the one-time setup fee (which unlocks a
 * subscription + a free domain), pick the subscription tier, preview the plugins to come, and see
 * exactly what's due today → Stripe Checkout.
 *
 * Every dollar figure here reads from src/lib/plans.ts — including whether the legacy $99
 * first-month credit applies — so the quote on screen can't drift from what Stripe charges.
 */
export function SiteBilling({ siteId }: { siteId: number }) {
  // Seed from PLAN_KEYS, never a hard-coded key: the old default was "website", a RETIRED tier that
  // PLAN_KEYS no longer contains — so no radio rendered selected but the hidden input still
  // submitted plan="website" for anyone who clicked straight through to checkout.
  const [plan, setPlan] = useState<PlanKey>(PLAN_KEYS[0] ?? "answer");
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [state, action, pending] = useActionState(startCheckout, initial);

  useEffect(() => {
    if (state.url) window.location.href = state.url;
  }, [state.url]);

  const yearly = interval === "year";
  const period = yearly ? "year" : "month";
  const priceOf = (k: PlanKey) => (yearly ? PLANS[k].annual : PLANS[k].monthly);
  const firstPeriod = priceOf(plan);
  // Quote the credit ONLY when checkout will actually attach the coupon. The gate lives in
  // plans.ts so the number on screen and the number Stripe charges can't diverge — quoting a
  // discount Stripe won't apply is a customer-facing lie at the moment of payment.
  const hasCredit = firstMonthCouponFor(plan) !== null;
  const credit = hasCredit ? Math.min(WEBSITE_FIRST_MONTH_CREDIT, firstPeriod + ONE_TIME_BUILD_AMOUNT) : 0;
  const dueToday = ONE_TIME_BUILD_AMOUNT + firstPeriod - credit;
  const recurring = `$${priceOf(plan).toLocaleString()}/${yearly ? "yr" : "mo"}`;
  const money = (n: number) => `$${n.toLocaleString()}`;

  const stepNum = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white";

  return (
    <form action={action} className="mt-4 space-y-6">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="interval" value={interval} />

      {/* Step 1 — one-time setup (NOT a website — that's a separate call-Ivy purchase now) */}
      <section>
        <div className="flex items-center gap-2">
          <span className={stepNum}>1</span>
          <h3 className="text-sm font-bold">One-time setup</h3>
        </div>
        <div className="mt-2 flex items-center justify-between rounded-xl border border-line bg-background px-4 py-3">
          <span>
            <span className="font-semibold">Setup fee</span>
            <span className="block text-xs text-ink-soft">One-time — activates your subscription and a free domain.</span>
          </span>
          <span className="whitespace-nowrap font-bold">{money(ONE_TIME_BUILD_AMOUNT)}</span>
        </div>
      </section>

      {/* Step 2 — the subscription */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={stepNum}>2</span>
            <h3 className="text-sm font-bold">Choose your subscription</h3>
          </div>
          <div className="inline-flex rounded-full border border-line bg-background p-1 text-xs font-semibold">
            <button type="button" onClick={() => setInterval("month")} className={`rounded-full px-3 py-1 transition-colors ${!yearly ? "bg-brand text-white" : "text-ink-soft hover:text-ink"}`}>Monthly</button>
            <button type="button" onClick={() => setInterval("year")} className={`rounded-full px-3 py-1 transition-colors ${yearly ? "bg-brand text-white" : "text-ink-soft hover:text-ink"}`}>Yearly <span className={yearly ? "text-white/80" : "text-brand"}>· save ~2 mo</span></button>
          </div>
        </div>

        <div className="mt-2 grid gap-2">
          {PLAN_KEYS.map((k) => {
            const active = k === plan;
            return (
              <button
                type="button"
                key={k}
                onClick={() => setPlan(k)}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${active ? "border-brand bg-brand-tint ring-1 ring-brand" : "border-line bg-background hover:bg-surface"}`}
              >
                <span className="flex items-center gap-3">
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${active ? "border-brand" : "border-line"}`}>
                    {active && <span className="h-2 w-2 rounded-full bg-brand" />}
                  </span>
                  <span>
                    <span className="font-semibold">{PLANS[k].label}</span>
                    <span className="block text-xs text-ink-soft">{PLANS[k].blurb}</span>
                  </span>
                </span>
                <span className="whitespace-nowrap font-bold">${priceOf(k).toLocaleString()}/{yearly ? "yr" : "mo"}</span>
              </button>
            );
          })}
        </div>
        {hasCredit && (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z" /></svg>
            Your first {period} is {money(WEBSITE_FIRST_MONTH_CREDIT)} off.
          </p>
        )}
      </section>

      {/* Step 3 — plugins (coming soon) */}
      <section>
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-line text-xs font-bold text-ink-soft">3</span>
          <h3 className="text-sm font-bold text-ink-soft">Add plugins <span className="ml-1 rounded-full bg-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Coming soon</span></h3>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {COMING_SOON_PLUGINS.map((p) => (
            <div key={p.name} className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-line bg-background px-2 py-3 text-center opacity-70">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-ink-soft" fill="currentColor"><path d={p.icon} /></svg>
              <span className="text-[11px] font-medium leading-tight text-ink-soft">{p.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Order summary */}
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Order summary</h3>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between"><dt>Setup (one-time)</dt><dd className="font-medium">{money(ONE_TIME_BUILD_AMOUNT)}</dd></div>
          <div className="flex justify-between"><dt>{PLANS[plan].label} — first {period}</dt><dd className="font-medium">{money(firstPeriod)}</dd></div>
          {hasCredit && (
            <div className="flex justify-between text-emerald-700"><dt>Website credit</dt><dd className="font-medium">−{money(credit)}</dd></div>
          )}
          <div className="mt-1 flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Due today</dt><dd>{money(dueToday)}</dd></div>
          <div className="flex justify-between text-xs text-ink-soft"><dt>Then</dt><dd>{recurring}{yearly ? "" : ""} starting next {period}</dd></div>
        </dl>

        {state.message && !state.ok && <p className="mt-3 text-sm font-medium text-red-600">{state.message}</p>}

        <button
          type="submit"
          disabled={pending || Boolean(state.url)}
          className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
        >
          {pending || state.url ? "Starting checkout…" : `Activate — pay ${money(dueToday)} today`}
        </button>
        <p className="mt-2 text-center text-xs text-ink-soft">Includes a free domain · secure checkout · cancel anytime.</p>
      </section>
    </form>
  );
}
