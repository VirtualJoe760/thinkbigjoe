// ThinkBigJoe's productized plans — the single source of truth for what we sell, so checkout,
// the portal, and the Stripe webhook all agree.
//
// 2026-07-19: RESTORED the original $99/$299/$999 ladder (website / voice / complete) as the
// sellable tiers. The $497/$797/$1197 answer/respond/recover tiers priced us out of the volume
// motion this market actually rewards; they were created in Stripe but never sold. They are now
// LEGACY — resolvable, never offered.
//
// Legacy keys are never deleted. Stripe prices are immutable and planKeyForPrice() must keep
// resolving every price ID we ever attached to a subscription, or the webhook would read a live
// customer as "no plan" and downgrade them. Legacy keys are excluded from PLAN_KEYS so no UI can
// offer them to a new buyer. That cuts both ways now: answer/respond/recover are legacy going
// forward, website/voice/complete are sellable again.
//
// VOICE ALLOWANCES live here too (`includedMinutes`), so the number the portal shows, the number
// the 80%/100% warnings fire against, and the number billing subtracts before charging overage all
// come from one place. If the allowance is ever duplicated somewhere else, one copy will drift and
// a customer will be charged for minutes we told them were included.

/** Individual agents/capabilities. Tiers are composed from these so portal copy can't drift
 *  from entitlements — the feature bullets ARE the entitlement list. */
export type AgentKey =
  | "portal"
  | "website"
  | "voice_receptionist"
  | "text_handling"
  | "estimate_followup"
  | "seasonal_reminders"
  | "reactivation"
  | "review_requests";

export const AGENTS: Record<AgentKey, { label: string; blurb: string }> = {
  portal: {
    label: "Your portal",
    blurb: "Every call, booking and dollar recovered — with a monthly ROI number.",
  },
  website: {
    label: "Website, built & maintained",
    blurb: "Included with every tier. Hosting, updates and content edits handled.",
  },
  voice_receptionist: {
    label: "AI voice receptionist, 24/7",
    blurb: "Answers every call, qualifies the job, books it to your calendar.",
  },
  text_handling: {
    label: "Text/SMS handling",
    blurb: "Replies to inbound texts and keeps the thread moving toward a booking.",
  },
  estimate_followup: {
    label: "Unsold estimate follow-up",
    blurb: "Chases quotes nobody called back about — the biggest leak in home services.",
  },
  seasonal_reminders: {
    label: "Seasonal reminders",
    blurb: "Spring AC, fall furnace — your existing list, twice a year, zero acquisition cost.",
  },
  reactivation: {
    label: "Past-customer reactivation",
    blurb: "Wakes up customers sitting dead in your CRM.",
  },
  review_requests: {
    label: "Review requests",
    blurb: "Asks happy customers at the right moment — drives local rank.",
  },
};

export type PlanKey =
  // sellable tiers
  | "website"
  | "voice"
  | "complete"
  // legacy — existing subscribers only, never offered
  | "answer"
  | "respond"
  | "recover";

export type BillingInterval = "month" | "year";

/**
 * The one-time fee charged alongside the first invoice. Renamed in spirit ($300 build → $250 setup)
 * but the export name is unchanged so existing portal/checkout consumers keep compiling.
 */
export const ONE_TIME_BUILD_AMOUNT = 250;
/** Clearer alias for new code. Same number. */
export const SETUP_FEE_AMOUNT = ONE_TIME_BUILD_AMOUNT;

type PlanDef = {
  label: string;
  blurb: string;
  monthly: number;
  annual: number; // flat yearly price (a discount vs monthly × 12)
  priceEnv: string;
  annualPriceEnv: string;
  /** What this tier actually turns on. Source of truth; `features` is derived from it. */
  agents: AgentKey[];
  /** Extra bullets that aren't agents (e.g. "everything in X"), prefixed to the derived list. */
  featurePrefix?: string[];
  /** Legacy tiers stay resolvable for existing subscriptions but are never sellable. */
  legacy?: boolean;
  /** True only for plans whose price bundled a paid website — gates the $99 credit coupon. */
  bundlesPaidWebsite?: boolean;
  /**
   * Receptionist minutes included each month. 0 means the tier has NO receptionist at all —
   * not "an allowance of zero". Callers must branch on planIncludesVoiceMinutes() rather than
   * comparing against 0, or a $99 website customer (who can never place a call) gets rendered as
   * permanently 100% over allowance and warned about minutes they don't have.
   */
  includedMinutes: number;
  /**
   * Dollars per minute charged beyond `includedMinutes`. ~2.8x the ~$0.18/min marginal Retell cost
   * measured on the live account — priced as a deterrent so upgrading is always cheaper than
   * overrunning, not as a profit centre.
   *
   * ⚠️ Overage BILLS. It NEVER throttles, gates, degrades or disconnects. This is the customer's
   * business phone; a plumber whose line dies at minute 400 loses jobs and blames us, and the
   * overage revenue would never cover that churn. Warn at 80%, warn again at 100%, keep answering.
   * This is load-bearing beyond customer service: because service never depends on billing state,
   * the overage job is allowed to be batched, late, retried and human-reviewed. Anything that makes
   * call handling read billing state breaks that guarantee — don't.
   */
  overagePerMinute: number;
};

const DEFS: Record<PlanKey, PlanDef> = {
  // ── Sellable tiers — the restored $99/$299/$999 ladder ────────────────────────
  // Margin at these allowances (redo this math before changing any number):
  //   $299 / 400 min   → ~$72 COGS  → ~76% gross margin; break-even ~1,660 min (4x headroom)
  //   $999 / 1,200 min → ~$216 COGS → ~78% gross margin
  website: {
    label: "Website",
    blurb: "Your site, hosted and maintained — edits handled for you.",
    monthly: 99,
    annual: 999,
    priceEnv: "STRIPE_PRICE_WEBSITE",
    annualPriceEnv: "STRIPE_PRICE_WEBSITE_ANNUAL",
    agents: ["website", "portal"],
    // No receptionist on this tier, so no allowance and no overage rate — see planIncludesVoiceMinutes().
    includedMinutes: 0,
    overagePerMinute: 0,
  },
  voice: {
    label: "Website + Voice",
    blurb: "Adds the 24/7 AI receptionist — every call answered, qualified and booked.",
    monthly: 299,
    annual: 2999,
    priceEnv: "STRIPE_PRICE_VOICE",
    annualPriceEnv: "STRIPE_PRICE_VOICE_ANNUAL",
    featurePrefix: ["Everything in Website"],
    agents: ["voice_receptionist"],
    includedMinutes: 400,
    overagePerMinute: 0.5,
  },
  complete: {
    label: "Complete",
    blurb: "Everything, plus custom agents working your customer list.",
    monthly: 999,
    annual: 9999,
    priceEnv: "STRIPE_PRICE_COMPLETE",
    annualPriceEnv: "STRIPE_PRICE_COMPLETE_ANNUAL",
    featurePrefix: ["Everything in Website + Voice"],
    agents: ["text_handling", "estimate_followup"],
    includedMinutes: 1200,
    overagePerMinute: 0.5,
  },

  // ── LEGACY — NOT FOR SALE ─────────────────────────────────────────────────────
  // The $497/$797/$1197 tiers. Created in Stripe 2026-07-19 but never sold — kept only so
  // planKeyForPrice() resolves their price IDs if one was somehow purchased, and because Stripe
  // prices are immutable (deleting them is riskier than leaving them inert). Do not add to
  // PLAN_KEYS. Allowances are recorded so that if a subscription DOES exist on one, the usage
  // math still has a number to work with rather than reading undefined as 0 and billing the
  // customer for every minute from the first.
  answer: {
    label: "Answer (legacy)",
    blurb: "Legacy plan — no longer sold.",
    monthly: 497,
    annual: 4970,
    priceEnv: "STRIPE_PRICE_ANSWER",
    annualPriceEnv: "STRIPE_PRICE_ANSWER_ANNUAL",
    agents: ["voice_receptionist", "portal", "website"],
    legacy: true,
    includedMinutes: 400,
    overagePerMinute: 0.5,
  },
  respond: {
    label: "Respond (legacy)",
    blurb: "Legacy plan — no longer sold.",
    monthly: 797,
    annual: 7970,
    priceEnv: "STRIPE_PRICE_RESPOND",
    annualPriceEnv: "STRIPE_PRICE_RESPOND_ANNUAL",
    featurePrefix: ["Everything in Answer"],
    agents: ["text_handling", "estimate_followup"],
    legacy: true,
    includedMinutes: 800,
    overagePerMinute: 0.5,
  },
  recover: {
    label: "Recover (legacy)",
    blurb: "Legacy plan — no longer sold.",
    monthly: 1197,
    annual: 11970,
    priceEnv: "STRIPE_PRICE_RECOVER",
    annualPriceEnv: "STRIPE_PRICE_RECOVER_ANNUAL",
    featurePrefix: ["Everything in Respond"],
    agents: ["seasonal_reminders", "reactivation", "review_requests"],
    legacy: true,
    includedMinutes: 1200,
    overagePerMinute: 0.5,
  },
};

export type Plan = PlanDef & { readonly features: string[] };

// `features` is derived, not authored, so a tier can never advertise something it doesn't enable.
// Computed once at module load — the inputs are static.
export const PLANS: Record<PlanKey, Plan> = Object.fromEntries(
  (Object.keys(DEFS) as PlanKey[]).map((k) => {
    const d = DEFS[k];
    return [k, { ...d, features: [...(d.featurePrefix ?? []), ...d.agents.map((a) => AGENTS[a].label)] }];
  }),
) as Record<PlanKey, Plan>;

/** Every key, including legacy. Use for lookups/validation, never for rendering a price grid. */
export const ALL_PLAN_KEYS = Object.keys(PLANS) as PlanKey[];

/** The tiers a new customer may buy. UI should iterate THIS, never ALL_PLAN_KEYS. */
export const PLAN_KEYS: PlanKey[] = ALL_PLAN_KEYS.filter((k) => !PLANS[k].legacy);
/** Explicit alias for readers who'd otherwise wonder whether PLAN_KEYS includes legacy. */
export const SELLABLE_PLAN_KEYS = PLAN_KEYS;

export function isPlanKey(v: unknown): v is PlanKey {
  return typeof v === "string" && v in PLANS;
}

/** True if the key is a live, purchasable tier (isPlanKey accepts legacy keys too). */
export function isSellablePlan(v: unknown): v is PlanKey {
  return isPlanKey(v) && !PLANS[v].legacy;
}

/** Dollars saved per year by paying annually vs monthly × 12. */
export function annualSavings(key: PlanKey): number {
  return PLANS[key].monthly * 12 - PLANS[key].annual;
}

/** Stripe price id for a plan's subscription at the given interval (from env), or null. */
export function planPriceId(key: PlanKey, interval: BillingInterval = "month"): string | null {
  const envKey = interval === "year" ? PLANS[key].annualPriceEnv : PLANS[key].priceEnv;
  return process.env[envKey] || null;
}

/**
 * Reverse of planPriceId — map a Stripe price id (monthly OR annual) back to a plan key.
 * Deliberately searches ALL_PLAN_KEYS: a customer still on the old $299 voice price must keep
 * resolving, or the webhook would read their subscription as "no plan" and downgrade them.
 */
export function planKeyForPrice(priceId: string | null | undefined): PlanKey | null {
  if (!priceId) return null;
  return (
    ALL_PLAN_KEYS.find(
      (k) => process.env[PLANS[k].priceEnv] === priceId || process.env[PLANS[k].annualPriceEnv] === priceId,
    ) ?? null
  );
}

/**
 * Stripe price id for the one-time setup fee.
 *
 * ⚠️ NO FALLBACK ON PURPOSE. This used to fall back to STRIPE_PRICE_BUILD, which is the OLD $300
 * build price, while ONE_TIME_BUILD_AMOUNT below is $250 — the quoted number and the charged
 * number would come from two independent sources and the customer would be overcharged $50 with
 * no trace in the UI. A blocked checkout is recoverable (startCheckout renders a clean "plans
 * aren't configured yet" message and Joe sets the env var); an overcharge is not.
 */
export function setupPriceId(): string | null {
  return process.env.STRIPE_PRICE_SETUP || null;
}
/** @deprecated Name kept for existing callers — this is the setup fee now, not a build fee. */
export function buildPriceId(): string | null {
  return setupPriceId();
}

// ── Voice minutes: allowance, warnings, overage ────────────────────────────────
// One allowance number, three consumers: the portal counter, the 80%/100% warnings, and the
// monthly overage job. They must all call through here.

/** Warn the customer at these fractions of their allowance. Never gates anything — see PlanDef. */
export const MINUTES_WARN_THRESHOLDS = [0.8, 1] as const;

/**
 * Stripe price id for metered voice overage, or null if unconfigured.
 *
 * Nullable on purpose and with no fallback, exactly like setupPriceId(): there is no other price
 * that means "$0.50 per voice minute", and quietly billing overage against some other price id
 * would overcharge a customer with no trace. A caller that gets null must skip billing overage and
 * surface that the plan isn't fully configured — never substitute a different price.
 */
export function overagePriceId(): string | null {
  return process.env.STRIPE_PRICE_OVERAGE || null;
}

/** Minutes included on a plan. Safe on legacy/unknown keys. */
export function includedMinutes(key: PlanKey): number {
  return PLANS[key]?.includedMinutes ?? 0;
}

/**
 * True if the plan has a receptionist and therefore a meaningful minutes allowance.
 *
 * Branch on THIS, never on `includedMinutes(k) === 0`. The website tier has no receptionist, so
 * "0 of 0 minutes used" is not an over-limit state, not an error, and not something to warn about —
 * it's a tier that simply has no minutes concept. Rendering it as 100% consumed would nag a $99
 * customer about a product they never bought.
 */
export function planIncludesVoiceMinutes(key: PlanKey | null | undefined): boolean {
  return !!key && isPlanKey(key) && PLANS[key].includedMinutes > 0;
}

/**
 * Fraction of the allowance consumed, in [0, ∞). Returns null when the tier has no allowance,
 * so callers can't divide by zero and can't render a meter that has no meaning. `null` means
 * "don't show a usage meter at all" — it does NOT mean 0 and must not be defaulted to one.
 */
export function minutesUsedFraction(key: PlanKey | null | undefined, minutesUsed: number): number | null {
  if (!planIncludesVoiceMinutes(key)) return null;
  const allowance = PLANS[key as PlanKey].includedMinutes;
  return Math.max(0, minutesUsed) / allowance;
}

/** Minutes billable beyond the allowance. 0 on tiers with no receptionist — they can't overrun. */
export function overageMinutes(key: PlanKey | null | undefined, minutesUsed: number): number {
  if (!planIncludesVoiceMinutes(key)) return 0;
  return Math.max(0, Math.ceil(minutesUsed) - PLANS[key as PlanKey].includedMinutes);
}

/**
 * What to charge for overage, in CENTS.
 *
 * Integer cents, not dollars: this number goes straight to Stripe's `amount`, and doing
 * `minutes * 0.5` in floating point then converting invites a rounding error on a real invoice.
 * Returns 0 for tiers with no receptionist, which is also the guard that stops the billing job
 * from ever posting an overage line to a $99 website customer.
 */
export function overageCents(key: PlanKey | null | undefined, minutesUsed: number): number {
  const over = overageMinutes(key, minutesUsed);
  if (over <= 0) return 0;
  return Math.round(over * PLANS[key as PlanKey].overagePerMinute * 100);
}

/**
 * RETIRED OFFER — $99 off the first month, earned by buying a website.
 *
 * ⚠️ DELIBERATELY ATTACHED TO NOTHING. No plan sets `bundlesPaidWebsite` any more, so
 * firstMonthCouponFor() always returns null and no checkout applies this coupon.
 *
 * This used to be gated on `bundlesPaidWebsite: true`, which website/voice/complete all carried
 * back when they were legacy and unsellable — inert, because nobody could buy them. Restoring
 * that ladder to sellable would have silently reactivated the discount for every new customer:
 * $99 off a $99/mo website plan is a FREE first month, and $99 off Complete is real margin, on
 * every sale, with nobody having decided to run a promotion. Turning it off is the conservative
 * default; switching it back on is a pricing decision, not a refactor.
 *
 * The constants and the gate stay exported because consumers import them and the Stripe coupon
 * still exists. To run this promotion again, set `bundlesPaidWebsite: true` on the intended
 * tier(s) — the callers already handle it correctly.
 *
 * ⚠️ CALLER CONTRACT (unchanged): gate on firstMonthCouponFor(plan) and OMIT the `discounts` key
 * entirely when it returns null. Stripe rejects `discounts` alongside `allow_promotion_codes`, and
 * an empty `discounts: []` still counts as present. Same rule for UI copy that quotes the credit —
 * never advertise a discount Stripe won't apply.
 */
export const WEBSITE_FIRST_MONTH_CREDIT = 99;
/** The Stripe coupon (created once in the dashboard/API) that applies the credit above. */
export const FIRST_MONTH_CREDIT_COUPON = "website-first-month-99";

/** The coupon to apply at checkout for this plan, or null if none applies (all new tiers). */
export function firstMonthCouponFor(key: PlanKey): string | null {
  return PLANS[key].bundlesPaidWebsite ? FIRST_MONTH_CREDIT_COUPON : null;
}
