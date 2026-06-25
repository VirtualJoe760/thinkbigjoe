import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Logo } from "@/components/logo";
import { AuthCard } from "@/components/portal/auth-card";
import { auth, socialProviderStatus } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Login",
};

export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/portal");

  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-6xl px-6 py-6">
        <Logo />
      </div>
      <div className="flex flex-1 items-center justify-center px-6 pb-24">
        <AuthCard
          google={socialProviderStatus.google}
          facebook={socialProviderStatus.facebook}
        />
      </div>
    </main>
  );
}
