"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, gt, isNull } from "drizzle-orm";

import { db, forgeSites, rebuildRequests, activityLog } from "@/db";
import { auth } from "@/lib/auth";
import { normalizeClaimCode } from "@/lib/claim-code";
import { notifyTelegram } from "@/lib/telegram";
import { stripe, ensureStripeCustomer } from "@/lib/stripe";
import { buildPriceId, isPlanKey, planPriceId } from "@/lib/plans";
import { quoteDomain, domainsConfigured } from "@/lib/domains";
import { fulfillDomain } from "@/lib/domain-fulfill";

const DOMAIN_SERVICE_FEE = 3.99; // charged only on additional (no-credit) domains

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

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}
function isValidDomain(d: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d);
}

/** The user's first paid site that still has a free domain credit and no domain yet. */
async function siteWithDomainCredit(userId: string) {
  const [site] = await db
    .select()
    .from(forgeSites)
    .where(
      and(
        eq(forgeSites.claimedByUserId, userId),
        eq(forgeSites.oneTimePaid, true),
        gt(forgeSites.domainCredits, 0),
        isNull(forgeSites.domain),
      ),
    )
    .limit(1);
  return site ?? null;
}

export type DomainCheckState = {
  ok: boolean;
  message: string;
  domain?: string;
  available?: boolean;
  price?: number | null;
  hasCredit?: boolean;
  total?: number; // what the customer pays (0 with credit, else price + fee)
};

/** Check availability + price and whether the user has a free-domain credit. Read-only. */
export async function checkDomain(
  _prev: DomainCheckState,
  formData: FormData,
): Promise<DomainCheckState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, message: "Please sign in first." };
  if (!domainsConfigured()) return { ok: false, message: "Domain registration isn't available right now." };

  const domain = normalizeDomain(String(formData.get("domain") || ""));
  if (!isValidDomain(domain)) {
    return { ok: false, message: "Enter a valid domain, like yourbusiness.com." };
  }

  const quote = await quoteDomain(domain);
  if (!quote.available) {
    return { ok: true, domain, available: false, message: `${domain} isn't available — try another.` };
  }

  const credited = await siteWithDomainCredit(session.user.id);
  const hasCredit = Boolean(credited);
  const total = hasCredit ? 0 : (quote.price ?? 0) + DOMAIN_SERVICE_FEE;

  return {
    ok: true,
    domain,
    available: true,
    price: quote.price,
    hasCredit,
    total,
    message: hasCredit
      ? `${domain} is available — free with your credit.`
      : `${domain} is available for $${total.toFixed(2)} (domain + $${DOMAIN_SERVICE_FEE} service fee).`,
  };
}

export type DomainRegisterState = { ok: boolean; message: string };

/**
 * Register a domain against the user's free credit and point it at their site.
 * Real purchase only runs in live mode (with a registrant contact configured);
 * in test mode it simulates so the flow is testable without spending money.
 */
export async function registerFreeDomain(
  _prev: DomainRegisterState,
  formData: FormData,
): Promise<DomainRegisterState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, message: "Please sign in first." };

  const domain = normalizeDomain(String(formData.get("domain") || ""));
  if (!isValidDomain(domain)) return { ok: false, message: "That domain doesn't look right." };

  const site = await siteWithDomainCredit(session.user.id);
  if (!site) return { ok: false, message: "No free domain credit available on your account." };

  const quote = await quoteDomain(domain);
  if (!quote.available) return { ok: false, message: `${domain} isn't available anymore — try another.` };

  const { status } = await fulfillDomain(site.id, domain, false);
  if (status === "error" || status === "failed") {
    return { ok: false, message: "We couldn't register that domain automatically — we'll set it up manually and email you." };
  }
  // Spend the credit.
  await db.update(forgeSites).set({ domainCredits: 0 }).where(eq(forgeSites.id, site.id));

  return {
    ok: true,
    message:
      status === "registered"
        ? `Done — ${domain} is registered and being connected to your site (DNS can take up to an hour).`
        : `Reserved ${domain} for you — we'll finish connecting it and confirm by email shortly.`,
  };
}

export type DomainCheckoutState = { ok: boolean; message: string; url?: string };

/**
 * Paid domain purchase (no free credit): charge the domain price + $3.99 service
 * fee via Stripe. On payment, the webhook registers the domain + attaches it.
 */
export async function startDomainCheckout(
  _prev: DomainCheckoutState,
  formData: FormData,
): Promise<DomainCheckoutState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, message: "Please sign in first." };
  if (!stripe) return { ok: false, message: "Payments aren't available right now." };

  const domain = normalizeDomain(String(formData.get("domain") || ""));
  if (!isValidDomain(domain)) return { ok: false, message: "That domain doesn't look right." };

  // Attach to one of the user's paid sites that doesn't have a domain yet.
  const [site] = await db
    .select()
    .from(forgeSites)
    .where(
      and(
        eq(forgeSites.claimedByUserId, session.user.id),
        eq(forgeSites.oneTimePaid, true),
        isNull(forgeSites.domain),
      ),
    )
    .limit(1);
  if (!site) {
    return { ok: false, message: "You'll need an active site to connect a domain to." };
  }

  const quote = await quoteDomain(domain);
  if (!quote.available || quote.price == null) {
    return { ok: false, message: `${domain} isn't available anymore — try another.` };
  }

  try {
    const customer = await ensureStripeCustomer(session.user.email, session.user.name);
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customer.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(quote.price * 100),
            product_data: { name: `Domain: ${domain} (1 year)` },
          },
        },
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(DOMAIN_SERVICE_FEE * 100),
            product_data: { name: "Domain service fee" },
          },
        },
      ],
      success_url: `${SITE_URL}/portal/domain?bought=1`,
      cancel_url: `${SITE_URL}/portal/domain`,
      metadata: { action: "domain", domain, siteId: String(site.id), userId: session.user.id },
    });
    if (!checkout.url) return { ok: false, message: "Couldn't start checkout — try again." };
    return { ok: true, message: "Redirecting…", url: checkout.url };
  } catch (err) {
    console.error("[startDomainCheckout] failed:", err);
    return { ok: false, message: "Something went wrong starting checkout." };
  }
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
