/**
 * The email suppression list — bounced + complained addresses we must never mail again.
 *
 * SES (and every sender) throttles then BANS accounts whose bounce/complaint rates climb, so this is
 * load-bearing, not optional: every bulk send checks it first, and the SNS webhook writes to it.
 * See docs/DELIVERABILITY.md + docs/EMAIL_SCALE.md.
 */
import { inArray, sql } from "drizzle-orm";

import { db, emailSuppressions } from "@/db";

export type SuppressReason = "bounce" | "complaint" | "manual";

const norm = (e: string) => e.trim().toLowerCase();

/** Add an address to the suppression list (idempotent). */
export async function suppress(email: string, reason: SuppressReason, detail?: string): Promise<void> {
  const e = norm(email);
  if (!e) return;
  await db
    .insert(emailSuppressions)
    .values({ email: e, reason, detail: detail ?? null })
    .onConflictDoNothing();
}

/** The subset of `emails` that are suppressed — one query, for filtering a batch before sending. */
export async function suppressedSet(emails: string[]): Promise<Set<string>> {
  const lowered = [...new Set(emails.map(norm).filter(Boolean))];
  if (!lowered.length) return new Set();
  // Stored addresses are always normalized (every write goes through `suppress()` → `norm()`), so an
  // equality match against the column is correct. `inArray` compiles to `email IN ($1, …)`; a hand-
  // written `= ANY(${array})` does NOT work — Drizzle expands a JS array into a tuple, not a PG array.
  const rows = await db
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(inArray(emailSuppressions.email, lowered));
  return new Set(rows.map((r) => r.email));
}
