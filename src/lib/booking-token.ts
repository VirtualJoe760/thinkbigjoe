import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived HMAC-signed tokens that gate the booking calendar: one is
 * issued only after a completed (Turnstile-verified) intake, so the schedule
 * is never freely exposed. Stateless — the payload carries the lead id.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h to pick a slot

export interface BookingTokenPayload {
  leadId: string;
  exp: number;
}

function secret(): string {
  const s = process.env.PAYLOAD_SECRET;
  if (!s) throw new Error("PAYLOAD_SECRET is required for booking tokens");
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(data: string): string {
  return b64url(createHmac("sha256", secret()).update(data).digest());
}

export function issueBookingToken(leadId: string): string {
  const payload: BookingTokenPayload = {
    leadId,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${sign(body)}`;
}

export function verifyBookingToken(token: string | null | undefined): BookingTokenPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as BookingTokenPayload;
    if (!payload.leadId || typeof payload.exp !== "number") return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
