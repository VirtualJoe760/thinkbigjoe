import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "./auth";
import { isAdminEmail } from "./admin";

/**
 * Admin gate for the Command Center, backed by better-auth + the email
 * allowlist (replaces Payload auth). `requireAdmin` redirects unauthorized
 * visitors (use in pages); `assertAdmin` throws (use in server actions).
 */
export async function requireAdmin(): Promise<{ email: string }> {
  const session = await auth.api.getSession({ headers: await nextHeaders() });
  const email = session?.user?.email;
  if (!session || !isAdminEmail(email)) {
    redirect("/login?redirect=/command");
  }
  return { email: email as string };
}

export async function assertAdmin(): Promise<void> {
  const session = await auth.api.getSession({ headers: await nextHeaders() });
  if (!session || !isAdminEmail(session.user?.email)) {
    throw new Error("Unauthorized");
  }
}
