import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { PortalHeader } from "@/components/portal/portal-header";
import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { PLANS, PLAN_KEYS, ONE_TIME_BUILD_AMOUNT, annualSavings, type PlanKey, type BillingInterval } from "@/lib/plans";
import { SiteBilling } from "../site-billing";

export const metadata: Metadata = { title: "Plans & billing" };

const POPULAR: PlanKey = "voice";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string; billing?: string; paid?: string; interval?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/billing");
  const { user } = session;

  const sites = await db
    .select({
      id: forgeSites.id,
      businessName: forgeSites.businessName,
      plan: forgeSites.plan,
      oneTimePaid: forgeSites.oneTimePaid,
      subscriptionStatus: forgeSites.subscriptionStatus,
      liveUrl: forgeSites.liveUrl,
      status: forgeSites.status,
    })
    .from(forgeSites)
    .where(eq(forgeSites.claimedByUserId, user.id));

  const { changed, billing, interval: intervalParam } = await searchParams;
  const interval: BillingInterval = intervalParam === "year" ? "year" : "month";
  const yearly = interval === "year";
  const activeSites = sites.filter((s) => s.oneTimePaid);
  const currentPlans = new Set(activeSites.map((s) => s.plan).filter(Boolean) as string[]);
  const hasActive = activeSites.length > 0;

  return (
    <div className="flex flex-1 flex-col">
      <PortalHeader email={user.email} isAdmin={isAdminEmail(user.email)} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">Plans &amp; billing</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight">Choose the plan that fits.</h1>
        <p className="mt-3 max-w-2xl text-ink-soft">
          Every plan is a one-time ${ONE_TIME_BUILD_AMOUNT} build plus a monthly subscription. Upgrade,
          downgrade, or cancel anytime — changes take effect immediately.
        </p>

        {changed && (
          <div className="mt-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            Your plan change was saved — it may take a moment to reflect here.
          </div>
        )}
        {billing === "error" && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Something went wrong opening billing. Try again, or reply to your welcome email.
          </div>
        )}
        {billing === "unavailable" && (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Billing is temporarily unavailable — hang tight.
          </div>
        )}

        {/* Your subscriptions */}
        {sites.length > 0 && (
          <section id="your-subscriptions" className="mt-10 scroll-mt-20">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">Your subscriptions</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {sites.map((site) => {
                const planKey = site.plan as PlanKey | null;
                const plan = planKey && planKey in PLANS ? PLANS[planKey] : null;
                return (
                  <div key={site.id} className="rounded-2xl border border-line bg-surface p-6">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-lg font-bold tracking-tight">{site.businessName}</h3>
                      {site.oneTimePaid ? (
                        <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">
                          {site.subscriptionStatus === "active" ? "Active" : site.subscriptionStatus || "Active"}
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                          Not active
                        </span>
                      )}
                    </div>

                    {site.oneTimePaid && plan ? (
                      <>
                        <p className="mt-2 text-sm text-ink-soft">
                          On <span className="font-semibold text-ink">{plan.label}</span> · ${plan.monthly}/mo
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link
                            href={`/portal/billing/change?site=${site.id}`}
                            className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
                          >
                            Change plan →
                          </Link>
                          <Link
                            href="/portal/billing/portal"
                            className="inline-flex items-center justify-center rounded-full border border-line bg-background px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface"
                          >
                            Payment &amp; invoices
                          </Link>
                        </div>
                      </>
                    ) : site.liveUrl ? (
                      <>
                        <p className="mt-2 text-sm text-ink-soft">
                          Pick a plan to activate hosting and keep your site live.
                        </p>
                        <SiteBilling siteId={site.id} />
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-ink-soft">
                        We&apos;re building your site — you&apos;ll be able to activate a plan once it&apos;s ready.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Compare plans */}
        <section className="mt-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
              {hasActive ? "Compare plans" : "Plans"}
            </h2>
            {/* Billing-interval toggle (URL-param so this stays a server component) */}
            <div className="inline-flex rounded-full border border-line bg-surface p-1 text-sm font-semibold">
              <Link
                href="/portal/billing?interval=month"
                scroll={false}
                className={`rounded-full px-4 py-1.5 transition-colors ${!yearly ? "bg-brand text-white" : "text-ink-soft hover:text-ink"}`}
              >
                Monthly
              </Link>
              <Link
                href="/portal/billing?interval=year"
                scroll={false}
                className={`rounded-full px-4 py-1.5 transition-colors ${yearly ? "bg-brand text-white" : "text-ink-soft hover:text-ink"}`}
              >
                Yearly <span className={yearly ? "text-white/80" : "text-brand"}>· save ~2 mo</span>
              </Link>
            </div>
          </div>
          <div className="mt-4 grid gap-5 lg:grid-cols-3">
            {PLAN_KEYS.map((k) => {
              const p = PLANS[k];
              const isCurrent = currentPlans.has(k);
              const popular = k === POPULAR;
              return (
                <div
                  key={k}
                  className={`relative flex flex-col rounded-2xl border bg-surface p-7 ${
                    popular ? "border-brand ring-1 ring-brand/30" : "border-line"
                  }`}
                >
                  {popular && !isCurrent && (
                    <span className="absolute right-5 top-5 rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                      Most popular
                    </span>
                  )}
                  {isCurrent && (
                    <span className="absolute right-5 top-5 rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-green-800">
                      Your plan
                    </span>
                  )}
                  <h3 className="text-xl font-extrabold tracking-tight">{p.label}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">{p.blurb}</p>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold tracking-tight">
                      ${yearly ? p.annual.toLocaleString() : p.monthly}
                    </span>
                    <span className="text-sm text-ink-soft">/{yearly ? "yr" : "mo"}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">
                    {yearly && (
                      <span className="font-semibold text-green-700">
                        Save ${annualSavings(k).toLocaleString()}/yr ·{" "}
                      </span>
                    )}
                    + ${ONE_TIME_BUILD_AMOUNT} one-time build
                  </p>
                  <ul className="mt-5 space-y-2.5">
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-2.5 text-sm leading-relaxed">
                        <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-6">
                    {isCurrent ? (
                      <span className="inline-flex w-full items-center justify-center rounded-full border border-line bg-background px-5 py-2.5 text-sm font-semibold text-ink-soft">
                        Current plan
                      </span>
                    ) : hasActive ? (
                      <Link
                        href={`/portal/billing/change?site=${activeSites[0].id}`}
                        className={`inline-flex w-full items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold transition-colors ${
                          popular ? "bg-brand text-white hover:bg-brand-dark" : "border border-line bg-background text-ink hover:bg-surface"
                        }`}
                      >
                        Switch to {p.label}
                      </Link>
                    ) : (
                      <Link
                        href={sites.length ? "#your-subscriptions" : "/portal/build"}
                        className={`inline-flex w-full items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold transition-colors ${
                          popular ? "bg-brand text-white hover:bg-brand-dark" : "border border-line bg-background text-ink hover:bg-surface"
                        }`}
                      >
                        {sites.length ? "Activate a site" : "Get started"}
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-6 text-center text-xs text-ink-soft">
            Includes a free domain · secure checkout via Stripe · cancel anytime. Plan changes are prorated.
          </p>
        </section>
      </main>
    </div>
  );
}
