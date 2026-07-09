"use server";

import { db, activityLog } from "@/db";

/**
 * Record a new user's consent at sign-up — the A2P 10DLC / marketing audit trail.
 * Terms + Privacy agreement is required to create an account (createdAt is the
 * acceptance time); marketing (email/SMS) consent is a separate, optional opt-in.
 * Logged to activity_log so we have a durable, timestamped record per email.
 */
export async function recordSignupConsent(email: string, marketingConsent: boolean) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return;
  try {
    await db.insert(activityLog).values({
      actor: "auth",
      eventType: "signup_consent",
      summary: `${e} agreed to Terms & Privacy; marketing ${marketingConsent ? "opted in" : "declined"}`,
      metadata: {
        auto: true,
        detail: { email: e, termsAccepted: true, marketingConsent, at: new Date().toISOString() },
      },
    });
  } catch (err) {
    console.error("[consent] record failed:", err);
  }
}
