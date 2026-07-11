import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { and, eq, gt, ne, sql } from "drizzle-orm";

import { PortalHeader } from "@/components/portal/portal-header";
import { db, forgeSites, leads } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { PLANS, type PlanKey } from "@/lib/plans";
import { trialStatus } from "@/lib/trial";
import { SiteBilling } from "./site-billing";
import { TemplatePicker } from "./template-picker";

export const metadata: Metadata = {
  title: "Portal",
};

const ADMIN_PAGES = [
  {
    href: "/command",
    label: "Overview",
    description: "Pipeline summary — prospects, leads, appointments at a glance.",
  },
  {
    href: "/command/prospects",
    label: "Prospects",
    description: "Local businesses the prospector found — review and approve sites to build.",
  },
  {
    href: "/command/leads",
    label: "Leads",
    description: "Inbound leads from the website contact and industry pages.",
  },
  {
    href: "/command/appointments",
    label: "Appointments",
    description: "Booked discovery calls and their status.",
  },
  {
    href: "/command/crons",
    label: "Venus",
    description: "Crons, audit log, and team — how Venus runs and what she's done.",
  },
  {
    href: "/command/settings",
    label: "Settings",
    description: "Outreach automation, Google Calendar status, and analytics.",
  },
];

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ locked?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { locked } = await searchParams;
  const { user } = session;
  const firstName = user.name?.split(" ")[0] || "there";
  const isAdmin = isAdminEmail(user.email);
  const accountNumber = (user as { accountNumber?: string | null }).accountNumber || null;

  const mySites = await db
    .select({
      id: forgeSites.id,
      businessName: forgeSites.businessName,
      liveUrl: forgeSites.liveUrl,
      status: forgeSites.status,
      builtAt: forgeSites.builtAt,
      preferredTemplate: forgeSites.preferredTemplate,
      plan: forgeSites.plan,
      oneTimePaid: forgeSites.oneTimePaid,
      domainCredits: forgeSites.domainCredits,
      domain: forgeSites.domain,
      domainStatus: forgeSites.domainStatus,
      receptionistStatus: forgeSites.receptionistStatus,
    })
    .from(forgeSites)
    // Deleted sites are retired — never surface them (or their action buttons) in the portal.
    .where(and(eq(forgeSites.claimedByUserId, user.id), ne(forgeSites.status, "deleted")));

  // Upcoming strategy call for this user (the booking flow stores it on `leads`,
  // matched by email). Future, booked slots only — past calls shouldn't nag.
  const upcomingCalls = await db
    .select({
      name: leads.name,
      bookedSlot: leads.bookedSlot,
      meetLink: leads.meetLink,
      gcalHtmlLink: leads.gcalHtmlLink,
    })
    .from(leads)
    .where(
      and(
        sql`lower(${leads.email}) = ${user.email.toLowerCase()}`,
        eq(leads.status, "booked"),
        gt(leads.bookedSlot, new Date().toISOString()),
      ),
    )
    .orderBy(leads.bookedSlot)
    .limit(3);

  // Surface a site whose LATEST edit failed, so the customer knows their change isn't live yet.
  const siteIds = mySites.map((s) => s.id);
  const failedSites = new Set<number>();
  if (siteIds.length > 0) {
    const res = await db.execute(sql`
      SELECT DISTINCT ON (site_id) site_id, status FROM edit_requests
      WHERE site_id IN (${sql.join(siteIds.map((i) => sql`${i}`), sql`, `)})
      ORDER BY site_id, created_at DESC`);
    for (const r of (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[]) {
      if (r.status === "failed") failedSites.add(Number(r.site_id));
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PortalHeader email={user.email} isAdmin={isAdmin} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">
          {isAdmin ? "Command Center" : "Client Portal"}
        </p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight">
          Welcome back, {firstName}.
        </h1>
        <p className="mt-3 max-w-xl text-ink-soft">
          {isAdmin
            ? "Your admin dashboards and client portal in one place."
            : "Track your project’s progress and manage billing in one place."}
        </p>

        {accountNumber && (
          <div className="mt-5 inline-flex items-center gap-2.5 rounded-full border border-brand/30 bg-brand-tint/40 px-4 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-brand">Account ID</span>
            <span className="font-mono text-lg font-bold tracking-widest tabular-nums text-ink">{accountNumber}</span>
            <span className="hidden text-xs text-ink-soft sm:inline">· read it to our phone assistant to pull up your account</span>
          </div>
        )}

        {locked && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="font-semibold">Editing is locked.</span> Your free trial has ended — subscribe below to unlock
            Studio and content edits and take your site live.
          </div>
        )}

        {upcomingCalls.length > 0 && (
          <section className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
              Upcoming call
            </h2>
            <div className="mt-3 space-y-3">
              {upcomingCalls.map((call) => {
                const when = new Date(call.bookedSlot as string);
                const dateStr = new Intl.DateTimeFormat("en-US", {
                  weekday: "long", month: "long", day: "numeric", timeZone: "America/Los_Angeles",
                }).format(when);
                const timeStr = new Intl.DateTimeFormat("en-US", {
                  hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles",
                }).format(when);
                return (
                  <div
                    key={call.bookedSlot}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-brand/30 bg-brand-tint/50 p-6"
                  >
                    <div className="flex items-center gap-4">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand text-white">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 2v4M16 2v4M3 9h18M5 5h14v16H5z" />
                        </svg>
                      </span>
                      <div>
                        <p className="font-bold tracking-tight">Strategy call with Joe</p>
                        <p className="text-sm text-ink-soft">
                          {dateStr} · {timeStr} Pacific · 30 min over Google Meet
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {call.gcalHtmlLink && (
                        <a
                          href={call.gcalHtmlLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-full border border-line bg-background px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface"
                        >
                          View in calendar
                        </a>
                      )}
                      {call.meetLink && (
                        <a
                          href={call.meetLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
                        >
                          Join Google Meet
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {isAdmin && (
          <section className="mt-12">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
              Admin
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ADMIN_PAGES.map((page) => (
                <Link
                  key={page.href}
                  href={page.href}
                  className="group flex flex-col gap-1 rounded-xl border border-line bg-surface p-5 transition-colors hover:border-brand hover:bg-brand-tint"
                >
                  <span className="font-semibold tracking-tight group-hover:text-brand">
                    {page.label}
                  </span>
                  <span className="text-sm leading-snug text-ink-soft">
                    {page.description}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="mt-12">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
            Your sites
          </h2>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            {mySites.map((site) => {
              const t = trialStatus(site);
              return (
              <div key={site.id} className="rounded-2xl border border-line bg-surface p-8">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-xl font-bold tracking-tight">{site.businessName}</h3>
                  {t.state === "paid" ? (
                    <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">Active</span>
                  ) : t.state === "trial" ? (
                    <span className="rounded-full bg-brand-tint px-2.5 py-1 text-xs font-semibold text-brand">
                      Trial · {t.daysLeft}d left
                    </span>
                  ) : t.state === "trial_ended" ? (
                    <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">Trial ended</span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">Not active</span>
                  )}
                </div>

                {(site.status === "approved" || site.status === "building") && (
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-brand/40 bg-brand-tint px-4 py-3 text-sm text-brand">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" />
                    We&apos;re building your site now — it&apos;ll appear here shortly.
                  </div>
                )}

                {failedSites.has(site.id) && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    ⚠️ Your last change didn&apos;t go live yet — we&apos;ll retry it automatically. If it sticks, reply to your welcome email and we&apos;ll sort it out.
                  </div>
                )}

                <TemplatePicker siteId={site.id} current={site.preferredTemplate} />

                {site.oneTimePaid ? (
                  <>
                    <p className="mt-2 text-sm text-ink-soft">
                      {site.plan ? `${PLANS[site.plan as PlanKey]?.label ?? site.plan} plan · active` : "Active"}
                    </p>

                    {site.domain ? (
                      <div className="mt-4 rounded-xl border border-line bg-background p-4">
                        <p className="text-sm font-semibold">🌐 {site.domain}</p>
                        <p className="mt-1 text-xs text-ink-soft">
                          {site.domainStatus === "registered"
                            ? "Registered & connecting (DNS can take up to an hour)."
                            : "Reserved — we're finishing the connection."}
                        </p>
                      </div>
                    ) : site.domainCredits > 0 ? (
                      <div className="mt-4 rounded-xl border border-brand/40 bg-brand-tint p-4">
                        <p className="text-sm font-semibold text-brand">
                          🎁 {site.domainCredits} free domain credit
                        </p>
                        <p className="mt-1 text-xs text-ink-soft">
                          Register a new domain on us, or connect one you already own.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link
                            href="/portal/domain"
                            className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-dark"
                          >
                            Claim free domain →
                          </Link>
                          <Link
                            href="/portal/transfer"
                            className="inline-flex items-center justify-center rounded-full border border-line bg-background px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-surface"
                          >
                            I own a domain
                          </Link>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          href="/portal/domain"
                          className="inline-flex items-center justify-center rounded-full border border-line bg-background px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-surface"
                        >
                          Add a domain
                        </Link>
                        <Link
                          href="/portal/transfer"
                          className="inline-flex items-center justify-center rounded-full border border-line bg-background px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-surface"
                        >
                          Connect one I own
                        </Link>
                      </div>
                    )}

                    {site.liveUrl && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          href={`/portal/edit/${site.id}`}
                          className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
                        >
                          ✏️ Request edits
                        </Link>
                        <a
                          href={site.liveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-full border border-line bg-background px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface"
                        >
                          View your site →
                        </a>
                        <Link
                          href={`/portal/receptionist/${site.id}`}
                          className="inline-flex items-center justify-center rounded-full border border-line bg-background px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface"
                        >
                          🎙️ {site.receptionistStatus && site.receptionistStatus !== "none" ? "Receptionist setup" : "Set up AI receptionist"}
                        </Link>
                      </div>
                    )}
                  </>
                ) : site.liveUrl ? (
                  <>
                    {/* Built + unpaid → 7-day trial. Site stays viewable; editing gated. */}
                    {t.state === "trial" ? (
                      <div className="mt-3 rounded-xl border border-brand/40 bg-brand-tint px-4 py-3 text-sm text-brand">
                        <span className="font-semibold">{t.daysLeft} day{t.daysLeft === 1 ? "" : "s"} left in your free trial.</span>{" "}
                        Play with your site — subscribe to keep editing and take it live on your domain.
                      </div>
                    ) : (
                      <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        <span className="font-semibold">Your free trial ended.</span>{" "}
                        Your site&apos;s still here — subscribe to unlock editing and take it live.
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {t.canEdit ? (
                        <Link
                          href={`/portal/edit/${site.id}`}
                          className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
                        >
                          ✏️ Edit your site
                        </Link>
                      ) : (
                        <span className="inline-flex items-center justify-center rounded-full border border-line bg-background px-5 py-2.5 text-sm font-semibold text-ink-soft">
                          🔒 Editing locked
                        </span>
                      )}
                      <a
                        href={site.liveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-full border border-line bg-background px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface"
                      >
                        View your site →
                      </a>
                    </div>

                    <div className="mt-4">
                      <SiteBilling siteId={site.id} />
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-ink-soft">
                      Claimed — pick a plan to activate hosting{site.liveUrl ? " and go live" : ""}.
                    </p>
                    <SiteBilling siteId={site.id} />
                  </>
                )}
              </div>
              );
            })}
            <Link
              href="/portal/claim"
              className="group flex flex-col justify-center rounded-2xl border border-dashed border-line bg-surface p-8 text-center transition-colors hover:border-brand hover:bg-brand-tint"
            >
              <span className="text-2xl">＋</span>
              <span className="mt-1 font-semibold tracking-tight group-hover:text-brand">
                {mySites.length ? "Claim another site" : "Claim your site"}
              </span>
              <span className="mt-1 text-sm text-ink-soft">
                Have a claim code? Link your website to this account.
              </span>
            </Link>
            <Link
              href="/portal/build"
              className="group flex flex-col justify-center rounded-2xl border border-dashed border-line bg-surface p-8 text-center transition-colors hover:border-brand hover:bg-brand-tint"
            >
              <span className="text-2xl">🛠️</span>
              <span className="mt-1 font-semibold tracking-tight group-hover:text-brand">
                Build a new site
              </span>
              <span className="mt-1 text-sm text-ink-soft">
                No site yet? Tell us about your business — we&apos;ll build one. 7 days free.
              </span>
            </Link>
            <Link
              href="/portal/rebuild"
              className="group flex flex-col justify-center rounded-2xl border border-dashed border-line bg-surface p-8 text-center transition-colors hover:border-brand hover:bg-brand-tint"
            >
              <span className="text-2xl">↻</span>
              <span className="mt-1 font-semibold tracking-tight group-hover:text-brand">
                Rebuild an existing site
              </span>
              <span className="mt-1 text-sm text-ink-soft">
                Have a website already? We'll crawl it and rebuild it better.
              </span>
            </Link>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
            Your AI
          </h2>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <Link
              href="/solutions"
              className="group rounded-2xl border border-line bg-surface p-8 transition-colors hover:border-brand hover:bg-brand-tint"
            >
              <span className="text-2xl">🤖</span>
              <h3 className="mt-2 text-xl font-bold tracking-tight group-hover:text-brand">
                Build your agents
              </h3>
              <p className="mt-2 leading-relaxed text-ink-soft">
                Custom AI agents built around how your business actually works — to
                solve problems, scale the work, and close more sales.
              </p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
                Explore agentic solutions
                <span aria-hidden>→</span>
              </span>
            </Link>

            <Link
              href="/portal/receptionist"
              className="group rounded-2xl border border-line bg-surface p-8 transition-colors hover:border-brand hover:bg-brand-tint"
            >
              <span className="text-2xl">🎙️</span>
              <h3 className="mt-2 text-xl font-bold tracking-tight group-hover:text-brand">
                Set up the voice receptionist
              </h3>
              <p className="mt-2 leading-relaxed text-ink-soft">
                An AI receptionist that answers your phone, helps callers, and books
                jobs around the clock — set it up in a few minutes.
              </p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
                Set up your receptionist
                <span aria-hidden>→</span>
              </span>
            </Link>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
            {isAdmin ? "Client" : "Your account"}
          </h2>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface p-8">
              <h3 className="text-xl font-bold tracking-tight">Book a call with Joe</h3>
              <p className="mt-2 leading-relaxed text-ink-soft">
                Grab a 30-minute strategy call over Google Meet — talk plans, your
                receptionist, domains, or anything on your mind.
              </p>
              <Link
                href="/portal/book"
                className="mt-4 inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
              >
                📅 Book a call
              </Link>
            </div>

            <div className="rounded-2xl border border-line bg-surface p-8">
              <h3 className="text-xl font-bold tracking-tight">Billing</h3>
              <p className="mt-2 leading-relaxed text-ink-soft">
                Manage your payment method, view invoices, and update billing
                securely through Stripe.
              </p>
              <Link
                href="/portal/billing"
                className="mt-4 inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
              >
                Manage billing
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
