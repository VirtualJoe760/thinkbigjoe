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

// A SOFT, internal opt-out: a friendly "no thanks" we honor ourselves so the prospect never has to
// text the carrier keyword STOP (which Twilio records as a hard opt-out and dings sender metrics).
// We advertise THIS in our outreach copy; STOP still works as the legally-required backstop.
//
// This matches the WHOLE message, not its start — and that distinction is the point. An explicit,
// standalone "No" / "No thanks" ends the conversation. Anything with more in it is a CONVERSATION,
// even when it sounds like a brush-off ("I don't need one but thank you", "no thanks, what's the
// catch?"). Someone who typed a sentence is engaged; that's the agent's job, not a stop sign.
// Leading/trailing quotes and punctuation are tolerated because people literally copy the
// "reply 'No thanks'" line out of our own outreach copy, quotes and all.
const EDGE = `[\\s'"“”‘’.,!?-]*`;
const SOFT_OPT_OUT = new RegExp(
  `^${EDGE}(no|nope|nah|no[,\\s]*thanks?|no[,\\s]*thank\\s*you|no[,\\s]*thx|not\\s+interested|remove\\s+me|unsubscribe\\s+me|take\\s+me\\s+off(\\s+your\\s+list)?|lose\\s+my\\s+number|(do\\s*n[o']?t|stop)\\s+(contact|text|call)(ing)?\\s*(me)?)${EDGE}$`,
  "i",
);
export function isSoftOptOut(body: string): boolean {
  return SOFT_OPT_OUT.test(body || "");
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

/**
 * Is this number able to receive a text?
 *
 * Twilio's send API returns 201 "queued" for a landline exactly as it does for a mobile — delivery
 * fails later and asynchronously, so `sendSms` reporting ok is NOT evidence anyone will ever see the
 * message. That is fine for a fire-and-forget notification and actively harmful for a one-time code,
 * where the caller is on the phone waiting for something that will never arrive.
 *
 * Returns null when we genuinely don't know (Lookup unconfigured, rate-limited, or erroring). Callers
 * must treat null as "proceed, but be ready to fall back" rather than as a landline — refusing to
 * text on an inconclusive lookup would break onboarding for everyone during a Twilio blip.
 */
export async function canReceiveSms(raw?: string | null): Promise<boolean | null> {
  const dest = normalizePhone(raw);
  if (!dest || !accountSid || !authToken) return null;
  try {
    const res = await fetch(
      `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(dest)}?Fields=line_type_intelligence`,
      {
        headers: { Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64") },
        signal: AbortSignal.timeout(4000), // a caller is waiting; don't hang the call on this
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { line_type_intelligence?: { type?: string } };
    const type = data.line_type_intelligence?.type;
    if (!type) return null;
    // voip is included deliberately: plenty of small businesses run RingCentral/Grasshopper and
    // those do receive SMS. Only the types that definitively cannot are excluded.
    return !["landline", "fixedVoip"].includes(type);
  } catch (err) {
    console.error("[sms] lookup failed for line type:", err);
    return null;
  }
}
