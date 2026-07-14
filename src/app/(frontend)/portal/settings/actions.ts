"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { disconnectGoogle } from "@/lib/google-oauth";

/**
 * Revoke Google access and forget the tokens. One Google account is stored per portal user, so this
 * disconnects Calendar and Contacts together — there's a single refresh token behind both.
 * `disconnectGoogle` revokes with Google first, then deletes the row (see the privacy policy claim).
 */
export async function disconnectGoogleAction(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return;
  await disconnectGoogle(session.user.id);
  revalidatePath("/portal/settings");
  revalidatePath("/portal/calendar");
}
