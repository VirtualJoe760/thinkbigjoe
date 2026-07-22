import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

import { db, calls, forgeSites, voiceLines } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { CallIvy } from "@/components/portal/call-ivy";
import { PortalShell } from "@/components/portal/portal-shell";
import { CallFeedback } from "./call-feedback";
import { IvyCalls } from "./ivy-calls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Scoreboard",
  robots: { index: false, follow: false },
};

/** Recent calls shown with feedback controls. Capped — Neon egress is constrained, transcripts are fat. */
const RECENT = 15;

function rowsOf(res: unknown): Record<string, unknown>[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Record<string, unknown>[];
}
const n = (v: unknown): number => (v == null ? 0 : Number(v));

/** One score row: a label, a 0–100 value, and the one-sentence explanation of where it came from. */
type ScoreRow = { label: string; pct: number; note: string };

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
    .select({
      id: forgeSites.id,
      businessName: forgeSites.businessName,
      timezone: forgeSites.bookingTimezone,
      liveUrl: forgeSites.liveUrl,
    })
    .from(forgeSites)
    // Internal sites (TBJ itself — Ivy's own line now persists calls under it) are edited in code
    // and reviewed via the admin Ivy log, never shown as a customer receptionist here.
    .where(and(eq(forgeSites.claimedByUserId, user.id), ne(forgeSites.status, "deleted"), ne(forgeSites.isInternal, true)))
    .orderBy(asc(forgeSites.id));

  const { site: siteParam } = await searchParams;
  const site = sites.find((s) => String(s.id) === siteParam) ?? sites[0];

  const shellSite = site ? { id: site.id, businessName: site.businessName, liveUrl: site.liveUrl } : null;

  // "this month" belongs only where monthly stats exist — the setup/no-site branches get the
  // plain name, not a promise of numbers that aren't there.
  const header = (withMonth: boolean) => (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-brand">Scoreboard</p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight">
        {site ? (withMonth ? `${site.businessName}, this month` : site.businessName) : "Your scoreboard"}
      </h1>
    </>
  );

  if (!site) {
    return (
      <PortalShell active="/portal/dashboard" site={null}>
        {header(false)}
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
      </PortalShell>
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

  // The site switcher — shared by the setup screen and the scoreboard below.
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

  // NO receptionist provisioned yet → this is a SETUP screen, not a scoreboard. Setup happens by
  // calling Ivy now (the form is gone), so show that, and skip the value queries entirely — there
  // are no calls to aggregate for a site with no line.
  if (!hasLine) {
    return (
      <PortalShell active="/portal/dashboard" site={shellSite}>
        {header(false)}
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
      </PortalShell>
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
      -- Leads = real, non-spam calls where we actually captured the caller: a message taken, a
      -- problem recorded, OR a booking made. Booked ⊆ leads BY CONSTRUCTION — the "X of Y leads
      -- booked" sentence must never read "3 of 2".
      count(*) FILTER (WHERE c.local >= b.this_start AND c.is_real_lead IS NOT FALSE
        AND (c.disposition IN ('message', 'booked') OR c.problem IS NOT NULL)) AS leads,
      -- Booked = calls a live tool actually put on the calendar (site-book writes disposition).
      count(*) FILTER (WHERE c.local >= b.this_start AND c.is_real_lead IS NOT FALSE
        AND c.disposition = 'booked') AS booked,
      -- After-hours = REAL calls they'd very likely have missed. Spam excluded — the tile must
      -- agree with the receipts below, which never tag a robocall "after hours".
      count(*) FILTER (WHERE c.local >= b.this_start AND c.is_real_lead IS NOT FALSE AND (
        EXTRACT(hour FROM c.local) < 8 OR EXTRACT(hour FROM c.local) >= 18
        OR EXTRACT(isodow FROM c.local) > 5)) AS after_hours,
      count(*) FILTER (WHERE c.local >= b.this_start AND c.is_real_lead IS NOT FALSE
        AND c.urgency = 'emergency') AS emergencies,
      -- Notification delivery: of the real leads this month, how many did we actually reach them on?
      count(*) FILTER (WHERE c.local >= b.this_start AND c.is_real_lead IS NOT FALSE
        AND (c.disposition = 'message' OR c.problem IS NOT NULL)) AS notifiable,
      count(*) FILTER (WHERE c.local >= b.this_start AND c.is_real_lead IS NOT FALSE
        AND (c.disposition = 'message' OR c.problem IS NOT NULL) AND c.notified_at IS NOT NULL) AS notified
    FROM c CROSS JOIN b`);
  const s = rowsOf(statRes)[0] ?? {};
  const answered = n(s.answered), leads = n(s.leads), booked = n(s.booked), afterHours = n(s.after_hours);
  const emergencies = n(s.emergencies), notifiable = n(s.notifiable), notified = n(s.notified);

  // ---- The impact score: an average of rows we can each explain in ONE sentence. --------------
  // Rows with no data yet (no leads, nothing to notify) are OMITTED, not counted as zero — a brand
  // new line shouldn't open at 33/100 for crimes it hasn't had the chance to commit.
  const scoreRows: ScoreRow[] = [];
  // "Every call answered" only counts once there ARE calls — a live line with zero calls must show
  // the honest "score starts with your first calls" state, not a hollow 100/100.
  if (isLive && answered > 0) {
    scoreRows.push({ label: "Every call answered", pct: 100, note: `all ${answered} calls this month picked up 24/7 — that's the product` });
  }
  if (leads > 0) {
    // booked ⊆ leads by construction in the SQL above; the clamp is belt-and-suspenders only.
    scoreRows.push({
      label: "Booked from leads",
      pct: Math.min(100, Math.round((booked / leads) * 100)),
      note: `${booked} of ${leads} real leads went straight onto the calendar`,
    });
  }
  const reachedPct = notifiable > 0 ? Math.round((notified / notifiable) * 100) : null;
  if (reachedPct !== null) {
    scoreRows.push({ label: "We reached you", pct: reachedPct, note: `${notified} of ${notifiable} lead messages made it to your phone` });
  }
  const score = scoreRows.length > 0 ? Math.round(scoreRows.reduce((a, r) => a + r.pct, 0) / scoreRows.length) : null;
  // The fix prompt keys off the RAW counts, not the rounded pct — 199/200 rounds to 100% but one
  // message still failed, and hiding that is exactly the kind of lie a trust surface can't tell.
  const scoreNote =
    score === null ? null
    : notifiable > notified ? `One thing to fix: ${notifiable - notified} message${notifiable - notified === 1 ? "" : "s"} couldn't reach your phone — call Ivy to update the number we text.`
    : score >= 85 ? "Working great — nothing needs your attention."
    : "Filling in as calls come through this month.";

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

  // Call receipts. after_hours computed per row IN THE SITE'S timezone, same definition as the
  // monthly stat — the tag on a receipt must never disagree with the number above it.
  const recent = rowsOf(
    await db.execute(sql`
      SELECT id, started_at, caller_name, callback_number, urgency, problem, summary,
             transcript, is_real_lead, notified_at, owner_rating, disposition,
             (EXTRACT(hour FROM (started_at AT TIME ZONE ${tz})) < 8
              OR EXTRACT(hour FROM (started_at AT TIME ZONE ${tz})) >= 18
              OR EXTRACT(isodow FROM (started_at AT TIME ZONE ${tz})) > 5) AS after_hours
      FROM calls
      WHERE site_id = ${site.id}
      ORDER BY started_at DESC NULLS LAST, id DESC
      LIMIT ${RECENT}`),
  );

  return (
    <PortalShell active="/portal/dashboard" site={shellSite}>
      {header(true)}
      <p className="mt-1 text-sm text-ink-soft">
        {isLive ? "Your receptionist is live and answering." : "It'll fill in once your line goes live."}
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

      {/* ---- Score + money row ---- */}
      <div className="mt-6 grid gap-5 md:grid-cols-[300px_1fr]">
        {/* The dial. One number that answers "is this paying for itself?" at a glance. */}
        <section className="rounded-2xl border border-line bg-background p-6 text-center">
          {/* Render-clock month label vs the DB-clock stats window: they can only disagree for the
              few ms a request straddles month rollover — label-only, accepted. */}
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
            {new Date().toLocaleString("en-US", { month: "long", timeZone: tz })} impact score
          </p>
          {score !== null ? (
            <>
              <div
                className="mx-auto mt-4 grid h-40 w-40 place-items-center rounded-full"
                style={{ background: `conic-gradient(var(--brand) 0 ${score * 3.6}deg, var(--brand-tint) ${score * 3.6}deg 360deg)` }}
                role="img"
                aria-label={`Impact score ${score} of 100`}
              >
                <div className="grid h-[7.5rem] w-[7.5rem] place-items-center rounded-full bg-background">
                  <div>
                    <span className="block text-4xl font-extrabold tabular-nums tracking-tight">{score}</span>
                    <span className="block text-[10px] font-bold uppercase tracking-widest text-ink-soft">of 100</span>
                  </div>
                </div>
              </div>
              {scoreNote && <p className="mt-3 text-xs leading-relaxed text-ink-soft">{scoreNote}</p>}
              <div className="mt-4 flex flex-col gap-2.5 text-left">
                {scoreRows.map((r) => (
                  <div key={r.label} title={r.note}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-ink-soft">{r.label}</span>
                      <span className="font-bold tabular-nums">{r.pct}%</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${r.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-6 text-sm leading-relaxed text-ink-soft">
              Your score starts with your first calls this month — it&apos;s built from how many leads get
              booked and whether every message reaches you.
            </p>
          )}
        </section>

        {/* Money tiles + receipts */}
        <div className="flex min-w-0 flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {[
              { label: "calls answered", value: answered },
              { label: "leads captured", value: leads, accent: true },
              { label: "jobs booked", value: booked },
              { label: "after-hours saves", value: afterHours },
              { label: "emergencies flagged", value: emergencies },
            ].map((t) => (
              <div
                key={t.label}
                className={`rounded-2xl border p-4 ${t.accent ? "border-transparent bg-brand-tint" : "border-line bg-background"}`}
              >
                <p className={`text-2xl font-extrabold tabular-nums tracking-tight ${t.accent ? "text-brand" : ""}`}>{t.value}</p>
                <p className="text-[11px] text-ink-soft">{t.label}</p>
              </div>
            ))}
          </div>

          {/* Call receipts — every call, what happened because of it, and the rate-it loop. */}
          <section className="rounded-2xl border border-line bg-background">
            <h2 className="border-b border-line px-4 py-3 text-xs font-semibold uppercase tracking-widest text-ink-soft">
              Call receipts
            </h2>
            {recent.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-soft">
                {isLive
                  ? "Your receptionist is live and listening — no calls yet."
                  : "No calls yet. They'll appear here the moment your line goes live."}
              </p>
            ) : (
              <ul className="divide-y divide-line">
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
                  const wasBooked = c.disposition === "booked";
                  const wasAfterHours = c.after_hours === true;
                  return (
                    <li key={String(c.id)} className={`px-4 py-3 ${spam ? "opacity-70" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
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
                          {/* Outcome tags — state you can read without reading. Same definitions as the
                              stats above (booked = disposition, after-hours = site-timezone rule). */}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {wasBooked && (
                              <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-bold uppercase text-green-800">Booked</span>
                            )}
                            {urgent && !spam && (
                              <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[10px] font-bold uppercase text-red-700">{c.urgency as string}</span>
                            )}
                            {wasAfterHours && !spam && (
                              <span className="rounded-full bg-brand-tint px-2.5 py-0.5 text-[10px] font-bold uppercase text-brand">After hours</span>
                            )}
                            {/* Tag = fact ("we texted you"), deliberately looser than the monthly
                                notified stat (message-taking calls only) — if notified_at is set we
                                DID text them, and hiding that would be less honest, not more. */}
                            {c.notified_at && !spam ? (
                              <span className="rounded-full bg-surface px-2.5 py-0.5 text-[10px] font-bold uppercase text-ink-soft">Texted you</span>
                            ) : null}
                            {spam && (
                              <span className="rounded-full bg-surface px-2.5 py-0.5 text-[10px] font-bold uppercase text-ink-soft">Spam / wrong number</span>
                            )}
                          </div>
                          {/* Transcript expands via native <details> — zero-JS, a big tap target, and it
                              works before hydration. This is "what was actually said on the phone". */}
                          {c.transcript ? (
                            <details className="mt-2 text-sm">
                              <summary className="cursor-pointer font-medium text-brand">Read transcript</summary>
                              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface px-3 py-2 font-sans text-xs leading-relaxed text-ink-soft">
                                {c.transcript as string}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                        <span className="shrink-0 text-xs text-ink-soft">{when}</span>
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
        </div>
      </div>

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

      {admin && <IvyCalls />}
    </PortalShell>
  );
}
