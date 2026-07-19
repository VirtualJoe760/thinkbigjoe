/**
 * Per-call dynamic variables for the shared receptionist agent.
 *
 * Retell interpolates these into the prompt in `scripts/retell/receptionist-config.mjs` as
 * `{{variable}}`. One agent, one prompt, values swapped per call — which is why improving the
 * prompt improves it for every customer at once, and why there are no per-customer agents to
 * migrate. See docs/VOICE_TENANCY_SPEC.md.
 *
 * HARD CONSTRAINT: Retell requires every value to be a STRING. Numbers, booleans and objects are
 * rejected, which is why booking_enabled is "true"/"false" and everything runs through `s()`.
 *
 * Every key here must exist for every tenant. A missing key leaves a literal `{{placeholder}}` in
 * the prompt, which the agent will read aloud to a customer — so defaults are mandatory, not
 * defensive.
 */
import type { VoiceTenant } from "@/lib/voice-tenant";

/** Coerce to a trimmed string, falling back when empty. Retell rejects non-strings. */
function s(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  const out = String(v).trim();
  return out || fallback;
}

/** Human-readable label for a zone, e.g. "America/Phoenix" → "Arizona". Spoken aloud. */
function zoneLabel(tz: string): string {
  const known: Record<string, string> = {
    "America/Phoenix": "Arizona",
    "America/Los_Angeles": "Pacific",
    "America/Denver": "Mountain",
    "America/Chicago": "Central",
    "America/New_York": "Eastern",
  };
  return known[tz] ?? tz.split("/").pop()?.replace(/_/g, " ") ?? "local";
}

export function buildDynamicVariables(t: VoiceTenant): Record<string, string> {
  const c = t.config;

  return {
    business_name: s(t.businessName, "this business"),

    // The agent opens with this verbatim, so it must always be a complete sentence.
    greeting: s(
      c.greeting,
      `Thanks for calling ${s(t.businessName, "us")}, this is the after-hours line — what's going on?`,
    ),

    services: s(c.services, "General service work. If you're unsure whether we cover something, take the details anyway."),
    service_area: s(c.serviceArea, "the local area"),
    hours_text: s(c.hours, "Regular business hours, Monday through Friday."),

    emergency_definition: s(
      c.emergencyDefinition,
      "An emergency is anything causing active damage or danger right now — flooding, a burst pipe, sewage backing up, no water at all, or any smell of gas. A slow drip or a clog that still drains is not an emergency.",
    ),

    faq_text: s(c.faqs, "No specific questions on file — if you don't know an answer, say someone will cover it on the callback."),
    do_not_say: s(c.doNot, "Never promise a specific arrival time."),

    // Empty string is meaningful: the prompt must not offer a transfer we can't perform.
    escalation_phone: s(t.escalateTo),

    booking_enabled: t.bookingEnabled ? "true" : "false",
    timezone_label: zoneLabel(s(t.timezone, "America/Phoenix")),
  };
}

/**
 * A tenant we couldn't identify — an unrecognised or retired number.
 *
 * This must never throw and never leak another business's details: the agent takes a message
 * politely rather than the caller hearing dead air. Returning a 500 from the inbound webhook would
 * drop the call entirely, which is strictly worse than a generic greeting.
 */
export function fallbackVariables(): Record<string, string> {
  return {
    business_name: "this business",
    greeting: "Thanks for calling — the office is closed right now, but I can take a message.",
    services: "Take the caller's details and pass them along. Do not guess at what this business does.",
    service_area: "the local area",
    hours_text: "Regular business hours.",
    emergency_definition: "Treat anything involving danger or active damage as urgent.",
    faq_text: "No information on file — do not guess. Say someone will call them back.",
    do_not_say: "Never promise a specific arrival time, price, or service. You do not have details about this business.",
    escalation_phone: "",
    booking_enabled: "false",
    timezone_label: "local",
  };
}
