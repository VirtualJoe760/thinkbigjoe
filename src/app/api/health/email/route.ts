import { NextResponse } from "next/server";

import { verifyEmailTransport, sendNotificationEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * Email pipeline health check. Confirms the SMTP transport can connect +
 * authenticate with the configured credentials — the password-reset and welcome
 * flows swallow send errors (to avoid leaking account existence), so a broken
 * SMTP cred is otherwise invisible until a customer silently never gets their
 * reset link. Bearer-protected with CRON_SECRET (same pattern as api/forge/*).
 *
 *   GET /api/health/email                       → verify() only, sends nothing
 *   GET /api/health/email?to=you@example.com    → also sends a real test email
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === expected;
}

export async function GET(req: Request) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const verify = await verifyEmailTransport();
  if (!verify.configured) {
    return NextResponse.json(
      { ok: false, configured: false, message: "SMTP env vars are not set in this environment." },
      { status: 503 },
    );
  }
  if (!verify.ok) {
    return NextResponse.json(
      { ok: false, configured: true, host: verify.host, from: verify.from, error: verify.error },
      { status: 502 },
    );
  }

  // Optional live send so we can confirm end-to-end delivery, not just auth.
  const to = new URL(req.url).searchParams.get("to");
  let sent: unknown = undefined;
  if (to) {
    const res = await sendNotificationEmail({
      to,
      subject: "ThinkBigJoe — email pipeline test ✅",
      heading: "Email is working",
      message:
        "This is a health-check test of the ThinkBigJoe transactional email pipeline — the same path the Forgot-password reset link uses. If you received this, resets will deliver.",
    });
    sent = "error" in res ? { ok: false, error: String(res.error) } : { ok: true, to };
  }

  return NextResponse.json({ ok: true, configured: true, host: verify.host, from: verify.from, sent });
}
