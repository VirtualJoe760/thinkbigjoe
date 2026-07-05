// ThinkBigJoe's productized plans. Every plan is a $300 one-time build fee plus a
// monthly subscription; the Stripe price IDs live in env (created by
// scripts/stripe/setup-products.mjs). Keep this the single source of truth for
// what we sell so checkout, the portal, and the webhook all agree.

export type PlanKey = "website" | "voice" | "complete";

export const ONE_TIME_BUILD_LABEL = "One-time website build";
export const ONE_TIME_BUILD_AMOUNT = 300;

export const PLANS: Record<
  PlanKey,
  { label: string; blurb: string; monthly: number; priceEnv: string; features: string[] }
> = {
  website: {
    label: "Website",
    blurb: "A modern site, hosted and maintained.",
    monthly: 99,
    priceEnv: "STRIPE_PRICE_WEBSITE",
    features: ["Custom website", "Hosting, updates & maintenance", "Ongoing content edits"],
  },
  voice: {
    label: "Website + Voice",
    blurb: "Never miss a call — the AI answers and books it.",
    monthly: 299,
    priceEnv: "STRIPE_PRICE_VOICE",
    features: ["Everything in Website", "AI voice receptionist, 24/7", "Books jobs to your calendar"],
  },
  complete: {
    label: "Complete",
    blurb: "Your whole front office, run by AI.",
    monthly: 999,
    priceEnv: "STRIPE_PRICE_COMPLETE",
    features: ["Everything in Website + Voice", "AI chat widget", "AI sales system"],
  },
};

export const PLAN_KEYS = Object.keys(PLANS) as PlanKey[];

export function isPlanKey(v: unknown): v is PlanKey {
  return typeof v === "string" && v in PLANS;
}

/** Stripe price id for a plan's monthly subscription (from env), or null if unset. */
export function planPriceId(key: PlanKey): string | null {
  return process.env[PLANS[key].priceEnv] || null;
}

/** Stripe price id for the one-time $300 build fee (from env), or null if unset. */
export function buildPriceId(): string | null {
  return process.env.STRIPE_PRICE_BUILD || null;
}
