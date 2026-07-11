"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, gt, isNull } from "drizzle-orm";

import { db, forgeSites, rebuildRequests, activityLog, leads } from "@/db";
import { auth } from "@/lib/auth";
import { normalizeClaimCode, generateClaimCode } from "@/lib/claim-code";
import { isForgeTemplate } from "@/lib/forge-templates";
import { notifyTelegram } from "@/lib/telegram";
import { sendBookingConfirmationEmail, sendNotificationEmail } from "@/lib/email";
import { stripe, ensureStripeCustomer } from "@/lib/stripe";
import { buildPriceId, isPlanKey, planPriceId, type BillingInterval } from "@/lib/plans";
import { quoteDomain, domainsConfigured } from "@/lib/domains";
import { fulfillDomain } from "@/lib/domain-fulfill";
import {
  BOOKING_TIMEZONE,
  SLOT_DURATION_MIN,
  createEvent,
  getAvailableSlots,
  isCalendarConfigured,
  isWindowFree,
  meetLinkOf,
} from "@/lib/gcal";

const DOMAIN_SERVICE_FEE = 3.99; // charged only on additional (no-credit) domains

export type ReceptionistState = { ok: boolean; message: string };

/**
 * Save a claimed site's AI-receptionist setup (from useActionState). Stores the config the
 * receptionist needs for THAT business (greeting, services, hours, escalation, FAQs) and flags
 * it `submitted` so the team provisions/activates the per-client agent. Owner-gated by claim.
 */
export async function saveReceptionistSetup(
  _prev: ReceptionistState,
  formData: FormData,
): Promise<ReceptionistState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, message: "Please sign in." };

  const siteId = Number(formData.get("siteId"));
  if (!Number.isFinite(siteId)) return { ok: false, message: "Missing site." };

  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, siteId)).limit(1);
  if (!site || site.claimedByUserId !== session.user.id) {
    return { ok: false, message: "We couldn't find that site on your account." };
  }

  const str = (k: string) => String(formData.get(k) || "").trim();
  const config = {
    services: str("services"),
    hours: str("hours"),
    greeting: str("greeting"),
    booking: str("booking"),
    forwardTo: str("forwardTo"),
    faqs: str("faqs"),
    doNot: str("doNot"),
    updatedAt: new Date().toISOString(),
  };
  if (!config.services && !config.greeting) {
    return { ok: false, message: "Tell us at least what your business does and how to greet callers." };
  }

  // The receptionist ships with Website + Voice (and Complete). Without a paid voice
  // plan we still save the config as a draft — but we don't hand it to the team to
  // provision. That keeps registration self-serve while the actual activation is gated.
  const hasVoicePlan =
    site.oneTimePaid === true && (site.plan === "voice" || site.plan === "complete");

  if (!hasVoicePlan) {
    await db
      .update(forgeSites)
      .set({ receptionistConfig: config, updatedAt: new Date().toISOString() })
      .where(eq(forgeSites.id, siteId));
    revalidatePath(`/portal/receptionist/${siteId}`);
    revalidatePath("/portal");
    return {
      ok: true,
      message: "Draft saved. Add the Website + Voice plan and we'll switch your receptionist on.",
    };
  }

  // On a voice plan → register it: flag submitted (unless already active), notify the
  // team to provision the per-client agent, and confirm to the customer by email.
  const nextStatus = site.receptionistStatus === "active" ? "active" : "submitted";
  await db
    .update(forgeSites)
    .set({ receptionistConfig: config, receptionistStatus: nextStatus, updatedAt: new Date().toISOString() })
    .where(eq(forgeSites.id, siteId));

  await db.insert(activityLog).values({
    actor: "portal",
    eventType: "receptionist_setup_submitted",
    summary: `Receptionist setup submitted — ${site.businessName}`,
    metadata: { detail: { siteId, userId: session.user.id } },
  });
  notifyTelegram(
    `🎙️ <b>Receptionist setup submitted</b>\n${site.businessName} (#${siteId}) — ready to provision the per-client voice agent.`,
  ).catch(() => {});

  // Customer confirmation — mirrors the "we'll confirm by email" promise below.
  sendNotificationEmail({
    to: session.user.email,
    subject: `We've got your receptionist setup — ${site.businessName}`,
    heading: "Your AI receptionist is being set up 🎙️",
    message:
      "Thanks — we've received your receptionist details and our team is provisioning your AI phone agent now. " +
      "We'll email you the moment it's live. You can update your answers any time from the portal.",
    ctaUrl: `${SITE_URL}/portal/receptionist/${siteId}`,
    ctaLabel: "Review your setup",
  }).catch((err) => console.error("[receptionist] confirmation email failed:", err));

  revalidatePath(`/portal/receptionist/${siteId}`);
  revalidatePath("/portal");
  return { ok: true, message: "Saved — our team will activate your receptionist and confirm by email." };
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";

export type ClaimState = {
  ok: boolean;
  message: string;
  site?: { id: number; businessName: string; liveUrl: string | null };
  building?: boolean; // true when the claim just triggered the forge to build the site
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
  const found = { id: site.id, businessName: site.businessName, liveUrl: site.liveUrl };

  if (site.claimedByUserId && site.claimedByUserId !== session.user.id) {
    return { ok: false, message: "This site has already been claimed by another account." };
  }
  if (site.claimedByUserId === session.user.id) {
    return { ok: true, message: `You've already claimed ${site.businessName}.`, site: found };
  }

  // Sell-first flow: the owner may be claiming a PREVIEW that hasn't been built yet.
  // Claiming is the build trigger — queue it for the forge (status='approved', which
  // forge-poll picks up). If the site is already built, just link it (old behavior).
  const alreadyBuilt = site.status === "built" || !!site.liveUrl;
  const nowIso = new Date().toISOString();

  await db
    .update(forgeSites)
    .set({
      claimedByUserId: session.user.id,
      claimedAt: nowIso,
      ...(alreadyBuilt ? {} : { status: "approved", approvedAt: nowIso }),
    })
    .where(eq(forgeSites.id, site.id));

  await db.insert(activityLog).values({
    actor: "portal",
    eventType: alreadyBuilt ? "site_claimed" : "site_claimed_build_queued",
    summary: `${site.businessName} (${site.slug}) claimed${alreadyBuilt ? "" : " — build queued"}`,
    metadata: { target: site.slug, detail: { siteId: site.id, userId: session.user.id } },
  });

  revalidatePath("/portal");
  return {
    ok: true,
    building: !alreadyBuilt,
    message: alreadyBuilt
      ? `Success — ${site.businessName} is now linked to your account.`
      : `${site.businessName} is claimed — we're building your site now. It'll appear in your portal shortly.`,
    site: found,
  };
}

export type TemplateChoiceState = { ok: boolean; message: string };

/**
 * Let a claimed owner pick a different design template for their site. Sets
 * preferred_template and re-queues the site (status='approved') so the forge
 * rebuilds it on that template. The forge niche-matches by default; this overrides.
 */
export async function chooseTemplate(
  siteId: number,
  template: string,
): Promise<TemplateChoiceState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, message: "Please sign in." };

  if (!isForgeTemplate(template)) {
    return { ok: false, message: "That isn't a template we offer." };
  }

  const [site] = await db
    .select()
    .from(forgeSites)
    .where(eq(forgeSites.id, siteId))
    .limit(1);

  if (!site || site.claimedByUserId !== session.user.id) {
    return { ok: false, message: "We couldn't find that site on your account." };
  }
  if (site.preferredTemplate === template && site.status !== "built") {
    return { ok: true, message: "That design is already being built." };
  }

  await db
    .update(forgeSites)
    .set({
      preferredTemplate: template,
      status: "approved",
      approvedAt: new Date().toISOString(),
      revisionNote: null, // a template switch is a clean rebuild, not a tweak
    })
    .where(eq(forgeSites.id, siteId));

  await db.insert(activityLog).values({
    actor: "portal",
    eventType: "forge_template_chosen",
    summary: `${site.businessName} (${site.slug}) — owner chose ${template} template`,
    metadata: { target: site.slug, detail: { siteId, template, userId: session.user.id } },
  });

  revalidatePath("/portal");
  return {
    ok: true,
    message: `Rebuilding ${site.businessName} with the ${template.replace(/-/g, " ")} design — check back shortly.`,
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
  const interval: BillingInterval = String(formData.get("interval")) === "year" ? "year" : "month";
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

  const price = planPriceId(plan, interval);
  const build = buildPriceId();
  if (!price || !build) {
    return { ok: false, message: "Plans aren't configured yet — hang tight." };
  }

  try {
    const customer = await ensureStripeCustomer(session.user.email, session.user.name);
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [
        { price, quantity: 1 },
        { price: build, quantity: 1 }, // one-time $300 — added to the first invoice
      ],
      success_url: `${SITE_URL}/portal?paid=1`,
      cancel_url: `${SITE_URL}/portal`,
      allow_promotion_codes: true,
      metadata: { siteId: String(siteId), userId: session.user.id, plan, interval },
      subscription_data: { metadata: { siteId: String(siteId), plan, interval } },
    });
    if (!checkout.url) return { ok: false, message: "Couldn't start checkout — try again." };
    return { ok: true, message: "Redirecting to checkout…", url: checkout.url };
  } catch (err) {
    console.error("[startCheckout] failed:", err);
    return { ok: false, message: "Something went wrong starting checkout." };
  }
}

// ── Book a call with Joe (portal, logged-in) ────────────────────────────────
// A logged-in client can book a 30-min strategy call in Joe's regular window
// (Mon–Fri 11am–1pm Pacific) straight from the dashboard. Unlike the public
// booking flow (`/api/appointments/book`, gated by a Turnstile intake token),
// the session IS the gate here — identity comes from the signed-in user, so no
// token is needed. Same calendar/Meet/confirmation path as the voice + web flows.

export type PortalSlot = { start: string; end: string };

/**
 * Open 30-min slots for a given date (YYYY-MM-DD) in Joe's regular window, for the
 * logged-in client's booking page. Auth-gated so the schedule isn't public.
 */
export async function getPortalSlots(
  date: string,
): Promise<{ ok: boolean; slots: PortalSlot[]; message?: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, slots: [], message: "Please sign in." };
  if (!isCalendarConfigured()) return { ok: false, slots: [], message: "Booking isn't available right now." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, slots: [], message: "Invalid date." };
  try {
    const slots = await getAvailableSlots(date); // default = regular 11–1 PT window
    return { ok: true, slots };
  } catch (err) {
    console.error("[getPortalSlots] failed:", err);
    return { ok: false, slots: [], message: "Could not load availability." };
  }
}

export type BookState = { ok: boolean; message: string; whenLabel?: string };

/**
 * Book a 30-min strategy call with Joe for the logged-in client. Re-checks the
 * window is free, creates the Google Calendar event (with Meet), records/updates
 * the lead, emails the branded confirmation, and pings the team.
 */
export async function bookStrategyCall(
  _prev: BookState,
  formData: FormData,
): Promise<BookState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, message: "Please sign in to book." };
  if (!isCalendarConfigured()) return { ok: false, message: "Booking isn't available right now." };

  const startTime = String(formData.get("startTime") || "");
  const reason = String(formData.get("reason") || "").trim();
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) return { ok: false, message: "Pick a time slot to continue." };
  const end = new Date(start.getTime() + SLOT_DURATION_MIN * 60000);

  const name = session.user.name || session.user.email;
  const email = session.user.email;

  try {
    if (!(await isWindowFree(start.toISOString(), end.toISOString()))) {
      return { ok: false, message: "That time was just taken — please pick another slot." };
    }

    const description = [
      `Strategy call booked from the client portal by ${name}.`,
      ``,
      `Name: ${name}`,
      `Email: ${email}`,
      reason ? `` : null,
      reason ? `What they want to talk about:\n${reason}` : null,
    ]
      .filter((l): l is string => l !== null)
      .join("\n");

    const event = await createEvent({
      summary: `Strategy Call — ${name}`,
      description,
      start: { dateTime: start.toISOString(), timeZone: BOOKING_TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: BOOKING_TIMEZONE },
      attendees: [{ email, displayName: name }],
      conferenceData: {
        createRequest: {
          requestId: `tbj-portal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 60 },
          { method: "popup", minutes: 15 },
        ],
      },
    });

    const meetLink = meetLinkOf(event);

    // Record the lead so the booking shows on /command/appointments like every other.
    const existing = await db.select({ id: leads.id }).from(leads).where(eq(leads.email, email)).limit(1);
    if (existing.length > 0) {
      await db
        .update(leads)
        .set({
          status: "booked",
          bookedSlot: start.toISOString(),
          gcalEventId: event.id || null,
          gcalHtmlLink: event.htmlLink || null,
          meetLink,
        })
        .where(eq(leads.email, email))
        .catch((err) => console.error("[bookStrategyCall] lead update failed:", err));
    } else {
      await db
        .insert(leads)
        .values({
          name,
          email,
          notes: reason || "Booked from the client portal",
          status: "booked",
          bookedSlot: start.toISOString(),
          source: "booking-page",
          gcalEventId: event.id || null,
          gcalHtmlLink: event.htmlLink || null,
          meetLink,
        })
        .catch((err) => console.error("[bookStrategyCall] lead insert failed:", err));
    }

    const whenLabel = `${start.toLocaleString("en-US", { timeZone: BOOKING_TIMEZONE, dateStyle: "full", timeStyle: "short" })} Pacific`;

    sendBookingConfirmationEmail({ to: email, name, whenLabel, meetLink }).catch((err) =>
      console.error("[bookStrategyCall] confirmation email failed:", err),
    );
    notifyTelegram(
      `📅 <b>New strategy call booked</b> (from the portal)\n${name} · ${email}\n${whenLabel}${reason ? `\nReason: ${reason}` : ""}`,
    ).catch(() => {});
    await db
      .insert(activityLog)
      .values({
        actor: "portal",
        eventType: "booking_made",
        summary: `${name} booked a strategy call from the portal`,
        metadata: { email, startTime: start.toISOString(), eventId: event.id },
      })
      .catch((err) => console.error("[bookStrategyCall] activity_log insert failed:", err));

    revalidatePath("/portal/book");
    return { ok: true, message: `You're booked for ${whenLabel}. A calendar invite with the video link is on its way to ${email}.`, whenLabel };
  } catch (err) {
    console.error("[bookStrategyCall] failed:", err);
    return { ok: false, message: "Something went wrong booking that — please try another slot." };
  }
}

/**
 * Request a call OUTSIDE Joe's regular 11–1 PT window. Unlike bookStrategyCall this does NOT
 * touch the calendar — it records the ask as a lead and pings Joe (Telegram + email) so he can
 * confirm a time manually. Auth-gated; identity comes from the session.
 */
export async function requestCallOutsideWindow(
  _prev: BookState,
  formData: FormData,
): Promise<BookState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, message: "Please sign in to request a time." };

  const preferred = String(formData.get("preferred") || "").trim();
  const reason = String(formData.get("reason") || "").trim();
  if (!preferred) return { ok: false, message: "Tell us roughly when works for you." };

  const name = session.user.name || session.user.email;
  const email = session.user.email;

  try {
    const note = `OUT-OF-WINDOW CALL REQUEST — prefers: ${preferred}${reason ? ` · ${reason}` : ""}`;
    const existing = await db.select({ id: leads.id }).from(leads).where(eq(leads.email, email)).limit(1);
    if (existing.length > 0) {
      await db.update(leads).set({ status: "new", notes: note }).where(eq(leads.email, email)).catch(() => {});
    } else {
      await db.insert(leads).values({ name, email, notes: note, status: "new", source: "booking-page" }).catch(() => {});
    }

    notifyTelegram(
      `🗓️ <b>Call request (outside 11–1)</b>\n${name} · ${email}\nPrefers: ${preferred}${reason ? `\nReason: ${reason}` : ""}\n→ confirm a time + send them an invite.`,
    ).catch(() => {});
    sendNotificationEmail({
      to: process.env.SUPPORT_EMAIL || process.env.EMAIL_FROM || "joe@thinkbigjoe.com",
      subject: `Out-of-window call request — ${name}`,
      heading: "Someone wants a call outside 11–1",
      message: `${name} (${email}) requested a call outside your regular window.\n\nThey prefer: ${preferred}${reason ? `\nReason: ${reason}` : ""}\n\nReply to them to confirm a time.`,
    }).catch(() => {});

    return {
      ok: true,
      message: "Got it — Joe will reach out to confirm a time that works and send you a calendar invite.",
    };
  } catch (err) {
    console.error("[requestCallOutsideWindow] failed:", err);
    return { ok: false, message: "Something went wrong sending that request — please try again." };
  }
}

// ── Inbound "build me a site" intake (customers who come without our outreach) ──
export type BuildState = { ok: boolean; message: string };

/**
 * Queue a fresh from-scratch site build for a logged-in customer. Inserts a forge_sites
 * row owned by them with status='approved' so the forge poller builds it. The 7-day trial
 * starts once it's built (see lib/trial.ts).
 */
export async function requestSiteBuild(
  _prev: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, message: "Please sign in first." };

  const str = (k: string) => String(formData.get(k) || "").trim();
  const businessName = str("businessName");
  const niche = str("niche");
  const city = str("city");
  const phone = str("phone");
  const email = str("email") || session.user.email;
  const brandColor = str("brandColor");
  if (!businessName || !niche) {
    return { ok: false, message: "Please tell us your business name and what you do." };
  }

  const base = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "site";
  const slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;

  try {
    await db.insert(forgeSites).values({
      slug,
      businessName,
      niche,
      city: city || null,
      phone: phone || null,
      email: email || null,
      brandColor: brandColor || null,
      status: "approved", // queues the forge build
      source: "inbound",
      claimCode: generateClaimCode(),
      claimedByUserId: session.user.id,
      claimedAt: new Date().toISOString(),
    });

    await db.insert(activityLog).values({
      actor: "portal",
      eventType: "forge_prospect_added",
      summary: `Inbound build request — ${businessName}`,
      metadata: { detail: { businessName, niche, city, userId: session.user.id, source: "inbound" } },
    }).catch(() => {});
    notifyTelegram(
      `🧱 <b>Inbound build request</b>\n${businessName} (${niche}${city ? ` · ${city}` : ""}) — queued to build.`,
    ).catch(() => {});

    revalidatePath("/portal");
    return { ok: true, message: "Got it — we're building your site now. It'll show up in your portal shortly, and you'll have 7 days to play with it." };
  } catch (err) {
    console.error("[requestSiteBuild] failed:", err);
    return { ok: false, message: "Something went wrong queuing your build — please try again." };
  }
}
