// Shared helpers for the Retell voice-agent booking webhooks (/api/voice/*).
import { BOOKING_TIMEZONE, ADVANCE_BOOKING_DAYS, getAvailableSlots, AGENTIC_HOURS, type DayHours } from "@/lib/gcal";

/** Booking types the receptionist can create. Both "regular" and "agentic" ($999) use the Mon–Fri 10–5 PT window. */
export type CallType = "regular" | "agentic";
export function hoursForType(type?: string): DayHours | undefined {
  return type === "agentic" ? AGENTIC_HOURS : undefined;
}

export type SpokenSlot = { label: string; start: string; end: string };

/** Format an ISO time as a phone-friendly spoken label, e.g. "Monday, July 7 at 11:00 AM Pacific". */
export function spokenLabel(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleString("en-US", {
    timeZone: BOOKING_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const time = d.toLocaleString("en-US", {
    timeZone: BOOKING_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} at ${time} Pacific`;
}

/** YYYY-MM-DD for a Date in the booking timezone (so "today" is Pacific-correct). */
function dateStrInZone(d: Date): string {
  // en-CA renders as YYYY-MM-DD.
  return d.toLocaleDateString("en-CA", { timeZone: BOOKING_TIMEZONE });
}

/**
 * The next `limit` open slots across upcoming business days (Retell can offer these to the caller).
 * Scans forward up to the advance-booking window.
 */
export async function getUpcomingSlots(limit = 5, hoursOverride?: DayHours): Promise<SpokenSlot[]> {
  const out: SpokenSlot[] = [];
  const now = Date.now();
  for (let i = 0; i <= ADVANCE_BOOKING_DAYS && out.length < limit; i++) {
    const dateStr = dateStrInZone(new Date(now + i * 24 * 60 * 60 * 1000));
    const slots = await getAvailableSlots(dateStr, undefined, hoursOverride);
    for (const s of slots) {
      out.push({ label: spokenLabel(s.start), start: s.start, end: s.end });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Open slots for one specific date (YYYY-MM-DD), formatted for speech. */
export async function getSlotsForDate(dateStr: string, hoursOverride?: DayHours): Promise<SpokenSlot[]> {
  const slots = await getAvailableSlots(dateStr, undefined, hoursOverride);
  return slots.map((s) => ({ label: spokenLabel(s.start), start: s.start, end: s.end }));
}

/**
 * Retell posts custom-function calls in a wrapper. Pull the arguments object out of the
 * various shapes Retell has used: { args }, { arguments } (object or JSON string).
 */
export function parseRetellArgs(body: unknown): Record<string, unknown> {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = b.args ?? b.arguments ?? b;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (raw as Record<string, unknown>) ?? {};
}

/** Best-effort caller phone from Retell's call payload. */
export function callerPhone(body: unknown): string | undefined {
  const call = ((body ?? {}) as Record<string, unknown>).call as Record<string, unknown> | undefined;
  const from = call?.from_number;
  return typeof from === "string" && from ? from : undefined;
}

/** Shared bearer check for the voice webhooks. */
export function voiceAuthed(req: Request): boolean {
  const expected = process.env.RETELL_WEBHOOK_SECRET;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === expected;
}
