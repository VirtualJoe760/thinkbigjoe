/**
 * Voice minute usage — the single source of truth for "how many minutes has this site used this
 * billing period, and where does that put them against their allowance."
 *
 * Three consumers, one query, on purpose:
 *   1. the portal counter a customer sees mid-month,
 *   2. the 80% / 100% warning cron,
 *   3. the monthly overage billing job.
 * If they read from different places they WILL disagree, and the customer-visible number will
 * stop matching the invoice. Everything goes through here.
 *
 * ── THE RULE THIS MODULE MUST NOT BREAK ──────────────────────────────────────────────────────
 * Overage BILLS. It never throttles, gates, degrades or disconnects. This is the customer's
 * business phone line — a plumber whose line dies at minute 401 loses jobs and blames us, and no
 * overage revenue covers that churn. Nothing in this file returns a "cut them off" signal, and no
 * caller should invent one. `pctUsed` above 100 is a billing fact and a warning trigger; it is
 * never an authorization decision.
 *
 * That rule is also what makes this module allowed to be simple. Because service never depends on
 * the billing state, usage may be computed lazily, batched, and re-derived after the fact. If we
 * ever DID gate on minutes, this would need to be real-time inside the call path and the whole
 * design would have to change — so if you are here to add gating, stop and re-read the paragraph
 * above.
 *
 * Aggregation happens IN SQL. The `calls` table is per-call and unbounded; this project has a
 * documented Neon egress constraint (see MEMORY / docs), so we never SELECT call rows to sum them
 * in JS. Every query here returns one row per site.
 */
import { sql } from "drizzle-orm";

import { db } from "@/db";
import {
  includedMinutes as planIncludedMinutes,
  isPlanKey,
  minutesUsedFraction,
  overageCents,
  overageMinutes as planOverageMinutes,
  planIncludesVoiceMinutes,
  type PlanKey,
} from "@/lib/plans";

// ── Policy constants ────────────────────────────────────────────────────────────────────────

// The allowance, the overage rate and the warning thresholds all live in plans.ts and are
// deliberately NOT re-declared here. This module measures usage; plans.ts decides what usage
// costs. Duplicating either number is how the portal counter and the invoice start disagreeing.

/**
 * Measured marginal Retell cost per minute, in cents, from the live account.
 *
 * ⚠️ This is an ESTIMATE INPUT, not a truth. The `calls` table has no cost column today, so
 * `costCents` in the return shapes is derived from minutes × this constant and flagged
 * `costIsEstimated: true`. Retell sends real per-call cost as `call.call_cost` on the webhook —
 * once someone adds a `cost_cents` column to `calls` and the webhook persists it, switch the
 * SUM below to the real column and flip the flag. See the note at COST_SOURCE_SQL.
 *
 * This number is also the denominator of the whole margin argument for the pricing ladder, so it
 * should be re-derived from real `call_cost` values periodically rather than trusted forever.
 */
export const RETELL_COST_CENTS_PER_MINUTE = 18;

// ── Types ───────────────────────────────────────────────────────────────────────────────────

export type PeriodUsage = {
  /** Whole minutes used in the window. Floored — see roundMinutes(). */
  minutes: number;
  /** Raw seconds behind `minutes`, kept so callers can show "7m 12s" without a second query. */
  seconds: number;
  /** Calls that contributed duration (i.e. excludes never-connected calls). */
  calls: number;
  /** Calls in the window with a null `duration_sec` — connected never / webhook never landed. */
  callsWithoutDuration: number;
  /** Our cost, in cents. See `costIsEstimated`. */
  costCents: number;
  /** True while `calls` has no cost column and costCents is minutes × RETELL_COST_CENTS_PER_MINUTE. */
  costIsEstimated: boolean;
};

export type BillingPeriod = { start: Date; end: Date };

export type CurrentPeriodUsage = PeriodUsage & {
  siteId: number;
  /** The resolved plan key, or null if the site has no plan / an unrecognized one. */
  tier: PlanKey | null;
  /** Raw `forge_sites.plan` text, so a caller can report an unrecognized value honestly. */
  rawPlan: string | null;
  includedMinutes: number;
  /** Minutes beyond the allowance. 0 when inside it — never negative. */
  overageMinutes: number;
  overageDueCents: number;
  /**
   * Percent of allowance consumed, 0–∞ (140 means 40% over). `null`, NOT 0, when the plan
   * includes no voice at all — there is no denominator, and reporting 0% would make a
   * website-tier site look healthy on a dashboard that's really just not applicable to it.
   */
  pctUsed: number | null;
  /** False when the site has no plan or a voiceless plan — usage is informational only. */
  hasVoice: boolean;
  /**
   * The window measured, or null when no billing period could be established (never paid /
   * never claimed). Callers must handle null rather than assuming "this month".
   */
  period: BillingPeriod | null;
};

export type ThresholdSite = CurrentPeriodUsage & {
  businessName: string | null;
  /** pctUsed re-stated as a definite number — sites without voice never appear in this list. */
  pctUsed: number;
};

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────

// neon-http db.execute returns either a bare array or {rows}; normalize. (Same shim as
// src/lib/forge-stats.ts — kept local rather than shared to avoid a cross-module dependency for
// six lines.)
function rowsOf(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}
const num = (v: unknown): number => (v == null ? 0 : Number(v));

/**
 * Seconds → billable minutes, ROUNDED DOWN.
 *
 * Deliberately in the customer's favour at the boundary: a site that used 400 min 59 sec against
 * a 400-minute allowance owes nothing. Rounding each call up (the telco habit) would manufacture
 * overage out of nothing on a high-volume, short-call business — 300 two-second wrong numbers
 * would bill as 300 minutes. We floor the PERIOD TOTAL, once, not per call, for the same reason.
 */
export function roundMinutes(totalSeconds: number): number {
  return Math.floor(Math.max(0, totalSeconds) / 60);
}

/**
 * Narrow the free-text `forge_sites.plan` column to a PlanKey.
 *
 * That column is untyped text and can hold a value no longer in the ladder (or a typo). Returning
 * null rather than guessing keeps the "unknown plan" case visible: an unknown plan has no
 * allowance, so it is reported as no-voice and never billed for overage. Silently defaulting it to
 * a tier would invent an allowance — and therefore invent an invoice.
 */
export function planKeyOf(plan: string | null | undefined): PlanKey | null {
  return isPlanKey(plan) ? plan : null;
}

/**
 * The site's live billing period.
 *
 * We do not store `current_period_start/end` — Stripe owns the real subscription clock and we
 * never mirrored it. So the period is DERIVED from the site's billing anchor: the monthly
 * anniversary of `paid_at`, falling back to `claimed_at`. This matches how a Stripe monthly
 * subscription actually renews (same day-of-month), and Postgres/JS month arithmetic clamps short
 * months identically (Jan 31 → Feb 28), so the two agree.
 *
 * Returns null when there is no anchor at all — an unclaimed or never-paid site has no billing
 * period, and inventing "calendar month" for it would silently attribute usage to a period that
 * was never billed. Callers must handle null.
 *
 * ⚠️ If we ever start persisting Stripe's real period bounds on the subscription, THIS is the
 * function to replace, and it should win over the derived anchor — Stripe's clock is canonical
 * for what actually gets invoiced.
 */
export function periodForAnchor(anchor: Date | null, now: Date = new Date()): BillingPeriod | null {
  if (!anchor || Number.isNaN(anchor.getTime())) return null;
  if (anchor > now) return null; // anchor in the future: no period has begun yet

  // Whole months elapsed since the anchor, then clamp the day like Stripe/Postgres do.
  let months =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  const candidate = addMonthsUTC(anchor, months);
  if (candidate > now) {
    months -= 1; // we're before this month's anniversary day; the period started last month
  }
  const start = addMonthsUTC(anchor, months);
  return { start, end: addMonthsUTC(anchor, months + 1) };
}

/** Add whole months in UTC, clamping the day to the target month's length (Jan 31 + 1m = Feb 28). */
function addMonthsUTC(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const targetLastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), targetLastDay);
  return new Date(
    Date.UTC(y, m, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()),
  );
}

/**
 * The SQL expression that produces cost, in cents, for a set of calls.
 *
 * Today: derived from duration, because `calls` has NO cost column. Retell already sends real
 * per-call cost (`call.call_cost` on the call_ended webhook) and we throw it away.
 *
 * TO SWITCH TO REAL COST: add `cost_cents integer` to `calls`, persist it in the voice webhook,
 * then change this to `coalesce(sum(c.cost_cents), 0)` and return costIsEstimated: false. Both of
 * those files are owned elsewhere — this module is deliberately written so that swap is a
 * one-expression change here plus one flag.
 */
const COST_SOURCE_SQL = sql`round(coalesce(sum(c.duration_sec), 0) / 60.0 * ${RETELL_COST_CENTS_PER_MINUTE})`;

/**
 * Usage aggregate for one site over an explicit window. Half-open: [start, end).
 *
 * Calls are attributed by `started_at`, falling back to `created_at` — `started_at` is nullable
 * and a webhook that only ever delivered `call_analyzed` can leave it null. Without the fallback
 * those calls would vanish from every period and be billed to nobody.
 *
 * Null `duration_sec` (a call that never connected, or whose end-webhook never landed) contributes
 * ZERO minutes but is counted separately in `callsWithoutDuration`, so an operator can tell "quiet
 * month" apart from "our webhook is broken and we're under-billing everyone".
 */
export async function usageForPeriod(
  siteId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<PeriodUsage> {
  const res = await db.execute(sql`
    SELECT
      coalesce(sum(c.duration_sec), 0)::int              AS seconds,
      count(*) FILTER (WHERE c.duration_sec IS NOT NULL)::int AS billable_calls,
      count(*) FILTER (WHERE c.duration_sec IS NULL)::int     AS undurated_calls,
      ${COST_SOURCE_SQL}::int                            AS cost_cents
    FROM calls c
    WHERE c.site_id = ${siteId}
      AND coalesce(c.started_at, c.created_at) >= ${periodStart.toISOString()}
      AND coalesce(c.started_at, c.created_at) <  ${periodEnd.toISOString()}
  `);
  const r = rowsOf(res)[0] ?? {};
  const seconds = num(r.seconds);
  return {
    minutes: roundMinutes(seconds),
    seconds,
    calls: num(r.billable_calls),
    callsWithoutDuration: num(r.undurated_calls),
    costCents: num(r.cost_cents),
    costIsEstimated: true,
  };
}

/** Shape of the empty result, so the several no-usage paths below can't drift apart. */
function emptyUsage(): PeriodUsage {
  return {
    minutes: 0,
    seconds: 0,
    calls: 0,
    callsWithoutDuration: 0,
    costCents: 0,
    costIsEstimated: true,
  };
}

/**
 * Apply the allowance to a raw usage aggregate. Pure — no I/O, so it's trivially testable.
 *
 * Every number here comes from plans.ts. This function's only job is to pair measured usage with
 * the plan's terms and present them in one shape; it decides nothing about pricing itself.
 */
export function applyAllowance(
  usage: PeriodUsage,
  plan: string | null,
): Pick<
  CurrentPeriodUsage,
  "tier" | "rawPlan" | "includedMinutes" | "overageMinutes" | "overageDueCents" | "pctUsed" | "hasVoice"
> {
  const tier = planKeyOf(plan);
  const hasVoice = planIncludesVoiceMinutes(tier);
  const fraction = minutesUsedFraction(tier, usage.minutes);
  return {
    tier,
    rawPlan: plan ?? null,
    includedMinutes: tier ? planIncludedMinutes(tier) : 0,
    overageMinutes: planOverageMinutes(tier, usage.minutes),
    overageDueCents: overageCents(tier, usage.minutes),
    // null (not 0) on a tier with no receptionist — see the CurrentPeriodUsage doc, and
    // minutesUsedFraction()'s, for why defaulting this to 0 would nag a $99 customer.
    pctUsed: fraction == null ? null : fraction * 100,
    hasVoice,
  };
}

/**
 * Everything a portal counter, a warning cron, or the billing job needs for one site, right now.
 *
 * Honest about the degenerate cases rather than papering over them:
 *   • site doesn't exist            → zeros, tier null, period null
 *   • site has no plan              → zeros-with-usage, hasVoice false, pctUsed null
 *   • site on the website tier      → real minutes reported, includedMinutes 0, hasVoice false,
 *                                     overage 0. We do NOT bill a voiceless plan for minutes it
 *                                     shouldn't have been able to accrue; if minutes > 0 here,
 *                                     that's a provisioning bug to surface, not revenue to book.
 *   • no billing period established → period null and usage zeroed, because attributing calls to
 *                                     an imaginary window is worse than reporting "unknown".
 */
export async function currentPeriodUsage(
  siteId: number,
  now: Date = new Date(),
): Promise<CurrentPeriodUsage> {
  const siteRes = await db.execute(sql`
    SELECT plan, paid_at, claimed_at
    FROM forge_sites WHERE id = ${siteId}
  `);
  const site = rowsOf(siteRes)[0];
  if (!site) {
    return { siteId, ...emptyUsage(), ...applyAllowance(emptyUsage(), null), period: null };
  }

  const plan = (site.plan as string | null) ?? null;
  const anchorRaw = (site.paid_at ?? site.claimed_at) as string | Date | null;
  const anchor = anchorRaw ? new Date(anchorRaw) : null;
  const period = periodForAnchor(anchor, now);

  if (!period) {
    return { siteId, ...emptyUsage(), ...applyAllowance(emptyUsage(), plan), period: null };
  }

  const usage = await usageForPeriod(siteId, period.start, period.end);
  return { siteId, ...usage, ...applyAllowance(usage, plan), period };
}

/**
 * Alias for currentPeriodUsage(). Named for how callers think about it ("get this site's voice
 * usage") rather than for the period mechanics.
 *
 * NOTE for the portal page: the fields are `minutes`, `calls`, and `period.start` / `period.end`
 * — not `minutesUsed` / `callsAnswered` / `periodStart` / `periodEnd`. And `period` is nullable
 * (a site that has never paid or been claimed has no billing period); render "no billing period
 * yet" rather than defaulting it to this calendar month.
 */
export const getVoiceUsage = currentPeriodUsage;

/**
 * Every site at or over `pct`% of its allowance in its CURRENT period — the query behind the 80%
 * and 100% warning crons.
 *
 * The billing period differs per site (each renews on its own anniversary), so the period is
 * computed per-site IN SQL from the same anchor rule as periodForAnchor(): the most recent
 * monthly anniversary of paid_at/claimed_at. `age()` yields whole elapsed years+months, and
 * Postgres month arithmetic clamps short months the same way addMonthsUTC does, so the two
 * implementations agree. If you change one, change the other.
 *
 * One row per site, allowance math done in JS afterward — the allowance lives in plans.ts and has
 * no business being duplicated into SQL, and the row count here is the customer count.
 *
 * Sites with no voice allowance are excluded entirely: they have no threshold to cross.
 */
export async function sitesOverThreshold(
  pct: number,
  now: Date = new Date(),
): Promise<ThresholdSite[]> {
  const nowIso = now.toISOString();
  const res = await db.execute(sql`
    WITH periods AS (
      SELECT
        f.id,
        f.business_name,
        f.plan,
        coalesce(f.paid_at, f.claimed_at) AS anchor,
        coalesce(f.paid_at, f.claimed_at)
          + (
              date_part('year',  age(${nowIso}::timestamptz, coalesce(f.paid_at, f.claimed_at))) * 12
            + date_part('month', age(${nowIso}::timestamptz, coalesce(f.paid_at, f.claimed_at)))
            )::int * interval '1 month' AS period_start
      FROM forge_sites f
      WHERE f.plan IS NOT NULL
        -- Only ACTIVE subscribers. The Stripe webhook does not reliably clear \`plan\` on
        -- cancellation, so filtering on plan alone would keep firing "you're near your limit"
        -- warnings at customers who churned months ago.
        AND f.subscription_status = 'active'
        AND coalesce(f.paid_at, f.claimed_at) IS NOT NULL
        AND coalesce(f.paid_at, f.claimed_at) <= ${nowIso}::timestamptz
    )
    SELECT
      p.id, p.business_name, p.plan, p.anchor, p.period_start,
      (p.period_start + interval '1 month') AS period_end,
      coalesce(sum(c.duration_sec), 0)::int                    AS seconds,
      count(c.*) FILTER (WHERE c.duration_sec IS NOT NULL)::int AS billable_calls,
      count(c.*) FILTER (WHERE c.duration_sec IS NULL)::int     AS undurated_calls,
      ${COST_SOURCE_SQL}::int                                  AS cost_cents
    FROM periods p
    LEFT JOIN calls c
      ON c.site_id = p.id
     AND coalesce(c.started_at, c.created_at) >= p.period_start
     AND coalesce(c.started_at, c.created_at) <  p.period_start + interval '1 month'
    GROUP BY p.id, p.business_name, p.plan, p.anchor, p.period_start
  `);

  const out: ThresholdSite[] = [];
  for (const r of rowsOf(res)) {
    const plan = (r.plan as string | null) ?? null;
    const seconds = num(r.seconds);
    const usage: PeriodUsage = {
      minutes: roundMinutes(seconds),
      seconds,
      calls: num(r.billable_calls),
      callsWithoutDuration: num(r.undurated_calls),
      costCents: num(r.cost_cents),
      costIsEstimated: true,
    };
    const allowance = applyAllowance(usage, plan);
    if (!allowance.hasVoice || allowance.pctUsed == null) continue;
    if (allowance.pctUsed < pct) continue;

    // RECOMPUTE the period in JS rather than trusting the SQL one.
    //
    // The CTE above derives period_start with Postgres month arithmetic and the comment used to
    // claim it agrees with periodForAnchor(). It does not, for any site whose billing anchor falls
    // on the 29th, 30th or 31st: the SQL adds one month to an ALREADY-CLAMPED start, while the JS
    // clamps from the original anchor each time. Feb 28 + 1 month is Mar 28 in SQL but Mar 31 in
    // JS, so the two disagree about which calls belong to the month — and the customer's portal
    // (JS) would show a different number from the warning cron (SQL).
    //
    // The SQL window is still what selected and summed the rows; this only makes the period we
    // REPORT match what a per-site lookup will say. At customer-count scale the divergence is a
    // handful of calls at a boundary, but two numbers that disagree destroy trust in both.
    const anchor = r.anchor ? new Date(r.anchor as string) : null;
    const jsPeriod = periodForAnchor(anchor, now);

    out.push({
      siteId: num(r.id),
      businessName: (r.business_name as string | null) ?? null,
      ...usage,
      ...allowance,
      pctUsed: allowance.pctUsed,
      period: jsPeriod ?? {
        start: new Date(r.period_start as string),
        end: new Date(r.period_end as string),
      },
    });
  }
  // Worst offenders first — a warning cron that truncates should truncate the least urgent.
  return out.sort((a, b) => b.pctUsed - a.pctUsed);
}
