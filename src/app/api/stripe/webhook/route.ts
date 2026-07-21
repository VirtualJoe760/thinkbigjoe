import { NextResponse } from "next/server";
import { and, eq, ne, sql, inArray, isNull, notInArray } from "drizzle-orm";
import type Stripe from "stripe";

import { stripe } from "@/lib/stripe";
import { db, forgeSites, activityLog, voiceLines, voiceProvisionQueue, autoProvision } from "@/db";
import { notifyTelegram } from "@/lib/telegram";
import { fulfillDomain } from "@/lib/domain-fulfill";
import { sendPlanEmail, sendAdminAlert } from "@/lib/email";
import { PLANS, isPlanKey, planIncludesVoiceMinutes, planKeyForPrice, type PlanKey } from "@/lib/plans";
import { reportIncident } from "@/lib/monitor";

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

/**
 * Post-payment automation enqueue — switch-AGNOSTIC and idempotent.
 *
 * The VOICE queue is written WITHOUT reading auto_provision.enabled: the enqueue must always happen
 * so a paused / over-cap / switched-off pipeline queues the customer for a human instead of dropping
 * them (the pause-not-drop invariant — docs/AUTOMATION_PIPELINE.md). Only the drainer
 * (scripts/provision-drain.mjs) reads the switch + cap and decides whether to actually buy a number.
 *
 * Two independent, retry-safe enqueues (Stripe has no event dedup, so both must no-op on replay):
 *  • VOICE — for a voice/complete plan with no live line yet: insert a voice_provision_queue row.
 *    unique(site_id) makes on-conflict-do-nothing the whole idempotency story.
 *  • BUILD — only when auto_build_enabled is ON and the site is still pre-build: flip status to
 *    'approved' so the forge poll picks it up. forge_engine still gates the real build spend, so
 *    this only MOVES the trigger; the pre-build WHERE guard makes a retry a no-op.
 *
 * Non-throwing on purpose: a failure here must never bubble into the handler's catch-all (which
 * returns 200 and would strand the whole sale). It alerts instead, so a missed enqueue is visible.
 */
async function enqueuePostPaymentAutomation(siteId: number, plan: string | null, bizName: string) {
  try {
    // ── VOICE ──────────────────────────────────────────────────────────────────────────────────
    if (isPlanKey(plan) && planIncludesVoiceMinutes(plan)) {
      // A live/pending line already exists → this is a re-purchase or a Stripe retry; never re-queue.
      const live = await db
        .select({ id: voiceLines.id })
        .from(voiceLines)
        .where(and(eq(voiceLines.siteId, siteId), inArray(voiceLines.status, ["active", "provisioning"])))
        .limit(1);
      if (live.length === 0) {
        const queued = await db
          .insert(voiceProvisionQueue)
          .values({ siteId })
          .onConflictDoNothing({ target: voiceProvisionQueue.siteId })
          .returning({ id: voiceProvisionQueue.id });
        if (queued.length > 0) {
          await db.insert(activityLog).values({
            actor: "stripe",
            eventType: "voice_provision_queued",
            summary: `${bizName} queued for voice provisioning (${plan})`,
            metadata: { auto: true, target: String(siteId), detail: { plan } },
          });
          notifyTelegram(
            `📞 <b>Voice line queued</b>\n${bizName} — auto-provisions if the switch is on and under cap; otherwise run <code>provision-line --site ${siteId} --apply</code>.`,
          ).catch(() => {});
        }
      }
    }

    // ── BUILD (opt-in; default OFF) ──────────────────────────────────────────────────────────────
    const [cfg] = await db
      .select({ autoBuild: autoProvision.autoBuildEnabled })
      .from(autoProvision)
      .where(eq(autoProvision.id, 1))
      .limit(1);
    if (cfg?.autoBuild) {
      const approved = await db
        .update(forgeSites)
        .set({ status: "approved", approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(forgeSites.id, siteId),
            // Pre-build only. Never re-queue an approved/building/built or already-live site — that
            // would cost a redundant `claude -p` build on every Stripe retry.
            notInArray(forgeSites.status, ["approved", "building", "built"]),
            isNull(forgeSites.liveUrl),
          ),
        )
        .returning({ id: forgeSites.id });
      if (approved.length > 0) {
        await db.insert(activityLog).values({
          actor: "stripe",
          eventType: "site_paid_build_queued",
          summary: `${bizName} auto-queued for build on payment`,
          metadata: { auto: true, target: String(siteId) },
        });
      }
    }
  } catch (err) {
    // A paid customer who wasn't queued is a real problem, but it must not strand the whole handler.
    console.error("[stripe] post-payment automation enqueue failed for site %d:", siteId, err);
    void reportIncident("critical", "Post-payment automation enqueue failed", {
      dedupeKey: `provision-enqueue-${siteId}`,
      detail: err,
    });
  }
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

        // Queue voice provisioning (and, if opted in, the site build). Self-contained + non-throwing
        // so it can't strand the sale; the drainer decides whether to actually spend. See the helper.
        await enqueuePostPaymentAutomation(siteId, plan, bizName);
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
    // KNOWN GAP: this still returns 200, so Stripe won't retry. For checkout.session.completed that
    // means a DB blip = money captured, nothing provisioned, and no automatic recovery. Fixing the
    // retry semantics safely (500 on must-succeed events, 200 where a retry can't help) is its own
    // change. What we can do here without risk is stop it being SILENT: alert so the sale can be
    // reconciled by hand from the event id logged above.
    void reportIncident("critical", `Stripe handler threw for ${event.type}`, {
      dedupeKey: `stripe-${event.type}`,
      detail: err,
    });
    // Return 200 anyway so Stripe doesn't hammer retries on a transient DB blip;
    // the event id is logged above for manual replay if needed.
  }

  return NextResponse.json({ received: true });
}
