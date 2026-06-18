import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Logo } from "@/components/logo";
import { AuthCard } from "@/components/portal/auth-card";
import { auth, socialProviderStatus } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Client Login",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/portal");
  const { from } = await searchParams;

  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-6xl px-6 py-6">
        <Logo />
      </div>
      <div className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="w-full max-w-md">
          {from === "broke" && (
            <div className="mb-5 rounded-2xl border border-line bg-surface p-4">
              <p className="font-semibold">Create your account to access broke</p>
              <p className="mt-1 text-sm text-ink-soft">
                broke.finance is an AI trading-augmentation membership under ThinkBigJoe. Create
                your account below — it unlocks once your broke membership is active.
              </p>
            </div>
          )}
          <AuthCard
            google={socialProviderStatus.google}
            facebook={socialProviderStatus.facebook}
          />
        </div>
      </div>
    </main>
  );
}
