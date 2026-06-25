import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PortalHeader } from "@/components/portal/portal-header";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";

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
    href: "/command/automation",
    label: "Automation",
    description: "Venus outreach settings — daily limits, ramp, pause toggle.",
  },
  {
    href: "/command/jobs",
    label: "Jobs",
    description: "Venus activity log — what she scouted, sent, and followed up on.",
  },
  {
    href: "/command/analytics",
    label: "Analytics",
    description: "Site traffic via Vercel Analytics.",
  },
  {
    href: "/command/team",
    label: "Team",
    description: "Portal users who have signed up.",
  },
];

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
