/**
 * Sync TBJ's CRM contacts into the owner's Google Contacts — the "same fashion" as the per-booking
 * Website Leads write, but for the whole engaged contact list, ongoing.
 *
 * Scope by design (Joe's call): only contacts we've genuinely ENGAGED — anyone who replied (email or
 * text), booked a call, or became a client. Cold, never-contacted prospects are deliberately kept out
 * of the owner's phone. Deduped against Google and against prior syncs (activity_log), grouped so they
 * stay in their own section.
 *
 * Reads the `contacts` table (the source of truth — see docs/CONTACTS.md), not the legacy
 * forge_sites columns. Used by both the cron route and the Settings "Sync now" action.
 */
import { sql } from "drizzle-orm";

import { db, activityLog } from "@/db";
import {
  createGoogleContact,
  ensureContactGroup,
  getConnection,
  getValidAccessToken,
  googleContactExists,
} from "@/lib/google-oauth";

export const DEFAULT_GROUP = process.env.TBJ_CONTACTS_GROUP || "TBJ Leads";

type Row = {
  id: number;
  businessName: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
};

/**
 * Engaged, not-yet-synced contacts: replied (forge_replies / sms_inbound), booked
 * (booking_made / site_booking_made), or a client. Excludes internal sites (TBJ itself) and
 * do-not-contact. `limit` caps a single run so a manual sync stays snappy.
 */
async function engagedContacts(limit: number): Promise<Row[]> {
  const res = await db.execute(sql`
    SELECT ct.id, ct.business_name AS "businessName", ct.name, ct.email, ct.phone, ct.city
    FROM contacts ct
    LEFT JOIN forge_sites fs ON fs.id = ct.site_id
    WHERE (ct.email IS NOT NULL OR ct.phone IS NOT NULL)
      AND ct.do_not_contact = false
      AND coalesce(fs.is_internal, false) = false
      AND (
        ct.lifecycle = 'client'
        OR EXISTS (SELECT 1 FROM forge_replies fr WHERE fr.site_id = ct.site_id)
        OR EXISTS (SELECT 1 FROM activity_log al
                    WHERE al.event_type IN ('sms_inbound','booking_made','site_booking_made')
                      AND (al.metadata->'detail'->>'siteId') = ct.site_id::text)
      )
      AND NOT EXISTS (
        SELECT 1 FROM activity_log al
        WHERE al.event_type = 'google_contact_synced'
          AND (al.metadata->'detail'->>'contactId') = ct.id::text
      )
    ORDER BY ct.updated_at DESC
    LIMIT ${limit}`);
  return res.rows as Row[];
}

export type SyncResult =
  | { ok: true; group: string; checked: number; added: number; alreadyThere: number }
  | { ok: false; reason: "not_connected" | "expired"; message: string };

/**
 * Push the engaged contacts into `userId`'s Google Contacts. Idempotent: a contact already in
 * Google (matched by phone/email) is marked synced and skipped; every attempt is logged by
 * contactId so a later run never re-adds it.
 */
export async function syncCrmContactsToGoogle(
  userId: string,
  opts: { group?: string; limit?: number } = {},
): Promise<SyncResult> {
  const group = opts.group || DEFAULT_GROUP;
  const limit = opts.limit ?? 50;

  const conn = await getConnection(userId);
  if (!conn?.contactsConnected) {
    return { ok: false, reason: "not_connected", message: "Connect Google Contacts in Settings first." };
  }
  const token = await getValidAccessToken(conn);
  if (!token) {
    return { ok: false, reason: "expired", message: "Your Google connection expired — reconnect in Settings." };
  }

  const groupResource = await ensureContactGroup(token, group);
  const rows = await engagedContacts(limit);

  let added = 0;
  let alreadyThere = 0;
  for (const r of rows) {
    const label = (r.businessName || r.name || "Contact") + (r.businessName && r.name ? ` (${r.name})` : "");
    const markSynced = (existed: boolean) =>
      db
        .insert(activityLog)
        .values({
          actor: "contact-sync",
          eventType: "google_contact_synced",
          summary: existed ? `Already in Google — ${label}` : `📇 Added ${label} to Google Contacts (${group})`,
          metadata: { detail: { contactId: r.id, existed } },
        })
        .catch(() => {});

    if (await googleContactExists(token, r.phone, r.email)) {
      alreadyThere++;
      await markSynced(true);
      continue;
    }
    const ok = await createGoogleContact(
      token,
      { name: label, email: r.email, phone: r.phone, notes: `TBJ contact${r.city ? ` · ${r.city}` : ""}` },
      groupResource,
    );
    if (ok) {
      added++;
      await markSynced(false);
    }
  }

  return { ok: true, group, checked: rows.length, added, alreadyThere };
}
