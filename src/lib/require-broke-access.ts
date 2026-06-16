import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "./auth";
import { hasBrokeAccess } from "./broke-access";

/**
 * Gate for the broke section (/portal/broke), backed by better-auth + the broke membership
 * allowlist. `requireBrokeAccess` redirects (use in pages); `assertBrokeAccess` throws (server
 * actions). Mirrors require-admin.ts.
 */
export async function requireBrokeAccess(): Promise<{ email: string }> {
  const session = await auth.api.getSession({ headers: await nextHeaders() });
  const email = session?.user?.email;
  if (!session) redirect("/login?redirect=/portal/broke");
  if (!hasBrokeAccess(email)) redirect("/portal/account?broke=denied");
  return { email: email as string };
}

export async function assertBrokeAccess(): Promise<void> {
  const session = await auth.api.getSession({ headers: await nextHeaders() });
  if (!session || !hasBrokeAccess(session.user?.email)) {
    throw new Error("Unauthorized");
  }
}
