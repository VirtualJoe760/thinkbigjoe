/**
 * TENANT RESOLUTION for the customer-facing voice receptionist.
 *
 * The whole multi-tenant design turns on one idea: **the number that was DIALLED identifies the
 * business.** Every Retell payload carries `call.to_number`; we map it through `voice_lines` to a
 * site. That's what lets a single shared agent answer for every customer — no per-customer agents,
 * no per-customer webhook URLs, nothing hardcoded to one business.
 *
 * Contrast with `src/lib/voice-booking.ts`, which reads `call.from_number` (the CALLER) because
 * Ivy's job is recognising TBJ's own prospects. Different question, different field.
 *
 * Note this deliberately does NOT accept a business identifier as a tool argument — a caller could
 * otherwise talk the agent into acting for a different business.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db, forgeSites, voiceLines } from "@/db";
import { normalizePhone } from "@/lib/sms";

/**
 * What the portal collects at /portal/receptionist. The prose fields are the original free-text
 * shape (good prompt material, unparseable for routing); the structured fields are what automation
 * needs. Both are optional here so a half-filled config still resolves — the caller decides what
 * it can do without them.
 */
export type VoiceConfig = {
  // prose — fed to the prompt as-is
  greeting?: string;
  services?: string;
  hours?: string;
  booking?: string;
  faqs?: string;
  doNot?: string;
  emergencyDefinition?: string;
  serviceArea?: string;
  // structured — required for automation
  escalationPhone?: string; // E.164, where emergencies transfer
  notifyPhone?: string; // E.164, where the message text goes
  notifyEmail?: string;
  bookingMode?: "message" | "book";
  /** Legacy free-text ("text 480-555-1234, or email me") — parsed as a fallback only. */
  forwardTo?: string;
};

export type VoiceTenant = {
  siteId: number;
  slug: string;
  businessName: string;
  timezone: string;
  ownerUserId: string | null;
  /** The number we provisioned, i.e. the one the caller reached. */
  lineNumber: string;
  lineStatus: string;
  config: VoiceConfig;
  /** Where a message notification should go, already normalized. Undefined = we can't notify. */
  notifyTo?: string;
  /** Where an emergency transfers, already normalized. Undefined = transfers unavailable. */
  escalateTo?: string;
  /** Booking needs a claimed site AND a connected calendar; prose config can't grant it. */
  bookingEnabled: boolean;
};

/** The number that was DIALLED, from a Retell webhook payload. */
export function calledNumber(body: unknown): string | undefined {
  const call = ((body ?? {}) as Record<string, unknown>).call as Record<string, unknown> | undefined;
  // Retell has used both a nested `call` object and a flat body depending on the event.
  const raw = call?.to_number ?? (body as Record<string, unknown> | undefined)?.to_number;
  return typeof raw === "string" && raw ? normalizePhone(raw) : undefined;
}

/** First plausible phone number in a free-text string — last resort for legacy `forwardTo`. */
function phoneFromProse(s?: string): string | undefined {
  if (!s) return undefined;
  const m = s.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  return m ? normalizePhone(m[0]) : undefined;
}

/**
 * The REAL routing destinations a config produces — structured keys first, then a phone parsed out
 * of the legacy free-text `forwardTo`, notify falling back to escalate. Exported so display
 * surfaces (the Knowledge page) show EXACTLY what runtime will dial/text: a page that renders the
 * raw strings can claim "messages text to: email me at joe@…" while runtime has nowhere to send —
 * the precise lie a trust surface can't tell. `undefined` means genuinely unroutable.
 */
export function deriveRouting(config: VoiceConfig): { escalateTo?: string; notifyTo?: string } {
  const escalateTo = normalizePhone(config.escalationPhone) ?? phoneFromProse(config.forwardTo);
  const notifyTo = normalizePhone(config.notifyPhone) ?? escalateTo;
  return { escalateTo, notifyTo };
}

function parseConfig(raw: unknown): VoiceConfig {
  if (!raw || typeof raw !== "object") return {};
  return raw as VoiceConfig;
}

/**
 * Resolve the business behind a provisioned number.
 *
 * Lines that are `paused` or `released` deliberately do NOT resolve — a cancelled customer's number
 * should stop answering as them rather than answer as a stranger.
 */
export async function tenantByNumber(e164?: string): Promise<VoiceTenant | null> {
  const num = normalizePhone(e164);
  if (!num) return null;

  const [row] = await db
    .select({
      siteId: forgeSites.id,
      slug: forgeSites.slug,
      businessName: forgeSites.businessName,
      timezone: forgeSites.bookingTimezone,
      ownerUserId: forgeSites.claimedByUserId,
      config: forgeSites.receptionistConfig,
      lineNumber: voiceLines.phoneNumber,
      lineStatus: voiceLines.status,
    })
    .from(voiceLines)
    .innerJoin(forgeSites, eq(voiceLines.siteId, forgeSites.id))
    .where(and(eq(voiceLines.phoneNumber, num), inArray(voiceLines.status, ["active", "provisioning"])))
    .limit(1);

  if (!row) return null;

  const config = parseConfig(row.config);
  const { escalateTo, notifyTo } = deriveRouting(config);

  return {
    siteId: row.siteId,
    slug: row.slug,
    businessName: row.businessName,
    timezone: row.timezone,
    ownerUserId: row.ownerUserId,
    lineNumber: row.lineNumber,
    lineStatus: row.lineStatus,
    config,
    notifyTo,
    escalateTo,
    // Booking requires an owner (for their Google token). Prose alone can't turn it on, and the
    // per-tenant booking routes don't exist yet — see VOICE_TENANCY_SPEC stage 4.
    bookingEnabled: config.bookingMode === "book" && Boolean(row.ownerUserId),
  };
}

/** Resolve the business from any Retell payload. Null when the number isn't ours or is inactive. */
export async function siteFromCall(body: unknown): Promise<VoiceTenant | null> {
  return tenantByNumber(calledNumber(body));
}
