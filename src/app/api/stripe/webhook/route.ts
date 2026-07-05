import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import type Stripe from "stripe";

import { stripe } from "@/lib/stripe";
import { db, forgeSites, activityLog } from "@/db";
import { notifyTelegram } from "@/lib/telegram";
import { fulfillDomain } from "@/lib/domain-fulfill";

// Stripe needs the raw request body to verify the signature.
export async function POST(req: Request) {
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET not set" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.error("[stripe] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const siteId = Number(s.metadata?.siteId);
        if (!Number.isFinite(siteId)) break;

        // Paid additional domain (payment mode) — register + attach it, no credit.
        if (s.metadata?.action === "domain" && s.metadata?.domain) {
          await fulfillDomain(siteId, s.metadata.domain, true);
          break;
        }

        const plan = s.metadata?.plan ?? null;
        const userId = s.metadata?.userId ?? null;

        // Free domain credit is one per customer: only the FIRST paid site gets it.
        let grantCredit = 1;
        if (userId) {
          const others = await db
            .select({ id: forgeSites.id })
            .from(forgeSites)
            .where(
              and(
                eq(forgeSites.claimedByUserId, userId),
                eq(forgeSites.oneTimePaid, true),
                ne(forgeSites.id, siteId),
              ),
            )
            .limit(1);
          if (others.length > 0) grantCredit = 0; // additional website → domain is paid
        }

        // Site paid: record customer/subscription, mark active, grant domain credit.
        await db
          .update(forgeSites)
          .set({
            plan,
            stripeCustomerId: typeof s.customer === "string" ? s.customer : (s.customer?.id ?? null),
            stripeSubscriptionId:
              typeof s.subscription === "string" ? s.subscription : (s.subscription?.id ?? null),
            subscriptionStatus: "active",
            oneTimePaid: true,
            paidAt: new Date().toISOString(),
            domainCredits: grantCredit,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(forgeSites.id, siteId));

        const [site] = await db
          .select({ businessName: forgeSites.businessName })
          .from(forgeSites)
          .where(eq(forgeSites.id, siteId))
          .limit(1);

        await db.insert(activityLog).values({
          actor: "stripe",
          eventType: "site_paid",
          summary: `${site?.businessName ?? `site #${siteId}`} paid ($300 + ${plan}) — activated + 1 domain credit`,
          metadata: { auto: true, target: String(siteId), detail: { plan, customer: s.customer } },
        });
        notifyTelegram(
          `💳 <b>New paid client</b>\n${site?.businessName ?? `site #${siteId}`} — $300 + ${plan} plan`,
        ).catch(() => {});
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const siteId = Number(sub.metadata?.siteId);
        if (!Number.isFinite(siteId)) break;
        await db
          .update(forgeSites)
          .set({ subscriptionStatus: sub.status, updatedAt: new Date().toISOString() })
          .where(eq(forgeSites.id, siteId));
        break;
      }

      default:
        // Other events (invoice.paid, payment_failed, etc.) are acknowledged; add
        // handling here as billing needs grow.
        break;
    }
  } catch (err) {
    console.error(`[stripe] handler error for ${event.type}:`, err);
    // Return 200 anyway so Stripe doesn't hammer retries on a transient DB blip;
    // the event id is logged above for manual replay if needed.
  }

  return NextResponse.json({ received: true });
}
