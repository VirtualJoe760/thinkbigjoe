/**
 * Drop Cowboy ringless voicemail (RVM) — drops a pre-recorded voicemail straight into a
 * prospect's inbox without ringing their phone. A third outreach channel alongside SMS + email:
 * the "call" that a text then follows up. Callbacks route to the TBJ number → Ivy.
 *
 * API: POST https://api.dropcowboy.com/v1/rvm — auth via x-team-id + x-secret headers.
 * Content is a recording (recording_id) Joe recorded once in the Drop Cowboy dashboard.
 *
 * Env:
 *   DROPCOWBOY_TEAM_ID           — account team id (Settings → API)
 *   DROPCOWBOY_SECRET            — account API secret
 *   DROPCOWBOY_BRAND_ID          — registered brand GUID (Trust Center) — required, TCPA
 *   DROPCOWBOY_RECORDING_ID      — the recorded voicemail's GUID (Recordings tab)
 *   DROPCOWBOY_FORWARDING_NUMBER — E.164 number callbacks route to (the TBJ number → Ivy)
 *   DROPCOWBOY_POOL_ID           — optional private caller-id number pool
 *   DROPCOWBOY_WEBHOOK_SECRET    — token we append to callback_url + verify on delivery webhooks
 */
const API = "https://api.dropcowboy.com/v1/rvm";

const teamId = process.env.DROPCOWBOY_TEAM_ID;
const secret = process.env.DROPCOWBOY_SECRET;
const brandId = process.env.DROPCOWBOY_BRAND_ID;
const recordingId = process.env.DROPCOWBOY_RECORDING_ID;
const audioUrlEnv = process.env.DROPCOWBOY_AUDIO_URL; // alt to recording_id: a hosted MP3/WAV URL
const forwardingNumber = process.env.DROPCOWBOY_FORWARDING_NUMBER;
const poolId = process.env.DROPCOWBOY_POOL_ID;

/**
 * True once the account + a voicemail source are wired — otherwise drops are skipped (no-op).
 * The voicemail can be a Drop Cowboy recording (DROPCOWBOY_RECORDING_ID) or a hosted audio file
 * (DROPCOWBOY_AUDIO_URL). brand_id is OPTIONAL: with the Twilio (bring-your-own-carrier)
 * integration, delivery goes through Joe's own Twilio, which bypasses Drop Cowboy's Trust Center
 * brand approval. If the account still requires a brand, set DROPCOWBOY_BRAND_ID.
 */
export const isDropCowboyConfigured = Boolean(teamId && secret && (recordingId || audioUrlEnv));

/** Normalize to E.164 (default US +1). Returns undefined if it can't. */
export function toE164(raw?: string | null): string | undefined {
  const d = (raw || "").replace(/[^0-9]/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length >= 11 && d.length <= 15) return `+${d}`;
  return undefined;
}

export type DropResult =
  | { ok: true; id?: string; raw?: unknown }
  | { skipped: true; reason: string }
  | { ok: false; error: string; status?: number; raw?: unknown };

/**
 * Drop a ringless voicemail to one phone number. `foreignId` is echoed back on the delivery
 * webhook — we set it to `site-<id>` so status lands on the right lead.
 */
export async function dropVoicemail(
  phone: string,
  opts: { foreignId?: string; callbackUrl?: string; audioUrl?: string; recordingId?: string } = {},
): Promise<DropResult> {
  if (!teamId || !secret) return { skipped: true, reason: "Drop Cowboy not configured" };
  const to = toE164(phone);
  if (!to) return { skipped: true, reason: "no valid phone number" };

  // Voicemail source: a DC recording id (preferred/supported) or a hosted audio URL (per-call or
  // DROPCOWBOY_AUDIO_URL). recording_id wins when both are set.
  const rec = opts.recordingId || recordingId;
  const audioUrl = opts.audioUrl || audioUrlEnv;
  if (!rec && !audioUrl) return { skipped: true, reason: "no recording_id or audio_url set" };

  const body: Record<string, unknown> = {
    team_id: teamId,
    secret,
    phone_number: to,
    foreign_id: opts.foreignId || `tbj-${to}`,
  };
  if (rec) body.recording_id = rec;
  else body.audio_url = audioUrl;
  if (brandId) body.brand_id = brandId; // optional — omitted when Twilio BYOC bypasses brand approval
  if (forwardingNumber) body.forwarding_number = forwardingNumber;
  if (poolId) body.pool_id = poolId;
  if (opts.callbackUrl) body.callback_url = opts.callbackUrl;

  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-team-id": teamId!, "x-secret": secret! },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) {
      return { ok: false, error: String(data.message || data.error || `HTTP ${r.status}`), status: r.status, raw: data };
    }
    return { ok: true, id: String(data.rvm_id || data.id || body.foreign_id), raw: data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The delivery-status webhook URL we hand Drop Cowboy (with a shared-secret token). */
export function dropCowboyCallbackUrl(): string | undefined {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com").replace(/\/+$/, "");
  const token = process.env.DROPCOWBOY_WEBHOOK_SECRET || process.env.CRON_SECRET;
  if (!token) return `${base}/api/dropcowboy/webhook`;
  return `${base}/api/dropcowboy/webhook?token=${encodeURIComponent(token)}`;
}
