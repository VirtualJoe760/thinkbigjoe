import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;

export const stripe = key ? new Stripe(key) : null;

/**
 * Find the Stripe customer for an email, or create one. Avoids storing a
 * customer id locally for v1 — looks up by email each time.
 */
export async function ensureStripeCustomer(email: string, name?: string | null) {
  if (!stripe) throw new Error("Stripe is not configured");
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data[0]) return existing.data[0];
  return stripe.customers.create({
    email,
    name: name ?? undefined,
    metadata: { source: "thinkbigjoe-portal" },
  });
}
