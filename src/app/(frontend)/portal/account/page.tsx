import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AccountForm } from "@/components/portal/account-form";
import { PortalHeader } from "@/components/portal/portal-header";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Account",
};

export default async function AccountPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { user } = session;

  return (
    <div className="flex flex-1 flex-col">
      <PortalHeader email={user.email} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <h1 className="text-4xl font-extrabold tracking-tight">Account</h1>
        <p className="mt-3 text-ink-soft">
          Manage your profile and billing details.
        </p>

        <div className="mt-10 space-y-6">
          <section className="rounded-2xl border border-line bg-surface p-8">
            <h2 className="text-xl font-bold tracking-tight">Profile</h2>
            <AccountForm initialName={user.name ?? ""} email={user.email} />
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
