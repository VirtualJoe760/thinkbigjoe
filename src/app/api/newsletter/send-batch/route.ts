import { NextResponse } from "next/server";

import { sendNewsletterBatch } from "@/lib/newsletter-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Drain a bounded batch of the newsletter send queue. Driven by launchd (com.thinkbigjoe.newslettersend)
 * every tick, and idempotent/resumable — each recipient row is marked as it's sent. Auth: Bearer
 * CRON_SECRET. `?limit=N` caps the batch (default 40). See docs/EMAIL_SCALE.md.
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") === expected;
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 40));
  try {
    const r = await sendNewsletterBatch(limit);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    // A cron endpoint that 500s with an empty body is undebuggable — surface the reason (behind the
    // CRON_SECRET auth above, so this never leaks to the public). launchd logs the body on failure.
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error("[newsletter/send-batch] failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
