import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PortalHeader } from "@/components/portal/portal-header";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { ClaimForm } from "./claim-form";

export const metadata: Metadata = {
  title: "Claim your site",
};

export default async function ClaimPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/portal/claim");

  return (
    <div className="flex flex-1 flex-col">
      <PortalHeader email={session.user.email} isAdmin={isAdminEmail(session.user.email)} />

      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">
          Claim your site
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          Redeem your claim code
        </h1>
        <p className="mt-3 text-ink-soft">
          We built you a website. Enter the claim code we sent you to link it to
          your account — then you can manage it and add your AI receptionist.
        </p>

        <div className="mt-8">
          <ClaimForm />
        </div>
      </main>
    </div>
  );
}
