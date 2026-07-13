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
const forwardingNumber = process.env.DROPCOWBOY_FORWARDING_NUMBER;
const poolId = process.env.DROPCOWBOY_POOL_ID;

/** True once the account + brand + recording are wired — otherwise drops are skipped (no-op). */
export const isDropCowboyConfigured = Boolean(teamId && secret && brandId && recordingId);

/** Normalize to E.164 (default US +1). Returns undefined if it can't. */
export function toE164(raw?: string | null): string | undefined {
  const d = (raw || "").replace(/[^0-9]/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length >= 11 && d.length <= 15) return `+${d}`;
  return undefined;
}

export type DropResult =
  | { ok: true; id?: string }
  | { skipped: true; reason: string }
  | { ok: false; error: string };

/**
 * Drop a ringless voicemail to one phone number. `foreignId` is echoed back on the delivery
 * webhook — we set it to `site-<id>` so status lands on the right lead.
 */
export async function dropVoicemail(
  phone: string,
  opts: { foreignId?: string; callbackUrl?: string } = {},
): Promise<DropResult> {
  if (!isDropCowboyConfigured) return { skipped: true, reason: "Drop Cowboy not configured" };
  const to = toE164(phone);
  if (!to) return { skipped: true, reason: "no valid phone number" };

  const body: Record<string, unknown> = {
    team_id: teamId,
    secret,
    brand_id: brandId,
    recording_id: recordingId,
    phone_number: to,
    foreign_id: opts.foreignId || `tbj-${to}`,
  };
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
      return { ok: false, error: String(data.message || data.error || `HTTP ${r.status}`) };
    }
    return { ok: true, id: String(data.rvm_id || data.id || body.foreign_id) };
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
