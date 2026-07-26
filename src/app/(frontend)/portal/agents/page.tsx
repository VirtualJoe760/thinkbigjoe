import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

import { db, forgeSites, voiceLines } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { AGENTS, type AgentKey } from "@/lib/plans";
import { OrgRoster } from "./org-roster";
import { CallIvy } from "@/components/portal/call-ivy";
import { PortalShell } from "@/components/portal/portal-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Agents",
  robots: { index: false, follow: false },
};

/**
 * The Agents tab — the roster (design doc: Option A as a tab, Ring 2's home). Ivy is the first
 * employee card, backed by real line + call data; the rest of the roster comes from plans.ts
 * AGENTS (the entitlement source of truth, so cards can't drift from what tiers actually include).
 *
 * HONESTY RULE for locked cards: nothing here fakes an "Unlock now" checkout for capabilities that
 * aren't deliverable yet (AGENT_PLATFORM.md: tier 2–3 agents wait on the data-ingress layer). The
 * chips say what's true — "Complete plan · rolling out" or "Coming soon" — and the CTA is a
 * conversation, not a charge.
 */

/** Display personas for the roster — presentation only; entitlements live in plans.ts. */
const ROSTER: { key: AgentKey; persona: string; initials: string; chip: string; tone: "plan" | "soon" }[] = [
  { key: "text_handling", persona: "Tess — Texting", initials: "TE", chip: "Complete plan · rolling out", tone: "plan" },
  { key: "estimate_followup", persona: "Ray — Follow-Up", initials: "RA", chip: "Complete plan · rolling out", tone: "plan" },
  { key: "review_requests", persona: "Sunny — Reviews", initials: "SU", chip: "Coming soon", tone: "soon" },
  { key: "seasonal_reminders", persona: "June — Seasonal", initials: "JU", chip: "Coming soon", tone: "soon" },
  { key: "reactivation", persona: "Remy — Win-Back", initials: "RE", chip: "Coming soon", tone: "soon" },
];

function rowsOf(res: unknown): Record<string, unknown>[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Record<string, unknown>[];
}
const num = (v: unknown): number => (v == null ? 0 : Number(v));

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/agents");
  const { user } = session;

  // HARD SECURITY BOUNDARY — identical to the Scoreboard/Knowledge pages.
  const sites = await db
    .select({
      id: forgeSites.id,
      businessName: forgeSites.businessName,
      timezone: forgeSites.bookingTimezone,
      liveUrl: forgeSites.liveUrl,
    })
    .from(forgeSites)
    .where(and(eq(forgeSites.claimedByUserId, user.id), ne(forgeSites.status, "deleted"), ne(forgeSites.isInternal, true)))
    .orderBy(asc(forgeSites.id));

  const { site: siteParam } = await searchParams;
  const site = sites.find((s) => String(s.id) === siteParam) ?? sites[0];
  const shellSite = site ? { id: site.id, businessName: site.businessName, liveUrl: site.liveUrl } : null;

  const header = (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-brand">Agents</p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Your AI team</h1>
    </>
  );

  // Ivy's real state for the selected site (only when there is one).
  let line: { phoneNumber: string; status: string } | null = null;
  let answered = 0;
  let booked = 0;
  if (site) {
    // Prefer a WORKING line (active/provisioning) over whatever happens to be newest — a released
    // or paused row must neither masquerade as "being set up" nor shadow a line that's still live.
    const lines = await db
      .select({ phoneNumber: voiceLines.phoneNumber, status: voiceLines.status })
      .from(voiceLines)
      .where(eq(voiceLines.siteId, site.id))
      .orderBy(desc(voiceLines.createdAt));
    line = lines.find((l) => l.status === "active" || l.status === "provisioning") ?? lines[0] ?? null;

    if (line) {
      const tz = site.timezone;
      const res = await db.execute(sql`
        WITH c AS (
          SELECT (started_at AT TIME ZONE ${tz}) AS local, is_real_lead, disposition
          FROM calls WHERE site_id = ${site.id} AND started_at IS NOT NULL
        )
        SELECT
          count(*) FILTER (WHERE c.local >= date_trunc('month', now() AT TIME ZONE ${tz})) AS answered,
          count(*) FILTER (WHERE c.local >= date_trunc('month', now() AT TIME ZONE ${tz})
            AND c.is_real_lead IS NOT FALSE AND c.disposition = 'booked') AS booked
        FROM c`);
      const s = rowsOf(res)[0] ?? {};
      answered = num(s.answered);
      booked = num(s.booked);
    }
  }
  const isLive = line?.status === "active";

  const chipCls = (tone: "live" | "setup" | "plan" | "soon") =>
    tone === "live"
      ? "bg-green-100 text-green-800"
      : tone === "setup"
        ? "bg-amber-100 text-amber-800"
        : tone === "plan"
          ? "bg-brand-tint text-brand"
          : "bg-surface text-ink-soft";

  // ADMIN: the real org roster (OpenClaw agents under the TBJ organization) with live chat via the
  // agent bridge. Customers keep the receptionist roster below; a future customer org renders
  // OrgRoster with its own slug.
  const admin = isAdminEmail(user.email);

  return (
    <PortalShell active="/portal/agents" site={shellSite}>
      {header}
      <p className="mt-1 text-sm text-ink-soft">
        {admin
          ? "Your OpenClaw org — review, message, and monitor every agent."
          : site
            ? `Who's working for ${site.businessName} — and who's ready to join.`
            : "Your receptionist and the specialists behind her."}
      </p>

      {admin && <OrgRoster />}

      {sites.length > 1 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {sites.map((sx) => {
            const active = sx.id === site?.id;
            return (
              <Link
                key={sx.id}
                href={`/portal/agents?site=${sx.id}`}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
                  active ? "border-brand bg-brand-tint text-brand" : "border-line bg-background text-ink-soft hover:bg-surface hover:text-ink"
                }`}
              >
                {sx.businessName}
              </Link>
            );
          })}
        </div>
      )}

      {/* ---- The roster ---- */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {/* Ivy — the live card, driven by real line + call data. */}
        <div className="rounded-2xl border border-line bg-background p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white" aria-hidden>
              IV
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold">Ivy — Receptionist</h3>
              <p className="truncate text-xs tabular-nums text-ink-soft">
                {line ? line.phoneNumber : "no line yet"}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-soft">{AGENTS.voice_receptionist.blurb}</p>
          {line && (
            <div className="mt-3 flex gap-4 text-xs tabular-nums text-ink-soft">
              <span><b className="text-ink">{answered}</b> calls this month</span>
              <span><b className="text-ink">{booked}</b> booked</span>
            </div>
          )}
          {(() => {
            // Honest state labels: paused/released lines say what they are — "Being set up" is
            // reserved for provisioning, and /portal/calls only serves working lines, so the
            // Call-log CTA appears only when that page will actually show one.
            const working = line && (line.status === "active" || line.status === "provisioning");
            const stateLabel = isLive ? "● Live 24/7"
              : line?.status === "provisioning" ? "Being set up"
              : line?.status === "paused" ? "Paused"
              : line ? "Line turned off"
              : "Not set up";
            const stateTone = isLive ? "live" : line?.status === "provisioning" ? "setup" : "soon";
            return (
          <div className="mt-4 flex items-center justify-between gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${chipCls(stateTone as "live" | "setup" | "plan" | "soon")}`}>
              {stateLabel}
            </span>
            {site ? (
              working ? (
                <Link
                  href={`/portal/calls?site=${site.id}`}
                  className="rounded-full border border-line bg-background px-4 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-surface"
                >
                  Call log →
                </Link>
              ) : (
                <Link
                  href={`/portal/dashboard?site=${site.id}`}
                  className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-dark"
                >
                  {line ? "Bring her back →" : "Set her up →"}
                </Link>
              )
            ) : (
              <Link
                href="/portal/claim"
                className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-dark"
              >
                Claim your site →
              </Link>
            )}
          </div>
            );
          })()}
        </div>

        {/* The rest of the roster — locked, honestly. */}
        {ROSTER.map((r) => (
          <div key={r.key} className="rounded-2xl border border-dashed border-line bg-surface p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-line text-sm font-bold text-ink-soft" aria-hidden>
                {r.initials}
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-bold">{r.persona}</h3>
                <p className="truncate text-xs text-ink-soft">{AGENTS[r.key].label}</p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-soft">{AGENTS[r.key].blurb}</p>
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${chipCls(r.tone)}`}>
                {r.chip}
              </span>
              {r.tone === "plan" && (
                <span className="text-[11px] font-semibold text-brand">Ask Ivy about early access</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ---- Custom agents: the existing call-Ivy flow, unchanged in spirit ---- */}
      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
          Something custom
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
          Follow-up, reactivation, review requests, recruiting — custom AI agents wired into how you
          actually work. Tell Ivy what you&apos;re trying to fix and we&apos;ll scope it.
        </p>
        <div className="mt-4">
          <CallIvy
            heading="Call Ivy about custom agents"
            blurb="Tell her the busywork or the leaks you want handled — chasing unsold quotes, reactivating old customers, staffing. She scopes it and Joe builds it."
            steps={[
              "Tell Ivy what work you want off your plate.",
              "She captures the specifics and passes it to Joe.",
              "Joe scopes a plan and follows up to build it.",
            ]}
          />
        </div>
        <p className="mt-4 text-sm text-ink-soft">
          Want to see what&apos;s possible first?{" "}
          <Link href="/solutions" className="font-semibold text-brand hover:underline">
            Explore agentic solutions
          </Link>
          .
        </p>
      </section>
    </PortalShell>
  );
}
