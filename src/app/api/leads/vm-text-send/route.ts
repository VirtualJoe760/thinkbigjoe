import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { sendPendingVmText } from "@/lib/voicemail-outreach";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Timed sender for the voicemail follow-up text. We deliberately WAIT ~60s after the drop before
 * texting, so the voicemail has time to deposit + notify the device (a text that beats the voicemail
 * reads as "did you get my voicemail?" with no voicemail there). The drop arms vm_text_pending +
 * vm_dropped_at; this cron (launchd com.thinkbigjoe.vmtextsend, ~every 60s) sends the text once
 * ≥ VM_TEXT_DELAY_SECONDS have passed. Text choice: if a delivery webhook logged voicemail_failed,
 * use the non-VM text (they got no voicemail); otherwise the VM-referencing text. Race-safe via
 * sendPendingVmText's atomic claim. Auth: Bearer CRON_SECRET.
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === expected;
}

const DELAY_SECONDS = Number(process.env.VM_TEXT_DELAY_SECONDS || 60);

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Leads whose drop is ≥ DELAY_SECONDS old and still awaiting the text. `failed` reflects whether a
  // Drop Cowboy delivery webhook already reported this drop as failed (→ send the non-VM variant).
  const due = (
    await db.execute(sql`
      SELECT fs.id,
             EXISTS(
               SELECT 1 FROM activity_log al
               WHERE al.event_type = 'voicemail_failed'
                 AND (al.metadata->'detail'->>'siteId') = fs.id::text
                 AND al.created_at >= fs.vm_dropped_at
             ) AS failed
      FROM forge_sites fs
      WHERE fs.vm_text_pending = true
        AND fs.vm_dropped_at IS NOT NULL
        AND fs.vm_dropped_at <= now() - (${String(DELAY_SECONDS)} || ' seconds')::interval
      ORDER BY fs.vm_dropped_at ASC
      LIMIT 25`)
  ).rows as Array<{ id: number; failed: boolean }>;

  let sent = 0;
  for (const r of due) {
    const ok = await sendPendingVmText(Number(r.id), r.failed ? "failed" : "delivered").catch(() => false);
    if (ok) sent++;
  }

  return NextResponse.json({ ok: true, sent, checked: due.length });
}
