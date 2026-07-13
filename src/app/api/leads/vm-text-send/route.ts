import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { sendPendingVmText } from "@/lib/voicemail-outreach";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Timed sender for the voicemail follow-up text. We WAIT ~60s after the drop before texting, so the
 * voicemail can deposit + notify the device first. The drop arms vm_text_pending + vm_dropped_at;
 * this cron (launchd com.thinkbigjoe.vmtextsend, ~every 60s) then sends:
 *   • delivery CONFIRMED (voicemail_delivered logged) → the "did you get my voicemail?" text.
 *   • delivery FAILED, or still unconfirmed after VM_TEXT_CONFIRM_GRACE_MIN → the NEUTRAL "tried to
 *     reach you" text (never claim a voicemail we can't confirm landed).
 *   • unconfirmed but still within the grace window → WAIT (a delivery webhook may still arrive).
 * This is the fix for the "did you get my voicemail?" text going out with no voicemail behind it.
 * Race-safe via sendPendingVmText's atomic claim. Auth: Bearer CRON_SECRET.
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === expected;
}

const DELAY_SECONDS = Number(process.env.VM_TEXT_DELAY_SECONDS || 60);
// How long to give the delivery webhook to confirm before falling back to the neutral text.
const CONFIRM_GRACE_MIN = Number(process.env.VM_TEXT_CONFIRM_GRACE_MIN || 5);

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const due = (
    await db.execute(sql`
      SELECT fs.id,
             EXISTS(SELECT 1 FROM activity_log al WHERE al.event_type = 'voicemail_delivered'
                      AND (al.metadata->'detail'->>'siteId') = fs.id::text AND al.created_at >= fs.vm_dropped_at) AS delivered,
             EXISTS(SELECT 1 FROM activity_log al WHERE al.event_type = 'voicemail_failed'
                      AND (al.metadata->'detail'->>'siteId') = fs.id::text AND al.created_at >= fs.vm_dropped_at) AS failed,
             (fs.vm_dropped_at <= now() - (${String(CONFIRM_GRACE_MIN)} || ' minutes')::interval) AS graced
      FROM forge_sites fs
      WHERE fs.vm_text_pending = true
        AND fs.vm_dropped_at IS NOT NULL
        AND fs.vm_dropped_at <= now() - (${String(DELAY_SECONDS)} || ' seconds')::interval
      ORDER BY fs.vm_dropped_at ASC
      LIMIT 25`)
  ).rows as Array<{ id: number; delivered: boolean; failed: boolean; graced: boolean }>;

  let sent = 0, waiting = 0;
  for (const r of due) {
    if (r.delivered) {
      if (await sendPendingVmText(Number(r.id), "delivered").catch(() => false)) sent++;
    } else if (r.failed || r.graced) {
      // Not confirmed delivered (failed, or grace elapsed) → neutral text, never the VM-referencing one.
      if (await sendPendingVmText(Number(r.id), "failed").catch(() => false)) sent++;
    } else {
      waiting++; // unconfirmed but within grace — let the delivery webhook catch up on a later tick
    }
  }

  return NextResponse.json({ ok: true, sent, waiting, checked: due.length });
}
