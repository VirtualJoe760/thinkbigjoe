import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { syncCrmContactsToGoogle } from "@/lib/contact-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Push TBJ's ENGAGED contacts (replied / booked / clients) into the owner's Google Contacts, under a
 * dedicated group so they stay in their own section. Reads the `contacts` table (source of truth) via
 * syncCrmContactsToGoogle — the same code the Settings "Sync now" button runs. Deduped + idempotent.
 * Wired to launchd: com.thinkbigjoe.gcontacts. Auth: Bearer CRON_SECRET.
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") === expected;
}

const OWNER_EMAIL = process.env.TBJ_OWNER_EMAIL || "josephsardella@gmail.com";

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Which account's Google Contacts to sync into: the configured owner if connected, else whichever
  // account has connected Contacts (realistically just Joe's admin account).
  const [owner] = (
    await db.execute(sql`
      SELECT gc.user_id FROM google_connections gc
      JOIN better_auth."user" u ON u.id = gc.user_id
      WHERE gc.contacts_connected = true
      ORDER BY (lower(u.email) = ${OWNER_EMAIL.toLowerCase()}) DESC, gc.created_at ASC
      LIMIT 1`)
  ).rows as Array<{ user_id: string }>;
  if (!owner) {
    return NextResponse.json({ ok: false, message: "Connect Google Contacts in Settings first." });
  }

  const r = await syncCrmContactsToGoogle(owner.user_id);
  return NextResponse.json(r);
}
