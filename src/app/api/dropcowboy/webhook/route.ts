import { NextResponse } from "next/server";

import { db, activityLog } from "@/db";
import { notifyTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Drop Cowboy delivery-status webhook. We hand Drop Cowboy this URL (with a `?token=` shared
 * secret) as the RVM `callback_url`; it POSTs back the delivery result. We log it to the lead's
 * timeline (foreign_id = `site-<id>`) and ping Telegram on failures/DNC so a bad number surfaces.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const expected = process.env.DROPCOWBOY_WEBHOOK_SECRET || process.env.CRON_SECRET;
  if (expected && token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const foreignId = String(payload.foreign_id || payload.foreignId || "");
  const status = String(payload.status || payload.result || payload.event || "unknown").toLowerCase();
  const phone = String(payload.phone_number || payload.phone || "");
  const siteId = /^site-(\d+)$/.exec(foreignId)?.[1];

  const delivered = /deliver|complete|success/.test(status);
  const failed = /fail|error|reject|dnc|invalid|carrier/.test(status);

  try {
    await db.insert(activityLog).values({
      actor: "dropcowboy",
      eventType: failed ? "voicemail_failed" : delivered ? "voicemail_delivered" : "voicemail_status",
      summary: `📞 Voicemail ${status}${phone ? ` → ${phone}` : ""}`,
      metadata: {
        detail: { siteId: siteId ? Number(siteId) : null, note: `Voicemail ${status}`, phone, status },
        raw: payload,
      },
    });
  } catch (err) {
    console.error("[dropcowboy:webhook] log failed:", err);
  }

  if (failed) {
    await notifyTelegram(`📞❌ Voicemail ${status}${phone ? ` — ${phone}` : ""} (Drop Cowboy).`).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "dropcowboy/webhook" });
}
