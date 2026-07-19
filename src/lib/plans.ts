// ThinkBigJoe's productized plans — the single source of truth for what we sell, so checkout,
// the portal, and the Stripe webhook all agree.
//
// 2026-07 pivot (docs/BUSINESS_PLAN.md): we no longer sell "a website". We sell an AI operations
// system in three tiers — answer / respond / recover — and a website is a *delivery component*
// bundled into every tier, not a product. The one-time fee is now a $250 SETUP fee, not a build fee.
//
// The old website/voice/complete keys are kept as LEGACY: real subscriptions and Stripe price IDs
// still point at them, and planKeyForPrice() must keep resolving those price IDs or the webhook
// would silently null out an existing customer's plan. They are excluded from PLAN_KEYS so no UI
// can offer them to a new buyer.

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
  | "answer"
  | "respond"
  | "recover"
  // legacy — existing subscribers only, never offered
  | "website"
  | "voice"
  | "complete";

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
};

const DEFS: Record<PlanKey, PlanDef> = {
  // ── Sellable tiers (docs/BUSINESS_PLAN.md, "The agent menu") ──────────────────
  answer: {
    label: "Answer",
    blurb: "Every call answered, qualified and booked — day or night.",
    monthly: 497,
    annual: 4970, // 10 × monthly — two months free
    priceEnv: "STRIPE_PRICE_ANSWER",
    annualPriceEnv: "STRIPE_PRICE_ANSWER_ANNUAL",
    agents: ["voice_receptionist", "portal", "website"],
  },
  respond: {
    label: "Respond",
    blurb: "Adds texting and chases the estimates nobody called back about.",
    monthly: 797,
    annual: 7970,
    priceEnv: "STRIPE_PRICE_RESPOND",
    annualPriceEnv: "STRIPE_PRICE_RESPOND_ANNUAL",
    featurePrefix: ["Everything in Answer"],
    agents: ["text_handling", "estimate_followup"],
  },
  recover: {
    label: "Recover",
    blurb: "Pulls revenue back out of the customers you already have.",
    monthly: 1197,
    annual: 11970,
    priceEnv: "STRIPE_PRICE_RECOVER",
    annualPriceEnv: "STRIPE_PRICE_RECOVER_ANNUAL",
    featurePrefix: ["Everything in Respond"],
    agents: ["seasonal_reminders", "reactivation", "review_requests"],
  },

  // ── LEGACY — NOT FOR SALE ─────────────────────────────────────────────────────
  // Kept only so planKeyForPrice() still maps live Stripe price IDs and the webhook doesn't
  // wipe an existing subscriber's plan. Do not add these to PLAN_KEYS.
  website: {
    label: "Website (legacy)",
    blurb: "Legacy plan — no longer sold.",
    monthly: 99,
    annual: 999,
    priceEnv: "STRIPE_PRICE_WEBSITE",
    annualPriceEnv: "STRIPE_PRICE_WEBSITE_ANNUAL",
    agents: ["website", "portal"],
    legacy: true,
    bundlesPaidWebsite: true,
  },
  voice: {
    label: "Website + Voice (legacy)",
    blurb: "Legacy plan — no longer sold.",
    monthly: 299,
    annual: 2999,
    priceEnv: "STRIPE_PRICE_VOICE",
    annualPriceEnv: "STRIPE_PRICE_VOICE_ANNUAL",
    featurePrefix: ["Everything in Website"],
    agents: ["voice_receptionist"],
    legacy: true,
    bundlesPaidWebsite: true,
  },
  complete: {
    label: "Complete (legacy)",
    blurb: "Legacy plan — no longer sold.",
    monthly: 999,
    annual: 9999,
    priceEnv: "STRIPE_PRICE_COMPLETE",
    annualPriceEnv: "STRIPE_PRICE_COMPLETE_ANNUAL",
    featurePrefix: ["Everything in Website + Voice"],
    agents: ["text_handling", "estimate_followup"],
    legacy: true,
    bundlesPaidWebsite: true,
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

/**
 * LEGACY OFFER — $99 off the first month, earned by buying a website.
 *
 * ⚠️ BUG GUARD: this coupon must ONLY attach to a plan whose price actually bundled a paid
 * website (the legacy tiers) — otherwise it knocks $99 off a $497 Answer plan for nothing.
 * Callers MUST gate on firstMonthCouponFor(plan) and omit the `discounts` key entirely when it
 * returns null: Stripe rejects `discounts` alongside `allow_promotion_codes`, and an empty
 * `discounts: []` still counts as present. Same rule for the UI copy that quotes the credit —
 * never advertise a discount Stripe won't apply.
 */
export const WEBSITE_FIRST_MONTH_CREDIT = 99;
/** The Stripe coupon (created once in the dashboard/API) that applies the credit above. */
export const FIRST_MONTH_CREDIT_COUPON = "website-first-month-99";

/** The coupon to apply at checkout for this plan, or null if none applies (all new tiers). */
export function firstMonthCouponFor(key: PlanKey): string | null {
  return PLANS[key].bundlesPaidWebsite ? FIRST_MONTH_CREDIT_COUPON : null;
}
