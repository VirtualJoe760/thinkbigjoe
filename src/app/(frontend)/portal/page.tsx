import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PortalHeader } from "@/components/portal/portal-header";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";

export const metadata: Metadata = {
  title: "Client Portal",
};

export default async function PortalPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { user } = session;
  const firstName = user.name?.split(" ")[0] || "there";
  const isAdmin = isAdminEmail(user.email);

  return (
    <div className="flex flex-1 flex-col">
      <PortalHeader email={user.email} isAdmin={isAdmin} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">
          Client Portal
        </p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight">
          Welcome back, {firstName}.
        </h1>
        <p className="mt-3 max-w-xl text-ink-soft">
          Track your project&apos;s progress and manage billing in one place.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface p-8">
            <h2 className="text-xl font-bold tracking-tight">Project progress</h2>
            <p className="mt-2 leading-relaxed text-ink-soft">
              Milestones, status updates, and deliverables for your engagement —
              coming online shortly.
            </p>
            <span className="mt-4 inline-block rounded-full bg-brand-tint px-3 py-1 text-xs font-semibold text-brand">
              Coming soon
            </span>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-8">
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
          </div>
        </div>
      </main>
    </div>
  );
}
