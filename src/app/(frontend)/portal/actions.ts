"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { normalizeClaimCode } from "@/lib/claim-code";

export type ClaimState = {
  ok: boolean;
  message: string;
  site?: { businessName: string; liveUrl: string | null };
};

/**
 * Redeem a claim code (from useActionState). Any signed-in user can claim a
 * built site by its code; it attaches that site to their account. Idempotent
 * for the same user, and refuses codes already claimed by someone else.
 */
export async function claimSite(
  _prev: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { ok: false, message: "Please sign in to claim your site." };
  }

  const code = normalizeClaimCode(String(formData.get("code") || ""));
  if (!code) return { ok: false, message: "Enter the claim code from your welcome email." };

  const [site] = await db
    .select()
    .from(forgeSites)
    .where(eq(forgeSites.claimCode, code))
    .limit(1);

  if (!site) {
    return { ok: false, message: "That code didn't match any site — double-check it and try again." };
  }
  const found = { businessName: site.businessName, liveUrl: site.liveUrl };

  if (site.claimedByUserId && site.claimedByUserId !== session.user.id) {
    return { ok: false, message: "This site has already been claimed by another account." };
  }
  if (site.claimedByUserId === session.user.id) {
    return { ok: true, message: `You've already claimed ${site.businessName}.`, site: found };
  }

  await db
    .update(forgeSites)
    .set({ claimedByUserId: session.user.id, claimedAt: new Date().toISOString() })
    .where(eq(forgeSites.id, site.id));

  revalidatePath("/portal");
  return {
    ok: true,
    message: `Success — ${site.businessName} is now linked to your account.`,
    site: found,
  };
}
