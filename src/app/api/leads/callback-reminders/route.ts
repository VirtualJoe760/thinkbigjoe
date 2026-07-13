import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db, activityLog } from "@/db";
import { notifyTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Call-back reminders. When Joe scheduled a call-back for a lead who needed time to think it
 * over (scheduleCallback action), this fires a Telegram at the scheduled time so it never slips.
 * Fires once per callback (callback_reminded_at guards re-sends). Skips claimed leads (they're
 * already customers). Wired to launchd: com.thinkbigjoe.callbackreminders (~every 30 min).
 * Auth: Bearer CRON_SECRET.
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === expected;
}

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const due = (
    await db.execute(sql`
      SELECT id, business_name AS "businessName", owner_name AS "ownerName",
             phone, callback_at AS "callbackAt", callback_note AS "callbackNote"
      FROM forge_sites
      WHERE callback_at IS NOT NULL
        AND callback_reminded_at IS NULL
        AND callback_at <= now()
        AND status <> 'deleted'
        AND claimed_by_user_id IS NULL
      ORDER BY callback_at ASC
      LIMIT 25`)
  ).rows as Array<{
    id: number; businessName: string; ownerName: string | null;
    phone: string | null; callbackAt: string; callbackNote: string | null;
  }>;

  let reminded = 0;
  for (const r of due) {
    const lines = [
      `📞 Call-back due: ${r.businessName}${r.ownerName ? ` — ${r.ownerName}` : ""}`,
      r.phone ? `☎️ ${r.phone}` : "",
      r.callbackNote ? `📝 ${r.callbackNote}` : "",
      `${SITE}/command/leads`,
    ].filter(Boolean);
    await notifyTelegram(lines.join("\n"));
    await db.execute(sql`UPDATE forge_sites SET callback_reminded_at = now() WHERE id = ${r.id}`);
    await db.insert(activityLog).values({
      actor: "cron",
      eventType: "callback_due",
      summary: `📞 Call-back reminder fired for ${r.businessName}`,
      metadata: { detail: { siteId: r.id, callbackAt: r.callbackAt, note: r.callbackNote || undefined } },
    }).catch(() => {});
    reminded++;
  }

  return NextResponse.json({ ok: true, reminded, checked: due.length });
}
