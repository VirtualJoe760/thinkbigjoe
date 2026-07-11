import { NextResponse } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import type Stripe from "stripe";

import { stripe } from "@/lib/stripe";
import { db, forgeSites, activityLog } from "@/db";
import { notifyTelegram } from "@/lib/telegram";
import { fulfillDomain } from "@/lib/domain-fulfill";
import { sendPlanEmail, sendAdminAlert } from "@/lib/email";
import { PLANS, isPlanKey, planKeyForPrice, type PlanKey } from "@/lib/plans";

const planLabel = (p: string | null | undefined) => (isPlanKey(p) ? PLANS[p].label : p || "your plan");

// The claimed owner's email for a site, via the better_auth user store.
async function ownerEmailForSite(claimedByUserId: string | null): Promise<{ email: string; name: string | null } | null> {
  if (!claimedByUserId) return null;
  const res = await db.execute(
    sql`SELECT email, name FROM better_auth."user" WHERE id = ${claimedByUserId} LIMIT 1`,
  );
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[];
  const r = rows[0];
  return r ? { email: String(r.email), name: r.name ? String(r.name) : null } : null;
}

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
      // Owner passed the Stripe Identity document + selfie check → mark the site verified.
      case "identity.verification_session.verified": {
        const vs = event.data.object as Stripe.Identity.VerificationSession;
        const siteId = Number(vs.metadata?.siteId);
        if (!Number.isFinite(siteId)) break;
        await db.update(forgeSites).set({ idVerifiedAt: new Date().toISOString() }).where(eq(forgeSites.id, siteId));
        await db.insert(activityLog).values({
          actor: "system",
          eventType: "identity_verified",
          summary: `Owner ID-verified for site #${siteId}`,
          metadata: { auto: true, detail: { siteId, sessionId: vs.id } },
        });
        break;
      }

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
        const bizName = site?.businessName ?? `site #${siteId}`;

        await db.insert(activityLog).values({
          actor: "stripe",
          eventType: "site_paid",
          summary: `${bizName} paid ($300 + ${plan}) — activated + 1 domain credit`,
          metadata: { auto: true, target: String(siteId), detail: { plan, customer: s.customer } },
        });
        notifyTelegram(
          `💳 <b>New paid client</b>\n${bizName} — $300 + ${plan} plan`,
        ).catch(() => {});

        // Customer: subscription confirmation. Admin: heads-up.
        const custEmail = s.customer_details?.email || s.customer_email || null;
        if (custEmail) {
          sendPlanEmail({
            to: custEmail,
            name: s.customer_details?.name ?? null,
            businessName: bizName,
            kind: "subscribed",
            planLabel: planLabel(plan),
          }).catch((err) => console.error("[stripe] subscribe email failed:", err));
        }
        sendAdminAlert({
          subject: `New paid client — ${bizName}`,
          heading: "New sale 💳",
          message: `${bizName} just paid: $300 build + ${planLabel(plan)} plan${custEmail ? ` (${custEmail})` : ""}.`,
          ctaUrl: `${process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com"}/command`,
          ctaLabel: "Open command",
        }).catch((err) => console.error("[stripe] admin sale alert failed:", err));
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const siteId = Number(sub.metadata?.siteId);
        if (!Number.isFinite(siteId)) break;

        const [site] = await db
          .select({ businessName: forgeSites.businessName, plan: forgeSites.plan, claimedByUserId: forgeSites.claimedByUserId })
          .from(forgeSites)
          .where(eq(forgeSites.id, siteId))
          .limit(1);

        const canceled = event.type === "customer.subscription.deleted";
        // Detect a plan change from the new subscription price.
        const newPlan = canceled ? null : planKeyForPrice(sub.items?.data?.[0]?.price?.id);
        const oldPlan = isPlanKey(site?.plan) ? (site!.plan as PlanKey) : null;
        const changed = !canceled && newPlan && newPlan !== oldPlan;

        await db
          .update(forgeSites)
          .set({
            subscriptionStatus: sub.status,
            ...(changed ? { plan: newPlan } : {}),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(forgeSites.id, siteId));

        // Email the owner on a real plan change or a cancellation.
        if (changed || canceled) {
          const owner = await ownerEmailForSite(site?.claimedByUserId ?? null).catch(() => null);
          const bizName = site?.businessName ?? `site #${siteId}`;
          if (owner?.email) {
            const kind = canceled
              ? "canceled"
              : (oldPlan && PLANS[newPlan!].monthly > PLANS[oldPlan].monthly) || !oldPlan
                ? "upgraded"
                : "downgraded";
            sendPlanEmail({
              to: owner.email,
              name: owner.name,
              businessName: bizName,
              kind,
              planLabel: planLabel(canceled ? oldPlan : newPlan),
            }).catch((err) => console.error("[stripe] plan-change email failed:", err));
          }
          if (canceled) {
            sendAdminAlert({
              subject: `Subscription canceled — ${bizName}`,
              heading: "Subscription canceled",
              message: `${bizName} canceled their subscription.`,
            }).catch(() => {});
          }
          await db.insert(activityLog).values({
            actor: "stripe",
            eventType: canceled ? "subscription_canceled" : "plan_changed",
            summary: canceled ? `${bizName} canceled their subscription` : `${bizName} changed plan → ${planLabel(newPlan)}`,
            metadata: { auto: true, target: String(siteId), detail: { from: oldPlan, to: newPlan, status: sub.status } },
          }).catch(() => {});
        }
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
