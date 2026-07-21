import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import { db, calls, forgeSites, voiceLines } from "@/db";
import { auth } from "@/lib/auth";
import { StatGrid, StatTile } from "@/components/ui";
import { CallCard, type CallView } from "./call-card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Calls", robots: { index: false, follow: false } };

/** How many calls we render. Deliberately capped — the Neon instance is egress-constrained and
 *  transcripts are the fattest column in the database. Older calls are a paging problem for later. */
const PAGE_SIZE = 50;

type StatRow = {
  calls_this: number; calls_last: number;
  taken_this: number; taken_last: number;
  after_this: number; after_last: number;
};

function rowsOf(res: unknown): Record<string, unknown>[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Record<string, unknown>[];
}

function delta(now: number, prev: number): string {
  if (prev === 0) return now === 0 ? "None last month either" : "First month with calls";
  const diff = now - prev;
  if (diff === 0) return `Same as last month (${prev})`;
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs last month (${prev})`;
}

export default async function PortalCallsPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/calls");
  const { user } = session;

  // HARD SECURITY BOUNDARY. Every call row below is reached only through a site id that came out
  // of THIS query — a claimed-by-me site. Nothing on this page ever trusts a site id from the URL:
  // `?site=` is matched against this list, never queried directly. A mistake here shows one
  // business another business's customer calls.
  const sites = await db
    .select({
      id: forgeSites.id,
      businessName: forgeSites.businessName,
      timezone: forgeSites.bookingTimezone,
    })
    .from(forgeSites)
    // Exclude internal sites (TBJ's own Ivy line persists calls under one) — never a customer surface.
    .where(and(eq(forgeSites.claimedByUserId, user.id), ne(forgeSites.status, "deleted"), ne(forgeSites.isInternal, true)))
    // Deterministic order is load-bearing, not cosmetic: `sites[0]` is what a multi-site owner
    // sees when `?site=` is absent, and Postgres returns unordered rows in heap order — so
    // without this the default business changes between page loads. Oldest site first (id ASC)
    // is stable and matches the order the switcher chips render in.
    .orderBy(asc(forgeSites.id));

  const { site: siteParam } = await searchParams;
  const site = sites.find((s) => String(s.id) === siteParam) ?? sites[0];

  const header = (
    <>
      <Link href="/portal" className="text-sm font-semibold text-brand hover:underline">
        ← Back to portal
      </Link>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Your calls</h1>
    </>
  );

  if (!site) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        {header}
        <p className="mt-3 leading-relaxed text-ink-soft">
          Your AI receptionist attaches to your website, so calls show up here once you have a site.
        </p>
        <Link
          href="/portal/claim"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          Claim your site
        </Link>
      </main>
    );
  }

  const tz = site.timezone;

  // Is the line actually answering? Distinguishes "set up and quiet" from "not set up yet" — those
  // need very different empty states, and telling a customer "no calls yet" when nothing is even
  // provisioned is how trust in the product dies.
  const [line] = await db
    .select({ phoneNumber: voiceLines.phoneNumber, status: voiceLines.status })
    .from(voiceLines)
    .where(and(eq(voiceLines.siteId, site.id), inArray(voiceLines.status, ["active", "provisioning"])))
    .limit(1);

  // Aggregate in SQL, not JS. Pulling every row back to count it is the exact pattern that has
  // already caused a transfer-quota outage on this Neon instance — and transcripts are huge.
  // Month boundaries and the after-hours test are both evaluated in the SITE's timezone, because
  // "after hours" means after hours where the plumber lives, not UTC and not Pacific.
  const statRes = await db.execute(sql`
    WITH b AS (
      SELECT date_trunc('month', now() AT TIME ZONE ${tz}) AS this_start,
             date_trunc('month', (now() AT TIME ZONE ${tz}) - interval '1 month') AS last_start
    ),
    c AS (
      SELECT (started_at AT TIME ZONE ${tz}) AS local, disposition, problem, is_real_lead
      FROM calls WHERE site_id = ${site.id} AND started_at IS NOT NULL
    )
    SELECT
      count(*) FILTER (WHERE c.local >= b.this_start) AS calls_this,
      count(*) FILTER (WHERE c.local >= b.last_start AND c.local < b.this_start) AS calls_last,
      -- Only 'message' is counted because only /api/voice/message writes calls.disposition today.
      -- A 'booked' arm here (and its pill in call-card.tsx's DISPOSITION map) was unreachable, so
      -- it read as a bug rather than as forward-compat. WHEN VOICE BOOKING STARTS WRITING
      -- calls.disposition = 'booked', restore it in BOTH places and rename the tile below back to
      -- "Jobs & messages" — the three change together or the number contradicts its own label.
      count(*) FILTER (WHERE c.local >= b.this_start
        AND c.is_real_lead IS NOT FALSE
        AND (c.disposition = 'message' OR c.problem IS NOT NULL)) AS taken_this,
      count(*) FILTER (WHERE c.local >= b.last_start AND c.local < b.this_start
        AND c.is_real_lead IS NOT FALSE
        AND (c.disposition = 'message' OR c.problem IS NOT NULL)) AS taken_last,
      count(*) FILTER (WHERE c.local >= b.this_start AND (
        EXTRACT(hour FROM c.local) < 8 OR EXTRACT(hour FROM c.local) >= 18
        OR EXTRACT(isodow FROM c.local) > 5)) AS after_this,
      count(*) FILTER (WHERE c.local >= b.last_start AND c.local < b.this_start AND (
        EXTRACT(hour FROM c.local) < 8 OR EXTRACT(hour FROM c.local) >= 18
        OR EXTRACT(isodow FROM c.local) > 5)) AS after_last
    FROM c CROSS JOIN b`);

  const raw = rowsOf(statRes)[0] ?? {};
  // Postgres count() comes back as bigint, which the driver hands over as a string.
  const stats = Object.fromEntries(
    ["calls_this", "calls_last", "taken_this", "taken_last", "after_this", "after_last"].map((k) => [
      k,
      Number(raw[k] ?? 0),
    ]),
  ) as unknown as StatRow;

  const recent = (await db
    .select({
      id: calls.id,
      startedAt: calls.startedAt,
      callerName: calls.callerName,
      callbackNumber: calls.callbackNumber,
      fromNumber: calls.fromNumber,
      urgency: calls.urgency,
      problem: calls.problem,
      summary: calls.summary,
      transcript: calls.transcript,
      disposition: calls.disposition,
      isRealLead: calls.isRealLead,
      durationSec: calls.durationSec,
      // Set only when the owner's SMS actually sent (see api/voice/message). Surfaced per-call so
      // a silent notification failure is visible to the person it costs — a message we took but
      // never delivered is exactly the row they need to act on.
      notifiedAt: calls.notifiedAt,
    })
    .from(calls)
    .where(eq(calls.siteId, site.id))
    // NULLS LAST explicitly: Postgres DESC defaults to NULLS FIRST, which would float
    // never-started rows above today's calls.
    .orderBy(sql`${calls.startedAt} DESC NULLS LAST`, sql`${calls.id} DESC`)
    .limit(PAGE_SIZE)) as CallView[];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      {header}
      <p className="mt-1 text-sm text-ink-soft">
        Every call your AI receptionist answered for{" "}
        <span className="font-semibold text-ink">{site.businessName}</span> — who called, what they
        needed, and the number to call back.
      </p>

      {sites.length > 1 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Which business?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {sites.map((s) => {
              const active = s.id === site.id;
              return (
                <Link
                  key={s.id}
                  href={`/portal/calls?site=${s.id}`}
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
      )}

      <div className="mt-6">
        <StatGrid cols={3}>
          <StatTile
            label="Calls answered"
            value={stats.calls_this}
            sub={delta(stats.calls_this, stats.calls_last)}
            accent
          />
          <StatTile
            label="Messages taken"
            value={stats.taken_this}
            sub={delta(stats.taken_this, stats.taken_last)}
          />
          <StatTile
            label="After hours"
            value={stats.after_this}
            sub={delta(stats.after_this, stats.after_last)}
          />
        </StatGrid>
        <p className="mt-2 text-xs text-ink-soft">This month, {site.businessName}&apos;s local time.</p>
      </div>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">Recent calls</h2>

        {recent.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-line bg-surface p-6 text-center">
            {line ? (
              <>
                <p className="text-2xl" aria-hidden>🎙️</p>
                <p className="mt-2 font-bold tracking-tight">
                  Your receptionist is live and listening — no calls yet.
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                  The moment someone rings{" "}
                  {line.status === "active" ? "your line" : "your line (we're finishing setup)"}, their
                  name, number and what they need land right here — and we text your{" "}
                  {/* Deliberately describes the configured destination rather than promising a
                      delivered text. Whether a given message actually reached the owner is a
                      per-call fact, shown on each card from notified_at. */}
                  <Link href={`/portal/dashboard?site=${site.id}`} className="font-semibold text-brand hover:underline">
                    notification number
                  </Link>{" "}
                  straight away.
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl" aria-hidden>📞</p>
                <p className="mt-2 font-bold tracking-tight">Your receptionist isn&apos;t answering yet.</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                  Call Ivy and we&apos;ll switch it on — then every missed call becomes a message here
                  instead of a customer calling someone else.
                </p>
                <Link
                  href={`/portal/dashboard?site=${site.id}`}
                  className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
                >
                  Set up my receptionist
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            <ul className="mt-3 space-y-3">
              {recent.map((call) => (
                <CallCard
                  key={call.id}
                  call={call}
                  timezone={tz}
                  settingsHref={`/portal/dashboard?site=${site.id}`}
                />
              ))}
            </ul>
            {recent.length === PAGE_SIZE && (
              <p className="mt-4 text-center text-xs text-ink-soft">
                Showing your {PAGE_SIZE} most recent calls.
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
