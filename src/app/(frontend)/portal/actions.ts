"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";

import { db, forgeSites, rebuildRequests, activityLog } from "@/db";
import { auth } from "@/lib/auth";
import { normalizeClaimCode } from "@/lib/claim-code";
import { notifyTelegram } from "@/lib/telegram";
import { stripe, ensureStripeCustomer } from "@/lib/stripe";
import { buildPriceId, isPlanKey, planPriceId } from "@/lib/plans";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";

export type ClaimState = {
  ok: boolean;
  message: string;
  site?: { businessName: string; liveUrl: string | null };
};

/**
 * Redeem a claim code (from useActionState). Any signed-in user can claim a
 * built site by its code; it attaches that site to their account. Idempotent
 * for the same user, and refuses codes already claimed by someone else.
 */
export async function claimSite(
  _prev: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { ok: false, message: "Please sign in to claim your site." };
  }

  const code = normalizeClaimCode(String(formData.get("code") || ""));
  if (!code) return { ok: false, message: "Enter the claim code from your welcome email." };

  const [site] = await db
    .select()
    .from(forgeSites)
    .where(eq(forgeSites.claimCode, code))
    .limit(1);

  if (!site) {
    return { ok: false, message: "That code didn't match any site — double-check it and try again." };
  }
  const found = { businessName: site.businessName, liveUrl: site.liveUrl };

  if (site.claimedByUserId && site.claimedByUserId !== session.user.id) {
    return { ok: false, message: "This site has already been claimed by another account." };
  }
  if (site.claimedByUserId === session.user.id) {
    return { ok: true, message: `You've already claimed ${site.businessName}.`, site: found };
  }

  await db
    .update(forgeSites)
    .set({ claimedByUserId: session.user.id, claimedAt: new Date().toISOString() })
    .where(eq(forgeSites.id, site.id));

  revalidatePath("/portal");
  return {
    ok: true,
    message: `Success — ${site.businessName} is now linked to your account.`,
    site: found,
  };
}

export type RebuildState = { ok: boolean; message: string };

/**
 * Capture a "rebuild my existing site" request. We store the old URL and queue
 * it; the forge crawls + rebuilds it in our ecosystem as a follow-up step.
 */
export async function requestRebuild(
  _prev: RebuildState,
  formData: FormData,
): Promise<RebuildState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { ok: false, message: "Please sign in to request a rebuild." };
  }

  let url = String(formData.get("url") || "").trim();
  if (!url) return { ok: false, message: "Enter the URL of your existing website." };
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    new URL(url);
  } catch {
    return { ok: false, message: "That doesn't look like a valid website address." };
  }

  const businessName = String(formData.get("businessName") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;

  await db.insert(rebuildRequests).values({
    existingUrl: url,
    businessName,
    name: session.user.name ?? null,
    email: session.user.email,
    notes,
    status: "requested",
    requestedByUserId: session.user.id,
  });

  notifyTelegram(
    `🛠️ <b>Rebuild requested</b>\n${businessName ? businessName + " — " : ""}${url}\nby ${session.user.email}`,
  ).catch(() => {});

  return {
    ok: true,
    message: "Got it — we'll crawl your current site and rebuild it in our ecosystem. We'll be in touch shortly.",
  };
}

export type DomainState = { ok: boolean; message: string };

/**
 * Redeem a domain credit: capture the domain the client wants. For now this
 * logs the request + pings us; the auto-register (Vercel Domains) flow will
 * hook in here to check availability and purchase against the credit.
 */
export async function requestDomain(
  _prev: DomainState,
  formData: FormData,
): Promise<DomainState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, message: "Please sign in first." };

  const domain = String(formData.get("domain") || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
    return { ok: false, message: "Enter a valid domain, like yourbusiness.com." };
  }

  // Must have a paid site with a domain credit available.
  const credited = await db
    .select({ id: forgeSites.id, businessName: forgeSites.businessName })
    .from(forgeSites)
    .where(eq(forgeSites.claimedByUserId, session.user.id))
    .limit(50);
  const eligible = credited.length > 0;
  if (!eligible) {
    return { ok: false, message: "No active site with a domain credit found on your account." };
  }

  await db.insert(activityLog).values({
    actor: "client",
    eventType: "domain_requested",
    summary: `${session.user.email} wants domain ${domain}`,
    metadata: { detail: { domain, userId: session.user.id } },
  });
  notifyTelegram(`🌐 <b>Domain requested</b>\n${domain}\nby ${session.user.email}`).catch(() => {});

  return {
    ok: true,
    message: `Great — we'll set up ${domain} for you and point it at your site. We'll confirm by email shortly.`,
  };
}

export type CheckoutState = { ok: boolean; message: string; url?: string };

/**
 * Start Stripe Checkout for a claimed site: the $300 one-time build fee + the
 * chosen monthly plan, billed together on the first invoice (subscription mode).
 * Returns the hosted Checkout URL for the client to redirect to.
 */
export async function startCheckout(
  _prev: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, message: "Please sign in first." };
  if (!stripe) return { ok: false, message: "Payments aren't available right now." };

  const siteId = Number(formData.get("siteId"));
  const plan = String(formData.get("plan") || "");
  if (!Number.isFinite(siteId) || !isPlanKey(plan)) {
    return { ok: false, message: "Pick a plan to continue." };
  }

  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, siteId)).limit(1);
  if (!site) return { ok: false, message: "Site not found." };
  if (site.claimedByUserId !== session.user.id) {
    return { ok: false, message: "You can only pay for a site you've claimed." };
  }
  if (site.oneTimePaid) {
    return { ok: false, message: "This site is already active." };
  }

  const monthly = planPriceId(plan);
  const build = buildPriceId();
  if (!monthly || !build) {
    return { ok: false, message: "Plans aren't configured yet — hang tight." };
  }

  try {
    const customer = await ensureStripeCustomer(session.user.email, session.user.name);
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [
        { price: monthly, quantity: 1 },
        { price: build, quantity: 1 }, // one-time $300 — added to the first invoice
      ],
      success_url: `${SITE_URL}/portal?paid=1`,
      cancel_url: `${SITE_URL}/portal`,
      allow_promotion_codes: true,
      metadata: { siteId: String(siteId), userId: session.user.id, plan },
      subscription_data: { metadata: { siteId: String(siteId), plan } },
    });
    if (!checkout.url) return { ok: false, message: "Couldn't start checkout — try again." };
    return { ok: true, message: "Redirecting to checkout…", url: checkout.url };
  } catch (err) {
    console.error("[startCheckout] failed:", err);
    return { ok: false, message: "Something went wrong starting checkout." };
  }
}
