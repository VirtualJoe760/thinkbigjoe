import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { ensureStripeCustomer, stripe } from "@/lib/stripe";

/**
 * Deep-links a client into the Stripe Customer Portal's plan-change flow for one of
 * their sites' subscriptions (?site=<id>). Stripe handles proration, confirmation, and
 * payment; the webhook (customer.subscription.updated) syncs the new plan back. Falls
 * back to the general portal if the site has no subscription or the flow isn't available.
 */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const siteId = Number(new URL(req.url).searchParams.get("site"));

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.redirect(`${origin}/login`);
  if (!stripe) return NextResponse.redirect(`${origin}/portal/billing?billing=unavailable`);

  const [site] = Number.isFinite(siteId)
    ? await db.select().from(forgeSites).where(eq(forgeSites.id, siteId)).limit(1)
    : [];
  if (!site || site.claimedByUserId !== session.user.id) {
    return NextResponse.redirect(`${origin}/portal/billing`);
  }

  try {
    const customer = await ensureStripeCustomer(session.user.email, session.user.name);
    // Prefer the deep-linked plan-change flow; fall back to the general portal.
    const base = {
      customer: customer.id,
      return_url: `${origin}/portal/billing?changed=1`,
    } as const;
    let portalSession;
    if (site.stripeSubscriptionId) {
      try {
        portalSession = await stripe.billingPortal.sessions.create({
          ...base,
          flow_data: {
            type: "subscription_update",
            subscription_update: { subscription: site.stripeSubscriptionId },
          },
        });
      } catch (flowErr) {
        console.warn("[billing] subscription_update flow unavailable, using general portal:", flowErr);
      }
    }
    if (!portalSession) portalSession = await stripe.billingPortal.sessions.create(base);
    return NextResponse.redirect(portalSession.url);
  } catch (err) {
    console.error("[billing] could not open plan-change portal:", err);
    return NextResponse.redirect(`${origin}/portal/billing?billing=error`);
  }
}
