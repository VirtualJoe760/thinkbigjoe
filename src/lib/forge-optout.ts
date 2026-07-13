import { sql } from "drizzle-orm";

import { db, activityLog } from "@/db";

/** Resolve a forge_sites prospect by the last 10 digits of a phone number. */
export async function findProspectByPhone(phone: string): Promise<
  { id: number; businessName: string; claimCode: string | null; city: string | null; slug: string | null; liveUrl: string | null; aiPaused: boolean; outreachStatus: string | null } | null
> {
  const last10 = (phone || "").replace(/[^0-9]/g, "").slice(-10);
  if (last10.length < 10) return null;
  const rows = (
    await db.execute(sql`
      SELECT id, business_name AS "businessName", claim_code AS "claimCode", city, slug, live_url AS "liveUrl", ai_paused AS "aiPaused", outreach_status AS "outreachStatus"
      FROM forge_sites
      WHERE right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${last10}
        AND status <> 'deleted'
      ORDER BY (status = 'denied') ASC, updated_at DESC
      LIMIT 1`)
  ).rows as Array<{ id: number; businessName: string; claimCode: string | null; city: string | null; slug: string | null; liveUrl: string | null; aiPaused: boolean; outreachStatus: string | null }>;
  return rows[0] ?? null;
}

/**
 * A prospect opted out — either the hard carrier keyword STOP, or our soft internal "No thanks".
 * Mark them OPTED OUT — suppressed from further texting and moved to the Declined queue — but keep
 * them visible (do NOT auto-delete/blacklist). Joe reviews these, can call once more, then removes
 * by hand. `via` distinguishes the channel for the record ("stop" vs "soft"); it does NOT change the
 * suppression (both fully stop outreach). Returns the business name, or null if no matching prospect.
 */
export async function markProspectOptedOut(
  phone: string,
  opts: { via?: "stop" | "soft" } = {},
): Promise<string | null> {
  const last10 = (phone || "").replace(/[^0-9]/g, "").slice(-10);
  if (last10.length < 10) return null;
  const soft = opts.via === "soft";
  const reason = soft ? "Opted out of texts (replied “No thanks”)" : "Opted out of texts (replied STOP)";
  const rows = (
    await db.execute(sql`
      UPDATE forge_sites
      SET outreach_status = 'opted_out',
          lead_stage = 'declined',
          declined_at = COALESCE(declined_at, now()),
          denied_reason = ${reason},
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
      summary: `🛑 ${name} opted out (${soft ? "“No thanks”" : "STOP"}) — moved to the Declined queue (call to confirm, then remove)`,
      metadata: { detail: { phone, count: rows.length, via: soft ? "soft" : "stop" } },
    })
    .catch(() => {});
  return name;
}
