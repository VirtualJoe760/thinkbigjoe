import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db, activityLog } from "@/db";
import { getConnection, getValidAccessToken, ensureContactGroup, createGoogleContact, googleContactExists } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Push TBJ leads into Joe's OWN Google Contacts, under a dedicated "TBJ Leads" group so they stay in
 * their own section. Uses Joe's per-user Google connection (he connects his Google on /portal/calendar,
 * granting the Contacts scope). Batched + deduped (skips numbers/emails already in his contacts, and
 * leads already logged as synced). Wired to launchd: com.thinkbigjoe.gcontacts. Auth: Bearer CRON_SECRET.
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") === expected;
}

const OWNER_EMAIL = process.env.TBJ_OWNER_EMAIL || "joeysardella@gmail.com";
const GROUP_NAME = process.env.TBJ_CONTACTS_GROUP || "TBJ Leads";

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [owner] = (await db.execute(sql`SELECT id FROM better_auth."user" WHERE lower(email) = ${OWNER_EMAIL.toLowerCase()} LIMIT 1`)).rows as Array<{ id: string }>;
  if (!owner) return NextResponse.json({ ok: false, message: `No account for ${OWNER_EMAIL}.` });

  const conn = await getConnection(owner.id);
  if (!conn?.contactsConnected) return NextResponse.json({ ok: false, message: "Connect your Google (with Contacts) on /portal/calendar first." });
  const token = await getValidAccessToken(conn);
  if (!token) return NextResponse.json({ ok: false, message: "Google connection expired — reconnect on /portal/calendar." });

  const group = await ensureContactGroup(token, GROUP_NAME);

  const leads = (
    await db.execute(sql`
      SELECT id, business_name AS "businessName", owner_name AS "ownerName", phone, email, city
      FROM forge_sites fs
      WHERE marketing_approved_at IS NOT NULL
        AND status <> 'deleted'
        AND (phone IS NOT NULL OR email IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM activity_log al
          WHERE al.event_type = 'google_contact_synced' AND (al.metadata->'detail'->>'siteId') = fs.id::text
        )
      ORDER BY marketing_approved_at DESC
      LIMIT 50`)
  ).rows as Array<{ id: number; businessName: string; ownerName: string | null; phone: string | null; email: string | null; city: string | null }>;

  let synced = 0;
  for (const l of leads) {
    if (await googleContactExists(token, l.phone, l.email)) {
      // Already in his contacts — mark synced so we don't re-check it every run.
      await db.insert(activityLog).values({ actor: "cron", eventType: "google_contact_synced", summary: `Google contact exists — ${l.businessName}`, metadata: { detail: { siteId: l.id, existed: true } } }).catch(() => {});
      continue;
    }
    const ok = await createGoogleContact(token, {
      name: l.businessName + (l.ownerName ? ` (${l.ownerName})` : ""),
      email: l.email,
      phone: l.phone,
      notes: `TBJ lead${l.city ? ` · ${l.city}` : ""}`,
    }, group);
    if (ok) {
      synced++;
      await db.insert(activityLog).values({ actor: "cron", eventType: "google_contact_synced", summary: `📇 Added ${l.businessName} to Google Contacts (${GROUP_NAME})`, metadata: { detail: { siteId: l.id } } }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, group: GROUP_NAME, checked: leads.length, synced });
}
