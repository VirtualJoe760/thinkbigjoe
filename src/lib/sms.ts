import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio SMS for ThinkBigJoe. Sends through the shared A2P-registered Messaging
 * Service (the `jsardella` LLC brand's verified "Low Volume Mixed" campaign — the
 * same one chatRealty uses, allowed because both businesses are one legal entity).
 *
 * No SDK — plain REST via fetch, mirroring src/lib/telegram.ts. Every export
 * no-ops (with a warning) until the Twilio env vars are set, so the app never
 * breaks in environments without SMS configured.
 *
 * Env:
 *   TWILIO_ACCOUNT_SID          — starts "AC…"
 *   TWILIO_AUTH_TOKEN           — secret, also used to verify inbound webhooks
 *   TWILIO_MESSAGING_SERVICE_SID— "MG…" (the Messaging Service the campaign owns)
 *   SMS_FORWARD_TO              — where inbound replies get forwarded (Joe's Google Voice)
 */
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

/** True when the send credentials are present (account + token + messaging service). */
export const isSmsConfigured = Boolean(accountSid && authToken && messagingServiceSid);

/** Where inbound texts are forwarded (Joe's Google Voice), in E.164. */
export function smsForwardTo(): string | undefined {
  return normalizePhone(process.env.SMS_FORWARD_TO);
}

/**
 * Best-effort E.164 normalization for US numbers. Twilio wants "+1XXXXXXXXXX".
 * Passes through anything already starting with "+".
 */
export function normalizePhone(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("+")) return trimmed.replace(/[^\d+]/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : undefined;
}

type SendResult =
  | { skipped: true }
  | { ok: true; sid: string }
  | { ok: false; error: string; status?: number };

/**
 * Send an SMS through the Messaging Service. STOP/HELP handling and number
 * selection are the Messaging Service's job (Advanced Opt-Out is enabled on the
 * campaign), so callers only supply the recipient + body.
 */
export async function sendSms(to: string, body: string): Promise<SendResult> {
  const dest = normalizePhone(to);
  if (!isSmsConfigured || !dest) {
    console.warn("[sms] not configured — skipping send to", to);
    return { skipped: true };
  }
  const text = body.trim();
  if (!text) return { ok: false, error: "empty body" };

  const form = new URLSearchParams({
    MessagingServiceSid: messagingServiceSid!,
    To: dest,
    Body: text.slice(0, 1600), // Twilio caps a single API request at 1600 chars
  });

  try {
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );
    const data = (await r.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
      code?: number;
    };
    if (!r.ok) {
      const error = data.message || `HTTP ${r.status}`;
      console.error("[sms] send failed:", error);
      return { ok: false, error, status: r.status };
    }
    return { ok: true, sid: data.sid || "" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[sms] send error:", error);
    return { ok: false, error };
  }
}

/**
 * Carrier opt-out keywords. Twilio's Messaging Service already suppresses these
 * automatically; we only detect them so an inbound STOP is labeled (not forwarded
 * as if it were a normal reply Joe should answer).
 */
const OPT_OUT = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i;
export function isOptOut(body: string): boolean {
  return OPT_OUT.test(body || "");
}

/**
 * Two-way relay uses one Google Voice number for every conversation, so all
 * forwards land in a single GV thread. A short per-conversation code (the
 * sms_conversations row id in base36, shown as `#a3`) lets Joe target a specific
 * lead when he replies. A reply with no code defaults to the most-recent texter.
 */
export function encodeThreadCode(id: number): string {
  return "#" + id.toString(36);
}

/** Parse a leading `#code` off Joe's reply → { id, rest }, or null if absent. */
export function parseThreadCode(text: string): { id: number; rest: string } | null {
  const m = (text || "").match(/^\s*#([0-9a-z]+)\b[\s,:-]*/i);
  if (!m) return null;
  const id = parseInt(m[1], 36);
  if (!Number.isFinite(id) || id <= 0) return null;
  return { id, rest: text.slice(m[0].length).trim() };
}

/**
 * Verify Twilio's X-Twilio-Signature on an inbound webhook.
 *
 * Twilio signs base64(HMAC-SHA1(authToken, url + concat(sorted "key"+"value")))
 * for form-encoded POSTs. `url` must be the exact public URL Twilio is configured
 * to call (scheme + host + path, including any query string).
 *
 * Returns true when signing isn't enforceable (no auth token) so local/dev
 * doesn't hard-fail, but production always has the token set.
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  if (!authToken) return true; // nothing to verify against
  if (!signature) return false;

  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const expected = createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
