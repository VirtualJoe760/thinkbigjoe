import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { eq } from "drizzle-orm";

import { PortalHeader } from "@/components/portal/portal-header";
import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { PLANS, type PlanKey } from "@/lib/plans";
import { SiteBilling } from "./site-billing";

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
    description: "Review and approve LinkedIn outreach drafts. Approve → Venus sends.",
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

export default async function PortalPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { user } = session;
  const firstName = user.name?.split(" ")[0] || "there";
  const isAdmin = isAdminEmail(user.email);

  const mySites = await db
    .select({
      id: forgeSites.id,
      businessName: forgeSites.businessName,
      liveUrl: forgeSites.liveUrl,
      plan: forgeSites.plan,
      oneTimePaid: forgeSites.oneTimePaid,
      domainCredits: forgeSites.domainCredits,
      domain: forgeSites.domain,
      domainStatus: forgeSites.domainStatus,
    })
    .from(forgeSites)
    .where(eq(forgeSites.claimedByUserId, user.id));

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
            {mySites.map((site) => (
              <div key={site.id} className="rounded-2xl border border-line bg-surface p-8">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-xl font-bold tracking-tight">{site.businessName}</h3>
                  {site.oneTimePaid ? (
                    <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">
                      Active
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                      Not active
                    </span>
                  )}
                </div>

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
                      </div>
                    )}
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
            ))}
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
            {isAdmin ? "Client" : "Your account"}
          </h2>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface p-8">
              <h3 className="text-xl font-bold tracking-tight">Project progress</h3>
              <p className="mt-2 leading-relaxed text-ink-soft">
                Milestones, status updates, and deliverables for your engagement —
                coming online shortly.
              </p>
              <span className="mt-4 inline-block rounded-full bg-brand-tint px-3 py-1 text-xs font-semibold text-brand">
                Coming soon
              </span>
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
