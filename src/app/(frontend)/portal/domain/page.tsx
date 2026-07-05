import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PortalHeader } from "@/components/portal/portal-header";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { DomainForm } from "./domain-form";

export const metadata: Metadata = {
  title: "Your free domain",
};

export default async function DomainPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/domain");

  return (
    <div className="flex flex-1 flex-col">
      <PortalHeader email={session.user.email} isAdmin={isAdminEmail(session.user.email)} />

      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">Free domain</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          Claim your included domain
        </h1>
        <p className="mt-3 text-ink-soft">
          Your plan includes a free domain. Tell us the one you want — we'll
          register a new one on us, or help you transfer one you already own, and
          connect it to your site.
        </p>

        <div className="mt-8">
          <DomainForm />
        </div>

        <div className="mt-8 rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-sm font-bold tracking-tight">Already own a domain?</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            No problem — enter it above and we'll walk you through pointing it at
            your new site. You keep ownership; nothing changes with your registrar
            until you approve it.
          </p>
        </div>
      </main>
    </div>
  );
}
