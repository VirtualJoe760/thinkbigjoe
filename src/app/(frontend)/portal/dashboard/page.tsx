import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

import { db, calls, forgeSites, voiceLines } from "@/db";
import { auth } from "@/lib/auth";
import { StatGrid, StatTile } from "@/components/ui";
import { isAdminEmail } from "@/lib/admin";
import { CallIvy } from "@/components/portal/call-ivy";
import { CallFeedback } from "./call-feedback";
import { IvyCalls } from "./ivy-calls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your AI Receptionist",
  robots: { index: false, follow: false },
};

/** Recent calls shown with feedback controls. Capped — Neon egress is constrained, transcripts are fat. */
const RECENT = 15;

function rowsOf(res: unknown): Record<string, unknown>[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Record<string, unknown>[];
}
const n = (v: unknown): number => (v == null ? 0 : Number(v));

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/dashboard");
  const { user } = session;
  // Admins get a "your own line" section reviewing Ivy's real calls from Retell (see IvyCalls).
  // Never rendered for a customer.
  const admin = isAdminEmail(user.email);

  // HARD SECURITY BOUNDARY — identical to /portal/calls. Every call below is reached only through a
  // site id that came out of THIS query (claimed by me). `?site=` is matched against this list,
  // never queried directly. A slip here shows one business another's customer calls.
  const sites = await db
    .select({ id: forgeSites.id, businessName: forgeSites.businessName, timezone: forgeSites.bookingTimezone })
    .from(forgeSites)
    .where(and(eq(forgeSites.claimedByUserId, user.id), ne(forgeSites.status, "deleted")))
    .orderBy(asc(forgeSites.id));

  const { site: siteParam } = await searchParams;
  const site = sites.find((s) => String(s.id) === siteParam) ?? sites[0];

  const header = (
    <>
      <Link href="/portal" className="text-sm font-semibold text-brand hover:underline">
        ← Back to portal
      </Link>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Your AI receptionist</h1>
    </>
  );

  if (!site) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        {header}
        <p className="mt-3 leading-relaxed text-ink-soft">
          Your receptionist reports here once your site is claimed and it&apos;s live.
        </p>
        <Link
          href="/portal/claim"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          Claim your site
        </Link>
        {/* An admin with no claimed site of their own still needs to review Ivy's line. */}
        {admin && <IvyCalls />}
      </main>
    );
  }

  const tz = site.timezone;

  // Is the line actually answering? "Set up and quiet" and "not set up yet" are different stories and
  // telling someone "no calls yet" when nothing is provisioned is how trust dies.
  const [line] = await db
    .select({ status: voiceLines.status })
    .from(voiceLines)
    .where(eq(voiceLines.siteId, site.id))
    .orderBy(desc(voiceLines.createdAt))
    .limit(1);
  const isLive = line?.status === "active";
  const hasLine = Boolean(line);

  // The site switcher — shared by the setup screen and the dashboard below.
  const siteSwitcher =
    sites.length > 1 ? (
      <div className="mt-5 flex flex-wrap gap-2">
        {sites.map((sx) => {
          const active = sx.id === site.id;
          return (
            <Link
              key={sx.id}
              href={`/portal/dashboard?site=${sx.id}`}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
                active ? "border-brand bg-brand-tint text-brand" : "border-line bg-background text-ink-soft hover:bg-surface hover:text-ink"
              }`}
            >
              {sx.businessName}
            </Link>
          );
        })}
      </div>
    ) : null;

  // NO receptionist provisioned yet → this is a SETUP screen, not a dashboard. Setup happens by
  // calling Ivy now (the form is gone), so show that, and skip the value queries entirely — there
  // are no calls to aggregate for a site with no line.
  if (!hasLine) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        {header}
        <p className="mt-1 text-sm text-ink-soft">
          <span className="font-semibold text-ink">{site.businessName}</span>&apos;s AI receptionist
          isn&apos;t set up yet.
        </p>
        {siteSwitcher}
        <div className="mt-6">
          <CallIvy
            heading="Set up your receptionist"
            blurb={`Call Ivy and she'll get ${site.businessName}'s phone answered 24/7 — she asks about your services, hours, and where to send messages. About five minutes, and you're live.`}
            steps={[
              "Have your account ID handy — it's at the top of the portal.",
              "Ivy texts a code to the number on file to confirm it's you.",
              "Answer a few questions about your business, and she sets it up.",
            ]}
          />
        </div>
        {admin && <IvyCalls />}
      </main>
    );
  }

  // THE VALUE STORY, aggregated in SQL in the SITE's timezone. "After hours" means after hours where
  // the plumber lives — not UTC, not Pacific. One row back, never the call rows.
  const statRes = await db.execute(sql`
    WITH b AS (
      SELECT date_trunc('month', now() AT TIME ZONE ${tz}) AS this_start
    ),
    c AS (
      SELECT (started_at AT TIME ZONE ${tz}) AS local, urgency, is_real_lead, disposition, problem, notified_at
      FROM calls WHERE site_id = ${site.id} AND started_at IS NOT NULL
    )
    SELECT
      count(*) FILTER (WHERE c.local >= b.this_start) AS answered,
      -- Leads = real, non-spam calls where we actually took the details.
      count(*) FILTER (WHERE c.local >= b.this_start AND c.is_real_lead IS NOT FALSE
        AND (c.disposition = 'message' OR c.problem IS NOT NULL)) AS leads,
      -- After-hours = calls they'd very likely have missed. The retention argument, made countable.
      count(*) FILTER (WHERE c.local >= b.this_start AND (
        EXTRACT(hour FROM c.local) < 8 OR EXTRACT(hour FROM c.local) >= 18
        OR EXTRACT(isodow FROM c.local) > 5)) AS after_hours,
      count(*) FILTER (WHERE c.local >= b.this_start AND c.urgency = 'emergency') AS emergencies,
      -- Notification delivery: of the real leads this month, how many did we actually reach them on?
      count(*) FILTER (WHERE c.local >= b.this_start AND c.is_real_lead IS NOT FALSE
        AND (c.disposition = 'message' OR c.problem IS NOT NULL)) AS notifiable,
      count(*) FILTER (WHERE c.local >= b.this_start AND c.is_real_lead IS NOT FALSE
        AND (c.disposition = 'message' OR c.problem IS NOT NULL) AND c.notified_at IS NOT NULL) AS notified
    FROM c CROSS JOIN b`);
  const s = rowsOf(statRes)[0] ?? {};
  const answered = n(s.answered), leads = n(s.leads), afterHours = n(s.after_hours);
  const emergencies = n(s.emergencies), notifiable = n(s.notifiable), notified = n(s.notified);

  // Six-week trend, so value visibly accrues. One row per week, aggregated in SQL.
  const trendRes = await db.execute(sql`
    WITH weeks AS (
      SELECT generate_series(
        date_trunc('week', (now() AT TIME ZONE ${tz})) - interval '5 weeks',
        date_trunc('week', (now() AT TIME ZONE ${tz})),
        interval '1 week'
      ) AS wk
    )
    SELECT w.wk,
      (SELECT count(*) FROM calls c
         WHERE c.site_id = ${site.id} AND c.started_at IS NOT NULL
           AND date_trunc('week', (c.started_at AT TIME ZONE ${tz})) = w.wk) AS calls
    FROM weeks w ORDER BY w.wk`);
  const trend = rowsOf(trendRes).map((r) => n(r.calls));
  const trendMax = Math.max(1, ...trend);

  const recent = rowsOf(
    await db.execute(sql`
      SELECT id, started_at, caller_name, callback_number, urgency, problem, summary,
             transcript, is_real_lead, notified_at, owner_rating
      FROM calls
      WHERE site_id = ${site.id}
      ORDER BY started_at DESC NULLS LAST, id DESC
      LIMIT ${RECENT}`),
  );

  const reachedPct = notifiable > 0 ? Math.round((notified / notifiable) * 100) : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      {header}
      <p className="mt-1 text-sm text-ink-soft">
        What <span className="font-semibold text-ink">{site.businessName}</span>&apos;s receptionist
        did this month. {isLive ? "It's live and answering." : "It'll fill in once your line goes live."}
      </p>

      {siteSwitcher}

      {/* Existing customer: setup is a call now, so changes are too. Sits above the numbers. */}
      <div className="mt-5">
        <CallIvy
          compact
          heading="Change your receptionist, or add another"
          blurb="Call Ivy to update your greeting, hours, or where messages go — or to set up a line for another business."
        />
      </div>

      {/* The value row. After-hours leads with the accent because that's the argument for the product. */}
      <div className="mt-6">
        <StatGrid cols={2}>
          <StatTile label="Calls answered" value={answered} />
          <StatTile label="Leads captured" value={leads} accent />
          <StatTile label="After hours" value={afterHours} sub="calls you'd have missed" />
          <StatTile label="Emergencies flagged" value={emergencies} />
        </StatGrid>
        <p className="mt-2 text-xs text-ink-soft">This month, {site.businessName}&apos;s local time.</p>
      </div>

      {/* Reached-you rate — trust. "We took N and got you on all of them" is the promise being kept. */}
      {reachedPct !== null && (
        <div className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          {reachedPct === 100 ? (
            <span className="text-ink">
              ✅ We reached you on <b>all {notifiable}</b> lead{notifiable === 1 ? "" : "s"} this month.
            </span>
          ) : (
            <span className="text-ink">
              We reached you on <b>{notified} of {notifiable}</b> leads.{" "}
              <span className="text-red-600">
                {notifiable - notified} message{notifiable - notified === 1 ? "" : "s"} we couldn&apos;t
                text you — call Ivy to fix the number we send to.
              </span>
            </span>
          )}
        </div>
      )}

      {/* Trend — a zero-JS bar row, so value accruing over weeks is visible at a glance. */}
      {answered > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
            Calls, last 6 weeks
          </h2>
          <div className="mt-3 flex items-end gap-2" style={{ height: 72 }}>
            {trend.map((v, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-brand/80"
                  style={{ height: `${Math.max(3, (v / trendMax) * 60)}px` }}
                  title={`${v} call${v === 1 ? "" : "s"}`}
                />
                <span className="text-[10px] tabular-nums text-ink-soft">{v}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent calls with feedback. This is the loop: they tell us what the AI got wrong, we fix it. */}
      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">Recent calls</h2>
        {recent.length === 0 ? (
          <p className="mt-3 rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-ink-soft">
            {isLive
              ? "Your receptionist is live and listening — no calls yet."
              : "No calls yet. They'll appear here the moment your line goes live."}
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {recent.map((c) => {
              const when = c.started_at
                ? new Date(c.started_at as string).toLocaleString("en-US", {
                    timeZone: tz,
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "—";
              const spam = c.is_real_lead === false;
              const urgent = c.urgency === "emergency" || c.urgency === "urgent";
              return (
                <li
                  key={String(c.id)}
                  className={`rounded-xl border bg-surface px-4 py-3 ${spam ? "border-line opacity-70" : "border-line"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">
                        {(c.caller_name as string) || "Unknown caller"}
                        {c.callback_number ? (
                          <a href={`tel:${c.callback_number}`} className="ml-2 text-sm font-normal text-brand">
                            {c.callback_number as string}
                          </a>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-sm text-ink-soft">
                        {(c.problem as string) || (c.summary as string) || "No details taken."}
                      </p>
                      {/* Transcript expands via native <details> — zero-JS, a big tap target, and it
                          works before hydration. This is "what was actually said on the phone". */}
                      {c.transcript ? (
                        <details className="mt-2 text-sm">
                          <summary className="cursor-pointer font-medium text-brand">Read transcript</summary>
                          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-background px-3 py-2 font-sans text-xs leading-relaxed text-ink-soft">
                            {c.transcript as string}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-xs text-ink-soft">{when}</span>
                      {urgent && (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">
                          {c.urgency as string}
                        </span>
                      )}
                      {spam && (
                        <span className="text-[10px] uppercase text-ink-soft">spam / wrong #</span>
                      )}
                    </div>
                  </div>

                  {/* Don't invite feedback on robocalls — nothing to fix there. */}
                  {!spam && (
                    <CallFeedback
                      callId={Number(c.id)}
                      initialRating={(c.owner_rating as "good" | "bad" | null) ?? null}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {admin && <IvyCalls />}
    </main>
  );
}
