import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, ne } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { PLANS, PLAN_KEYS, planIncludesVoiceMinutes, type PlanKey } from "@/lib/plans";
import { currentPeriodUsage } from "@/lib/voice-usage";
import { StatGrid, StatTile } from "@/components/ui";
import { UsageMeter, usageTone } from "./usage-meter";

// The customer's own view of their minutes, so an overage line on an invoice is never the first
// time they hear about it.
//
// Every number rendered here comes from currentPeriodUsage() — which gets its allowance and rate
// from plans.ts. This page computes NO pricing of its own on purpose: if it derived the overage
// dollar figure itself, a rate change would leave the portal quoting one number while Stripe
// charged another, and the customer would catch us being wrong about their bill.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Usage", robots: { index: false, follow: false } };

/** Money as a customer reads a bill: $12 not $12.00, but $12.50 keeps its cents. */
function usd(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function daysLeftUntil(end: Date): number {
  // Clamped at 0: a period that has rolled over but whose usage hasn't been recalculated yet
  // should read "resets today", never "-1 days".
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86_400_000));
}

/** Cheapest SELLABLE tier with a bigger allowance than the current one, or null if already top. */
function nextTierUp(tier: PlanKey | null): PlanKey | null {
  const current = tier ? PLANS[tier].includedMinutes : 0;
  return (
    PLAN_KEYS.filter((k) => PLANS[k].includedMinutes > current).sort(
      (a, b) => PLANS[a].monthly - PLANS[b].monthly,
    )[0] ?? null
  );
}

export default async function PortalUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/usage");
  const { user } = session;

  // HARD SECURITY BOUNDARY — same rule as /portal/calls. The site id handed to currentPeriodUsage()
  // comes only out of THIS claimed-by-me query; `?site=` is matched against the result, never
  // queried directly. A slip here shows one business another business's call volume.
  const sites = await db
    .select({ id: forgeSites.id, businessName: forgeSites.businessName })
    .from(forgeSites)
    .where(and(eq(forgeSites.claimedByUserId, user.id), ne(forgeSites.status, "deleted")))
    // Same ordering as /portal/calls, so a multi-site owner doesn't land on a different business
    // depending on which page they opened.
    .orderBy(asc(forgeSites.id));

  const { site: siteParam } = await searchParams;
  const site = sites.find((s) => String(s.id) === siteParam) ?? sites[0];

  const header = (
    <>
      <Link href="/portal" className="text-sm font-semibold text-brand hover:underline">
        ← Back to portal
      </Link>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Your minutes</h1>
    </>
  );

  const shell = (children: React.ReactNode) => (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">{children}</main>
  );

  if (!site) {
    return shell(
      <>
        {header}
        <p className="mt-3 leading-relaxed text-ink-soft">
          Your AI receptionist attaches to your website, so minutes show up here once you have a site.
        </p>
        <Link
          href="/portal/claim"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          Claim your site
        </Link>
      </>,
    );
  }

  const usage = await currentPeriodUsage(site.id);
  const { tier, minutes, calls, includedMinutes, overageMinutes, overageDueCents, period } = usage;

  const siteSwitcher = sites.length > 1 && (
    <div className="mt-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Which business?</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {sites.map((s) => {
          const active = s.id === site.id;
          return (
            <Link
              key={s.id}
              href={`/portal/usage?site=${s.id}`}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
                active
                  ? "border-brand bg-brand-tint text-brand"
                  : "border-line bg-background text-ink-soft hover:bg-surface hover:text-ink"
              }`}
            >
              {s.businessName}
            </Link>
          );
        })}
      </div>
    </div>
  );

  const upgradeKey = nextTierUp(tier);
  const upgrade = upgradeKey
    ? {
        label: PLANS[upgradeKey].label,
        monthly: PLANS[upgradeKey].monthly,
        minutes: PLANS[upgradeKey].includedMinutes,
        /** Extra per month to move up — the number to weigh against the overage. */
        deltaMonthly: PLANS[upgradeKey].monthly - (tier ? PLANS[tier].monthly : 0),
      }
    : null;

  // No receptionist on this tier. Branching on planIncludesVoiceMinutes() rather than
  // `includedMinutes === 0` is required by plans.ts: a $99 website customer has no minutes
  // CONCEPT, and rendering them a 0-of-0 meter would read as "100% used" on a product they
  // never bought. This is an offer, not a usage report.
  if (!planIncludesVoiceMinutes(tier)) {
    return shell(
      <>
        {header}
        <p className="mt-1 text-sm text-ink-soft">
          Minutes are for the AI receptionist that answers your phone.
        </p>
        {siteSwitcher}
        <div className="mt-6 rounded-2xl border border-line bg-surface p-6 text-center">
          <p className="text-2xl" aria-hidden>
            📞
          </p>
          <p className="mt-2 font-bold tracking-tight">
            Your plan doesn&apos;t include a receptionist yet.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            {upgrade ? (
              <>
                {upgrade.label} adds someone to answer every call — day, night and weekends — with{" "}
                {upgrade.minutes.toLocaleString()} minutes a month included, for $
                {upgrade.monthly.toLocaleString()}/mo.
              </>
            ) : (
              <>Add the AI receptionist and every missed call becomes a booked job instead.</>
            )}
          </p>
          <Link
            href="/portal/billing"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            See plans
          </Link>
        </div>
      </>,
    );
  }

  // currentPeriodUsage() returns period: null when no billing window could be established, and
  // zeroes the usage rather than attributing calls to an imaginary month. Say so plainly instead
  // of rendering a confident "0 of 400" that the customer would reasonably read as "quiet month".
  if (!period) {
    return shell(
      <>
        {header}
        <p className="mt-1 text-sm text-ink-soft">
          For <span className="font-semibold text-ink">{site.businessName}</span>.
        </p>
        {siteSwitcher}
        <div className="mt-6 rounded-2xl border border-line bg-surface p-6 text-center">
          <p className="mt-2 font-bold tracking-tight">We&apos;re still setting up your billing month.</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            Your minutes will show here as soon as your first invoice date is set — and your
            receptionist is answering in the meantime.
          </p>
          <Link
            href={`/portal/calls?site=${site.id}`}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full border border-line px-6 text-sm font-semibold transition-colors hover:bg-background"
          >
            See your calls
          </Link>
        </div>
      </>,
    );
  }

  const tone = usageTone(usage.pctUsed);
  const daysLeft = daysLeftUntil(period.end);
  const remaining = Math.max(0, includedMinutes - minutes);
  // The rate the customer is actually on, from their own plan — not a hardcoded 50.
  const rateCents = Math.round((tier ? PLANS[tier].overagePerMinute : 0) * 100);
  const resetPhrase = daysLeft === 0 ? "today" : `in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;

  return shell(
    <>
      {header}
      <p className="mt-1 text-sm text-ink-soft">
        How much your AI receptionist talked for{" "}
        <span className="font-semibold text-ink">{site.businessName}</span> this month.
      </p>

      {siteSwitcher}

      {/* The headline sentence IS the page — "You've used 310 of your 400 minutes" answers the
          only question they came with. Everything below it is supporting detail. */}
      <section className="mt-6 rounded-2xl border border-line bg-background p-5 sm:p-6">
        <p className="text-lg font-bold leading-snug tracking-tight sm:text-xl">
          {tone === "over" ? (
            <>
              You&apos;ve used all {includedMinutes.toLocaleString()} of your minutes this month —
              plus {overageMinutes.toLocaleString()} more.
            </>
          ) : (
            <>
              You&apos;ve used {minutes.toLocaleString()} of your {includedMinutes.toLocaleString()}{" "}
              minutes this month.
            </>
          )}
        </p>

        <div className="mt-4">
          <UsageMeter minutesUsed={minutes} includedMinutes={includedMinutes} tone={tone} />
        </div>

        {tone === "ok" && (
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            {remaining.toLocaleString()} left, and they reset {resetPhrase}. Nothing to do.
          </p>
        )}

        {tone === "near" && (
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            You&apos;re getting close — about {remaining.toLocaleString()}{" "}
            {remaining === 1 ? "minute" : "minutes"} left, resetting {resetPhrase}.{" "}
            <span className="font-semibold text-ink">Your phone keeps getting answered either way</span>
            {rateCents > 0 && <> — if you go over, extra minutes are just {usd(rateCents)} each</>}.
          </p>
        )}

        {tone === "over" && (
          <div className="mt-3 space-y-2 text-sm leading-relaxed text-ink-soft">
            {/* The most important sentence on this page, and it goes FIRST. Policy: overage BILLS,
                it never throttles. A customer who suspects their business line might stop
                answering will start avoiding calls to save minutes — costing them jobs and us
                the account. Never imply service can be interrupted, because it can't be. */}
            <p>
              <span className="font-semibold text-ink">
                Your phone is still being answered, every time.
              </span>{" "}
              We never stop taking your calls — going over just costs a little extra.
            </p>
            <p>
              So far that&apos;s{" "}
              <span className="font-semibold text-ink">
                {overageMinutes.toLocaleString()} extra{" "}
                {overageMinutes === 1 ? "minute" : "minutes"} = {usd(overageDueCents)}
              </span>
              , which shows up as one line on your next invoice. Your minutes reset {resetPhrase}.
            </p>
          </div>
        )}
      </section>

      <div className="mt-4">
        <StatGrid cols={3}>
          <StatTile
            label="Minutes used"
            value={minutes.toLocaleString()}
            sub={`of ${includedMinutes.toLocaleString()} included`}
            accent
          />
          <StatTile label="Calls answered" value={calls.toLocaleString()} sub="this billing month" />
          <StatTile
            label={daysLeft === 1 ? "Day left" : "Days left"}
            value={daysLeft.toLocaleString()}
            sub="until your minutes reset"
          />
        </StatGrid>
      </div>

      {/* Shown only when they're over AND the maths genuinely favours them. Pitching an upgrade to
          someone whose overage costs less than the price difference is a bad-faith upsell — a
          small business owner will do that arithmetic, and getting caught at it is unrecoverable. */}
      {tone === "over" && upgrade && overageDueCents > upgrade.deltaMonthly * 100 && (
        <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-bold tracking-tight">There&apos;s a cheaper way to do this</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            Moving up to <span className="font-semibold text-ink">{upgrade.label}</span> costs $
            {upgrade.deltaMonthly.toLocaleString()} more a month and includes{" "}
            {upgrade.minutes.toLocaleString()} minutes — less than the {usd(overageDueCents)} of
            extra minutes you&apos;ve already used this month.
          </p>
          <Link
            href="/portal/billing"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            Look at {upgrade.label}
          </Link>
        </section>
      )}

      <p className="mt-6 text-xs leading-relaxed text-ink-soft">
        A minute is time your receptionist spent on the phone, totalled across the month.
        {rateCents > 0 && (
          <> Extra minutes beyond your plan are {usd(rateCents)} each, billed on your next invoice.</>
        )}{" "}
        Your service is never interrupted.{" "}
        <Link href={`/portal/calls?site=${site.id}`} className="font-semibold text-brand hover:underline">
          See the calls
        </Link>{" "}
        ·{" "}
        <Link href="/portal/billing" className="font-semibold text-brand hover:underline">
          Billing
        </Link>
      </p>
    </>,
  );
}
