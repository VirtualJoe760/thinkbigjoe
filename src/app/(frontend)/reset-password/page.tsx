import type { Metadata } from "next";

import { Logo } from "@/components/logo";
import { ResetPasswordForm } from "@/components/portal/reset-password-form";

export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const invalid = Boolean(error) && error?.toLowerCase().includes("token");

  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-6xl px-6 py-6">
        <Logo />
      </div>
      <div className="flex flex-1 items-center justify-center px-6 pb-24">
        <ResetPasswordForm token={token ?? null} invalid={invalid} />
      </div>
    </main>
  );
}
