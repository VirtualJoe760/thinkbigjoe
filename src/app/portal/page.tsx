import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/portal/sign-out-button";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Client Portal",
};

export default async function PortalPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { user } = session;
  const firstName = user.name?.split(" ")[0] || "there";

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Logo />
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-ink-soft sm:block">
              {user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">
          Client Portal
        </p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight">
          Welcome back, {firstName}.
        </h1>
        <p className="mt-3 max-w-xl text-ink-soft">
          Here&apos;s where you&apos;ll track your project&apos;s progress and
          manage billing. We&apos;re wiring these up now.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <PlaceholderCard
            title="Project progress"
            body="Milestones, status updates, and deliverables for your engagement — coming online shortly."
          />
          <PlaceholderCard
            title="Billing"
            body="Invoices, payment method, and subscription managed securely through Stripe — coming online shortly."
          />
        </div>
      </main>
    </div>
  );
}

function PlaceholderCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-8">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      <p className="mt-2 leading-relaxed text-ink-soft">{body}</p>
      <span className="mt-4 inline-block rounded-full bg-brand-tint px-3 py-1 text-xs font-semibold text-brand">
        Coming soon
      </span>
    </div>
  );
}
