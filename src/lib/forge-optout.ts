import { eq, sql } from "drizzle-orm";

import { db, forgeSites, forgeBlacklist, activityLog } from "@/db";

const slugify = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
function hostOf(u: string): string | null {
  try {
    return u ? new URL(u.startsWith("http") ? u : `https://${u}`).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

/**
 * A prospect texted STOP. Move them out of the leads pipeline (status → denied,
 * which the leads/call-room queries exclude) and blacklist the business so the
 * prospector never re-scrapes or re-adds it. Matches forge_sites by the last 10
 * digits of the opting-out number. Returns the business name(s) denied, or null
 * if no matching prospect was found.
 */
export async function denyProspectByPhoneOptOut(phone: string): Promise<string | null> {
  const last10 = (phone || "").replace(/[^0-9]/g, "").slice(-10);
  if (last10.length < 10) return null;

  const rows = (
    await db.execute(sql`
      SELECT id, business_name AS "businessName", city, existing_website_url AS "existingWebsiteUrl"
      FROM forge_sites
      WHERE right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${last10}
        AND status <> 'deleted'
        AND status <> 'denied'`)
  ).rows as Array<{ id: number; businessName: string; city: string | null; existingWebsiteUrl: string | null }>;

  if (rows.length === 0) return null;

  let name: string | null = null;
  for (const s of rows) {
    await db
      .update(forgeSites)
      .set({ status: "denied", deniedReason: "Opted out of texts (replied STOP)", updatedAt: sql`now()` })
      .where(eq(forgeSites.id, s.id))
      .catch(() => {});
    await db
      .insert(forgeBlacklist)
      .values({
        normKey: `${slugify(s.businessName)}|${slugify(s.city || "")}`,
        businessName: s.businessName,
        city: s.city || null,
        domain: hostOf(s.existingWebsiteUrl || ""),
        reason: "Opted out of texts (STOP)",
      })
      .onConflictDoNothing()
      .catch(() => {});
    name = name || s.businessName;
  }

  await db
    .insert(activityLog)
    .values({
      actor: "twilio",
      eventType: "prospect_opted_out",
      summary: `🚫 ${name || phone} opted out (STOP) — moved to denied + blacklisted`,
      metadata: { detail: { phone, deniedCount: rows.length } },
    })
    .catch(() => {});

  return name;
}
