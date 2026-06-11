import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ensureStripeCustomer, stripe } from "@/lib/stripe";

/**
 * Opens the Stripe Customer Portal for the logged-in client so they can
 * manage payment methods, view invoices, and update billing.
 */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.redirect(`${origin}/login`);
  }
  if (!stripe) {
    return NextResponse.redirect(`${origin}/portal?billing=unavailable`);
  }

  try {
    const customer = await ensureStripeCustomer(
      session.user.email,
      session.user.name,
    );
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${origin}/portal`,
    });
    return NextResponse.redirect(portalSession.url);
  } catch (err) {
    console.error("[billing] could not open Stripe portal:", err);
    return NextResponse.redirect(`${origin}/portal?billing=error`);
  }
}
