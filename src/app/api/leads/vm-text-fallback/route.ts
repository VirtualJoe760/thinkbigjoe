import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { sendPendingVmText } from "@/lib/voicemail-outreach";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Fallback sweep for the delivery-gated voicemail follow-up text. Normally the Drop Cowboy webhook
 * (delivered/failed) sends the text. But ~30% of drops never fire a delivery webhook at all — this
 * catches those: any lead still vm_text_pending ~8+ min after the drop gets the non-VM follow-up
 * text so no one is left with zero touches. Race-safe with the webhook (sendPendingVmText claims
 * the pending flag atomically). Wired to launchd: com.thinkbigjoe.vmtextfallback (~every 5 min).
 * Auth: Bearer CRON_SECRET.
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === expected;
}

const GRACE_MINUTES = Number(process.env.VM_TEXT_FALLBACK_MINUTES || 8);

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const stale = (
    await db.execute(sql`
      SELECT id FROM forge_sites
      WHERE vm_text_pending = true
        AND vm_dropped_at IS NOT NULL
        AND vm_dropped_at < now() - (${String(GRACE_MINUTES)} || ' minutes')::interval
      ORDER BY vm_dropped_at ASC
      LIMIT 25`)
  ).rows as Array<{ id: number }>;

  let sent = 0;
  for (const s of stale) {
    const ok = await sendPendingVmText(Number(s.id), "fallback").catch(() => false);
    if (ok) sent++;
  }

  return NextResponse.json({ ok: true, sent, checked: stale.length });
}
