// ThinkBigJoe's productized plans. Every plan is a $300 one-time build fee plus a
// monthly subscription; the Stripe price IDs live in env (created by
// scripts/stripe/setup-products.mjs). Keep this the single source of truth for
// what we sell so checkout, the portal, and the webhook all agree.

export type PlanKey = "website" | "voice" | "complete";
export type BillingInterval = "month" | "year";

export const ONE_TIME_BUILD_LABEL = "One-time website build";
export const ONE_TIME_BUILD_AMOUNT = 300;

export const PLANS: Record<
  PlanKey,
  {
    label: string;
    blurb: string;
    monthly: number;
    annual: number; // flat yearly price (a discount vs monthly × 12)
    priceEnv: string;
    annualPriceEnv: string;
    features: string[];
  }
> = {
  website: {
    label: "Website",
    blurb: "A modern site, plus a monthly newsletter to your customers.",
    monthly: 99,
    annual: 999,
    priceEnv: "STRIPE_PRICE_WEBSITE",
    annualPriceEnv: "STRIPE_PRICE_WEBSITE_ANNUAL",
    features: ["Custom website", "Hosting, updates & maintenance", "Ongoing content edits", "Monthly customer newsletter (AI-drafted)"],
  },
  voice: {
    label: "Website + Voice",
    blurb: "Never miss a call — the AI answers and books it.",
    monthly: 299,
    annual: 2999,
    priceEnv: "STRIPE_PRICE_VOICE",
    annualPriceEnv: "STRIPE_PRICE_VOICE_ANNUAL",
    features: ["Everything in Website", "AI voice receptionist, 24/7", "Books jobs to your calendar"],
  },
  complete: {
    label: "Complete",
    blurb: "Your whole front office, run by AI.",
    monthly: 999,
    annual: 9999,
    priceEnv: "STRIPE_PRICE_COMPLETE",
    annualPriceEnv: "STRIPE_PRICE_COMPLETE_ANNUAL",
    features: ["Everything in Website + Voice", "AI chat widget", "AI sales system"],
  },
};

/** Dollars saved per year by paying annually vs monthly × 12. */
export function annualSavings(key: PlanKey): number {
  return PLANS[key].monthly * 12 - PLANS[key].annual;
}

export const PLAN_KEYS = Object.keys(PLANS) as PlanKey[];

export function isPlanKey(v: unknown): v is PlanKey {
  return typeof v === "string" && v in PLANS;
}

/** Stripe price id for a plan's subscription at the given interval (from env), or null. */
export function planPriceId(key: PlanKey, interval: BillingInterval = "month"): string | null {
  const envKey = interval === "year" ? PLANS[key].annualPriceEnv : PLANS[key].priceEnv;
  return process.env[envKey] || null;
}

/** Reverse of planPriceId — map a Stripe price id (monthly OR annual) back to a plan key. */
export function planKeyForPrice(priceId: string | null | undefined): PlanKey | null {
  if (!priceId) return null;
  return (
    PLAN_KEYS.find(
      (k) => process.env[PLANS[k].priceEnv] === priceId || process.env[PLANS[k].annualPriceEnv] === priceId,
    ) ?? null
  );
}

/** Stripe price id for the one-time $300 build fee (from env), or null if unset. */
export function buildPriceId(): string | null {
  return process.env.STRIPE_PRICE_BUILD || null;
}

/**
 * Buying a website earns a one-time $99 credit toward the first month of ANY subscription tier
 * (you must own a website to subscribe). Applied at checkout as a $99-off-once Stripe coupon, so:
 * Basic's first month is effectively free ($99 − $99), while Voice/Complete get $99 off their first
 * month ($200 / $900). Recurring stays full price (the coupon only touches the first invoice).
 */
export const WEBSITE_FIRST_MONTH_CREDIT = 99;
/** The Stripe coupon (created once in the dashboard/API) that applies the credit above. */
export const FIRST_MONTH_CREDIT_COUPON = "website-first-month-99";
