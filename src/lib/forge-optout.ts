import { sql } from "drizzle-orm";

import { db, activityLog } from "@/db";

/** Resolve a forge_sites prospect by the last 10 digits of a phone number. */
export async function findProspectByPhone(phone: string): Promise<
  { id: number; businessName: string; claimCode: string | null; city: string | null; slug: string | null; liveUrl: string | null } | null
> {
  const last10 = (phone || "").replace(/[^0-9]/g, "").slice(-10);
  if (last10.length < 10) return null;
  const rows = (
    await db.execute(sql`
      SELECT id, business_name AS "businessName", claim_code AS "claimCode", city, slug, live_url AS "liveUrl"
      FROM forge_sites
      WHERE right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${last10}
        AND status <> 'deleted'
      ORDER BY (status = 'denied') ASC, updated_at DESC
      LIMIT 1`)
  ).rows as Array<{ id: number; businessName: string; claimCode: string | null; city: string | null; slug: string | null; liveUrl: string | null }>;
  return rows[0] ?? null;
}

/**
 * A prospect texted STOP. Mark them OPTED OUT — suppressed from further texting and
 * flagged so they surface in the "Declined / STOP" bucket on the leads page — but
 * keep them visible (do NOT auto-delete/blacklist). Joe reviews these, can call once
 * more to confirm the value prop, then removes them by hand. Returns the business
 * name(s), or null if no matching prospect.
 */
export async function markProspectOptedOut(phone: string): Promise<string | null> {
  const last10 = (phone || "").replace(/[^0-9]/g, "").slice(-10);
  if (last10.length < 10) return null;
  const rows = (
    await db.execute(sql`
      UPDATE forge_sites
      SET outreach_status = 'opted_out',
          denied_reason = 'Opted out of texts (replied STOP)',
          updated_at = now()
      WHERE right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${last10}
        AND status <> 'deleted'
      RETURNING business_name`)
  ).rows as Array<{ business_name: string }>;
  if (rows.length === 0) return null;

  const name = rows[0].business_name;
  await db
    .insert(activityLog)
    .values({
      actor: "twilio",
      eventType: "prospect_opted_out",
      summary: `🛑 ${name} opted out (STOP) — moved to the Declined queue (call to confirm, then remove)`,
      metadata: { detail: { phone, count: rows.length } },
    })
    .catch(() => {});
  return name;
}
