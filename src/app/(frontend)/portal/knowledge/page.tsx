import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, ne } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { CallIvy } from "@/components/portal/call-ivy";
import { PortalShell } from "@/components/portal/portal-shell";
import { deriveRouting, type VoiceConfig } from "@/lib/voice-tenant";
import { TENANT_DEFAULTS } from "@/lib/voice-vars";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Knowledge",
  robots: { index: false, follow: false },
};

/**
 * The Knowledge page — everything the receptionist knows about this business, shown back as a
 * living reference (SalesAi's "Knowledge Library" pillar, on our stack). This is
 * `receptionist_config` resold as a feature: same rows Ivy reads on every call, zero new tables.
 *
 * READ-ONLY by design: changes happen by calling Ivy (the portal's setup form was deliberately
 * retired for the phone-first flow). This page's job is to make what she knows inspectable, so
 * "why did she say that?" always has an answer.
 */

type Row = { label: string; hint: string; value: string | null };

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/knowledge");
  const { user } = session;

  // HARD SECURITY BOUNDARY — identical to the Scoreboard. `?site=` only ever matches against the
  // sites THIS user claimed; internal sites (TBJ itself) never render as customer surfaces.
  const sites = await db
    .select({
      id: forgeSites.id,
      businessName: forgeSites.businessName,
      liveUrl: forgeSites.liveUrl,
      config: forgeSites.receptionistConfig,
      status: forgeSites.receptionistStatus,
    })
    .from(forgeSites)
    .where(and(eq(forgeSites.claimedByUserId, user.id), ne(forgeSites.status, "deleted"), ne(forgeSites.isInternal, true)))
    .orderBy(asc(forgeSites.id));

  const { site: siteParam } = await searchParams;
  const site = sites.find((s) => String(s.id) === siteParam) ?? sites[0];
  const shellSite = site ? { id: site.id, businessName: site.businessName, liveUrl: site.liveUrl } : null;

  const header = (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-brand">Knowledge</p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight">
        {site ? `What Ivy knows about ${site.businessName}` : "What your receptionist knows"}
      </h1>
    </>
  );

  if (!site) {
    return (
      <PortalShell active="/portal/knowledge" site={null}>
        {header}
        <p className="mt-3 leading-relaxed text-ink-soft">
          Once your site is claimed and your receptionist is set up, everything she knows about your
          business lives here — hours, services, what counts as an emergency, where messages go.
        </p>
        <Link
          href="/portal/claim"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          Claim your site
        </Link>
      </PortalShell>
    );
  }

  const cfg = ((site.config as VoiceConfig | null) ?? {}) as VoiceConfig;
  const hasAnything = Object.values(cfg).some((v) => typeof v === "string" && v.trim());

  // No knowledge on file → this is a setup story, not an empty table.
  if (!hasAnything) {
    return (
      <PortalShell active="/portal/knowledge" site={shellSite}>
        {header}
        <p className="mt-3 leading-relaxed text-ink-soft">
          Ivy doesn&apos;t know anything about{" "}
          <span className="font-semibold text-ink">{site.businessName}</span> yet. One phone call fixes
          that — she&apos;ll ask about your services, hours, and where to send messages.
        </p>
        <div className="mt-6">
          <CallIvy
            heading="Teach your receptionist"
            blurb={`Call Ivy and she'll learn ${site.businessName} in about five minutes — everything she needs to answer your phone like she works there.`}
          />
        </div>
      </PortalShell>
    );
  }

  // The knowledge rows — every field the runtime actually reads (src/lib/voice-tenant.ts), in the
  // order a caller experiences them. A missing value states the SAFE DEFAULT Ivy falls back to,
  // never a blank — "what will she actually say?" must always have an answer here.
  const rows: Row[] = [
    { label: "How Ivy answers", hint: "the greeting callers hear", value: cfg.greeting?.trim() || null },
    { label: "What you do", hint: "services she can speak to", value: cfg.services?.trim() || null },
    { label: "Hours", hint: "when you're open", value: cfg.hours?.trim() || null },
    { label: "Service area", hint: "where you work", value: cfg.serviceArea?.trim() || null },
    { label: "What counts as an emergency", hint: "when she treats a call as urgent", value: cfg.emergencyDefinition?.trim() || null },
    { label: "Common questions", hint: "answers she gives without guessing", value: cfg.faqs?.trim() || null },
    { label: "Never say", hint: "promises she won't make", value: cfg.doNot?.trim() || null },
  ];

  // The defaults SHE ACTUALLY FALLS BACK TO — imported from the same constant the agent's prompt
  // variables are built from (voice-vars.ts), never paraphrased. Quoting different words here than
  // she speaks on a real call is a lie about the product.
  const DEFAULTS: Record<string, string> = {
    "How Ivy answers": `“${TENANT_DEFAULTS.greeting(site.businessName)}”`,
    "What you do": `“${TENANT_DEFAULTS.services}”`,
    "Hours": `“${TENANT_DEFAULTS.hours}”`,
    "Service area": `“${TENANT_DEFAULTS.serviceArea}”`,
    "What counts as an emergency": `“${TENANT_DEFAULTS.emergencyDefinition}”`,
    "Common questions": `she's told: “${TENANT_DEFAULTS.faqs}”`,
    "Never say": `“${TENANT_DEFAULTS.doNot}”`,
  };

  // The REAL destinations, derived exactly the way runtime derives them (shared helper) — a raw
  // config string that runtime can't parse into a number must show the "nowhere to go" warning,
  // not masquerade as a working destination.
  const { notifyTo, escalateTo } = deriveRouting(cfg);

  return (
    <PortalShell active="/portal/knowledge" site={shellSite}>
      {header}
      <p className="mt-1 text-sm text-ink-soft">
        This is what she reads on every call. If something looks wrong, call Ivy and she&apos;ll update it.
      </p>

      {sites.length > 1 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {sites.map((sx) => {
            const active = sx.id === site.id;
            return (
              <Link
                key={sx.id}
                href={`/portal/knowledge?site=${sx.id}`}
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

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* What she says */}
        <section className="rounded-2xl border border-line bg-background">
          <h2 className="border-b border-line px-4 py-3 text-xs font-semibold uppercase tracking-widest text-ink-soft">
            What she says
          </h2>
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.label} className="px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-bold">{r.label}</p>
                  <span className="text-[11px] text-ink-soft">{r.hint}</span>
                </div>
                {r.value ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{r.value}</p>
                ) : (
                  <p className="mt-1 text-sm italic text-ink-soft">
                    Not set — safe default: {DEFAULTS[r.label]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Where things go + the update path */}
        <div className="flex flex-col gap-5">
          <section className="rounded-2xl border border-line bg-background">
            <h2 className="border-b border-line px-4 py-3 text-xs font-semibold uppercase tracking-widest text-ink-soft">
              Where things go
            </h2>
            <ul className="divide-y divide-line text-sm">
              <li className="px-4 py-3.5">
                <p className="font-bold">Messages text to</p>
                <p className="mt-0.5 text-ink-soft">{notifyTo || "Not set — messages have nowhere to go. Call Ivy to fix this first."}</p>
              </li>
              <li className="px-4 py-3.5">
                <p className="font-bold">Emergencies transfer to</p>
                <p className="mt-0.5 text-ink-soft">{escalateTo || "Not set — no live transfer; urgent calls become messages."}</p>
              </li>
              {cfg.notifyEmail?.trim() ? (
                <li className="px-4 py-3.5">
                  <p className="font-bold">Email copies to</p>
                  <p className="mt-0.5 text-ink-soft">{cfg.notifyEmail.trim()}</p>
                </li>
              ) : null}
              <li className="px-4 py-3.5">
                <p className="font-bold">Booking</p>
                <p className="mt-0.5 text-ink-soft">
                  {cfg.bookingMode === "book"
                    ? "On — she books real appointments onto your calendar."
                    : "Message-taking — she takes details and texts you instead of booking."}
                </p>
              </li>
            </ul>
          </section>

          <CallIvy
            compact
            heading="Something wrong or missing?"
            blurb="Call Ivy — tell her what changed (new hours, new services, a different number) and she updates this for you."
          />
        </div>
      </div>
    </PortalShell>
  );
}
