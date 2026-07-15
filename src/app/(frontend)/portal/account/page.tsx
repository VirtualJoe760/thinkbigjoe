import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AccountForm } from "@/components/portal/account-form";
import { auth } from "@/lib/auth";
import { PLANS, PLAN_KEYS, ONE_TIME_BUILD_AMOUNT } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Account",
};

export default async function AccountPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { user } = session;
  const accountNumber = (user as { accountNumber?: string | null }).accountNumber || null;

  return (
    <div className="flex flex-1 flex-col">

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <h1 className="text-4xl font-extrabold tracking-tight">Account</h1>
        <p className="mt-3 text-ink-soft">
          Manage your profile and billing details.
        </p>

        <div className="mt-10 space-y-6">
          {accountNumber && (
            <section className="rounded-2xl border border-brand/30 bg-brand-tint/40 p-8">
              <h2 className="text-xs font-bold uppercase tracking-wide text-brand">Your account number</h2>
              <p className="mt-2 font-mono text-3xl font-extrabold tracking-widest tabular-nums text-ink">
                {accountNumber}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                This is your account ID. Have it handy when you call us — you can read it to our
                phone assistant to pull up your account and site.
              </p>
            </section>
          )}

          <section className="rounded-2xl border border-line bg-surface p-8">
            <h2 className="text-xl font-bold tracking-tight">Profile</h2>
            <AccountForm initialName={user.name ?? ""} email={user.email} />
          </section>

          <section className="rounded-2xl border border-line bg-surface p-8">
            <h2 className="text-xl font-bold tracking-tight">Plan options</h2>
            <p className="mt-2 leading-relaxed text-ink-soft">
              A one-time <span className="font-semibold text-ink">${ONE_TIME_BUILD_AMOUNT}</span> build fee
              plus a monthly plan. Review the options here, then choose and activate a plan on your site
              after you&apos;ve claimed it.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {PLAN_KEYS.map((key) => {
                const plan = PLANS[key];
                const bookJoe = key === "complete";
                return (
                  <div key={key} className="flex flex-col rounded-2xl border border-line bg-background p-5">
                    <div className="text-sm font-bold tracking-tight">{plan.label}</div>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="text-2xl font-extrabold tabular-nums">${plan.monthly}</span>
                      <span className="text-xs text-ink-soft">/mo</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-ink-soft">{plan.blurb}</p>
                    <ul className="mt-3 space-y-1.5 text-xs text-ink">
                      {plan.features.map((f) => (
                        <li key={f} className="flex gap-1.5">
                          <span className="text-brand">✓</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    {bookJoe && (
                      <p className="mt-3 rounded-lg bg-brand-tint/50 px-2.5 py-1.5 text-[11px] font-medium leading-snug text-brand">
                        Set up personally with Joe — book a call to get started.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-ink-soft">
              The Website + Voice plan includes your AI phone receptionist — once you&apos;re on it, our team
              activates it for your business.
            </p>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-8">
            <h2 className="text-xl font-bold tracking-tight">Billing</h2>
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
          </section>
        </div>
      </main>
    </div>
  );
}
