"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { and, desc, eq, ne } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { disconnectGoogle } from "@/lib/google-oauth";
import { ensureOwnerContact, updateOwnerContact, type EditableContact } from "@/lib/contacts";

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

/** The site the signed-in user has claimed (most recent), or null. */
async function claimedSite(userId: string): Promise<{ id: number } | null> {
  const [s] = await db
    .select({ id: forgeSites.id })
    .from(forgeSites)
    .where(and(eq(forgeSites.claimedByUserId, userId), ne(forgeSites.status, "deleted")))
    .orderBy(desc(forgeSites.claimedAt))
    .limit(1);
  return s ?? null;
}

/**
 * Save the business/contact details from Settings onto the owner contact (the `contacts` table).
 * Only ever touches the owner contact of a site THIS user has claimed — the form can't be pointed at
 * someone else's record.
 */
export async function saveContactAction(
  _prev: { ok: boolean; message?: string } | null,
  formData: FormData,
): Promise<{ ok: boolean; message?: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, message: "Please sign in." };

  const site = await claimedSite(session.user.id);
  if (!site) return { ok: false, message: "Claim your site first to edit its details." };

  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const email = str("email");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: "That email doesn't look right." };
  }

  const patch: EditableContact = {
    businessName: str("businessName"),
    name: str("name"),
    email,
    phone: str("phone"),
    address: str("address"),
  };

  // Make sure the owner contact exists (first-ever edit on a freshly claimed site), then update it.
  await ensureOwnerContact(site.id, session.user.id);
  const row = await updateOwnerContact(site.id, patch);
  if (!row) return { ok: false, message: "Couldn't save — please try again." };

  revalidatePath("/portal/settings");
  return { ok: true, message: "Saved." };
}
