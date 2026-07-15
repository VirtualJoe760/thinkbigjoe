/**
 * The email suppression list — bounced + complained addresses we must never mail again.
 *
 * SES (and every sender) throttles then BANS accounts whose bounce/complaint rates climb, so this is
 * load-bearing, not optional: every bulk send checks it first, and the SNS webhook writes to it.
 * See docs/DELIVERABILITY.md + docs/EMAIL_SCALE.md.
 */
import { sql } from "drizzle-orm";

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

/** True if this address is suppressed. */
export async function isSuppressed(email: string): Promise<boolean> {
  const e = norm(email);
  if (!e) return true; // no address = don't send
  const [row] = await db
    .select({ id: emailSuppressions.id })
    .from(emailSuppressions)
    .where(sql`lower(email) = ${e}`)
    .limit(1);
  return Boolean(row);
}

/** The subset of `emails` that are suppressed — one query, for filtering a batch before sending. */
export async function suppressedSet(emails: string[]): Promise<Set<string>> {
  const lowered = [...new Set(emails.map(norm).filter(Boolean))];
  if (!lowered.length) return new Set();
  const rows = (
    await db.execute(sql`SELECT lower(email) AS email FROM email_suppressions WHERE lower(email) = ANY(${lowered})`)
  ).rows as Array<{ email: string }>;
  return new Set(rows.map((r) => r.email));
}
