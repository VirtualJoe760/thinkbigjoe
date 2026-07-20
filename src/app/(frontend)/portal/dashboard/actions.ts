"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, sql } from "drizzle-orm";

import { db, calls, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { notifyTelegram } from "@/lib/telegram";

export type RateState = { ok: boolean; message?: string };

/**
 * Owner rates one call — "handled well" / "got this wrong" — the feedback loop that lets us improve
 * the agent from real signal instead of guessing.
 *
 * THE SECURITY BOUNDARY IS THE WHOLE POINT OF THIS FUNCTION. `callId` is client-supplied, so it must
 * be proven to belong to a site THIS user owns before we write. The UPDATE joins the call to
 * forge_sites and filters on claimed_by_user_id in one statement — so a crafted callId for someone
 * else's call updates zero rows and returns "not found", never touches their data.
 */
export async function rateCall(
  callId: number,
  rating: "good" | "bad" | null,
  note?: string,
): Promise<RateState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, message: "Please sign in." };
  if (!Number.isFinite(callId)) return { ok: false, message: "Missing call." };
  if (rating !== "good" && rating !== "bad" && rating !== null) {
    return { ok: false, message: "Invalid rating." };
  }

  // Single statement: update the call ONLY if it belongs to a site this user claims. The subquery is
  // the ownership check — no separate SELECT to race against, no way to write another owner's call.
  const cleanNote = (note ?? "").trim().slice(0, 500) || null;
  const updated = await db
    .update(calls)
    .set({
      ownerRating: rating,
      ownerNote: rating === "bad" ? cleanNote : null, // a note only means something on a flag
      ownerRatedAt: rating === null ? null : new Date().toISOString(),
    })
    .where(
      and(
        eq(calls.id, callId),
        sql`${calls.siteId} IN (
          SELECT id FROM ${forgeSites} WHERE claimed_by_user_id = ${session.user.id}
        )`,
      ),
    )
    .returning({ id: calls.id, siteId: calls.siteId });

  if (updated.length === 0) {
    // Either the call doesn't exist or it isn't theirs — same answer either way, no oracle.
    return { ok: false, message: "We couldn't find that call on your account." };
  }

  // A flagged call is signal we want to act on — ping so it doesn't sit unseen in the DB. A "good"
  // rating is quietly recorded (it's reassurance for the owner, not an action item for us).
  if (rating === "bad") {
    const detail = cleanNote ? `\n"${cleanNote}"` : "";
    notifyTelegram(
      `👎 <b>Call flagged by a customer</b>\nSite ${updated[0].siteId}, call #${updated[0].id} — the AI got something wrong.${detail}`,
    ).catch(() => {});
  }

  revalidatePath("/portal/dashboard");
  return { ok: true };
}
