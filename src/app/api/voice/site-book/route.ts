import { NextResponse } from "next/server";

import { type ClientCalEvent, listCalendarEvents } from "@/lib/google-oauth";
import { SITE_SLOT_MIN, availableSlots, bookForSite, getBookableSite, ownerAccessToken } from "@/lib/site-booking";
import { callerPhone, parseRetellArgs, voiceAuthed } from "@/lib/voice-booking";
import { siteFromCall } from "@/lib/voice-tenant";

export const dynamic = "force-dynamic";

/**
 * Retell custom function: `book_job` (shared customer receptionist).
 *
 * The TENANT-SCOPED twin of /api/voice/book. That route books a TBJ strategy call onto Joe's own
 * calendar; this one books the CALLER's job onto the CUSTOMER's calendar via site-booking.ts, which
 * also files the caller into the owner's "Website Leads" contacts.
 *
 * Tenancy comes from `call.to_number` (siteFromCall) — never a tool argument, so a caller can't
 * book onto a different business's calendar by naming it.
 *
 * Args: { name, start_time (ISO, from check_job_availability), phone?, email?, notes? }
 */
export async function POST(req: Request) {
  if (!voiceAuthed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ booked: false, message: "Sorry, I didn't catch that — could you say that again?" });
  }

  const tenant = await siteFromCall(body);
  if (!tenant || !tenant.bookingEnabled || !tenant.ownerUserId) {
    // Never attempt a booking in this state, and never say "calendar" — the caller only needs to
    // know a human will ring them back. The agent's next move is take_message.
    return NextResponse.json({ booked: false, message: FALLBACK_MESSAGE });
  }

  const args = parseRetellArgs(body);
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const startTime = typeof args.start_time === "string" ? args.start_time.trim() : "";
  const email = typeof args.email === "string" && args.email.trim() ? args.email.trim() : undefined;
  const notes = typeof args.notes === "string" && args.notes.trim() ? args.notes.trim() : undefined;
  // The number they dialled FROM is the best callback number we have; an LLM-transcribed one is
  // guessy, so only prefer it when the caller actually gave one.
  const phone = (typeof args.phone === "string" && args.phone.trim()) || callerPhone(body) || undefined;

  if (!name || !startTime) {
    return NextResponse.json({
      booked: false,
      message: "I just need your name and which time you'd like before I can lock that in.",
    });
  }

  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ booked: false, message: "That time didn't come through — which of those times would you like?" });
  }

  try {
    const site = await getBookableSite(tenant.slug);
    if (!site) return NextResponse.json({ booked: false, message: FALLBACK_MESSAGE });
    const token = await ownerAccessToken(site);
    if (!token) return NextResponse.json({ booked: false, message: FALLBACK_MESSAGE });

    const label = spokenLabelIn(start.toISOString(), site.timezone);

    // IDEMPOTENCY. Retell retries a failed custom function up to 2 times, and a retry after a slow
    // -but-successful first attempt would otherwise be rejected by bookForSite's conflict check as
    // "that time was just taken" — telling a caller who IS booked that they aren't. So look for an
    // appointment we already made for this person in this exact window and treat it as success.
    const end = new Date(start.getTime() + SITE_SLOT_MIN * 60000);
    const existing = await listCalendarEvents(token, start.toISOString(), end.toISOString());

    // null = the calendar is unreadable right now (outage, expired token). We can neither confirm a
    // prior booking nor trust availableSlots(), which collapses an unreadable calendar to []. Hand
    // straight to bookForSite: it re-reads and fails closed with its own caller-safe "try again"
    // line, and returning a retryable outcome is better than refusing a legitimate time.
    if (existing !== null) {
      if (existing.some((e) => isOurBookingFor(e, name, start))) {
        return NextResponse.json({
          booked: true,
          message: `You're already down for ${label} — we'll see you then.`,
        });
      }

      // NEVER trust an LLM-supplied instant. start_time is echoed back by the model from
      // check_job_availability, but nothing stops it inventing one — and bookForSite only enforces
      // min-notice and conflicts, so 3am Sunday would land on the owner's calendar. The offered
      // slots ARE the policy (business days, open hours, notice, conflicts), so require the request
      // to be one of them rather than re-deriving those rules here and letting the two drift.
      const slots = await availableSlots(site, token);
      if (!slots.some((iso) => new Date(iso).getTime() === start.getTime())) {
        // An empty list is ambiguous — genuinely full, or the calendar went unreadable between the
        // read above and this one. Both leave us unable to place the caller, and the honest,
        // non-committal line is right for either.
        if (slots.length === 0) {
          console.warn(`[voice/site-book] no bookable slots for site ${tenant.siteId} — refusing ${start.toISOString()}`);
          return NextResponse.json({ booked: false, message: FALLBACK_MESSAGE });
        }
        console.warn(`[voice/site-book] site ${tenant.siteId}: requested ${start.toISOString()} is not an offered slot`);
        return NextResponse.json({
          booked: false,
          message: "I can't put you down for that time — let me read you the openings again so we can pick one.",
        });
      }
    }

    const result = await bookForSite(site, token, {
      name,
      email: email ?? null,
      phone: phone ?? null,
      notes: [notes, phone ? `Booked by phone from ${phone}.` : null].filter(Boolean).join("\n") || null,
      startISO: start.toISOString(),
    });

    if (!result.ok) {
      // bookForSite's messages are already caller-safe and calendar-free (e.g. "that time was just
      // taken"), so pass them straight through rather than flattening them to the generic line.
      return NextResponse.json({ booked: false, message: result.message });
    }

    return NextResponse.json({
      booked: true,
      message: `You're all set for ${label}.${email ? ` I'll send a confirmation to ${email}.` : ""} Anything else I can help with?`,
    });
  } catch (err) {
    console.error(`[voice/site-book] booking failed for site ${tenant.siteId}:`, err);
    return NextResponse.json({ booked: false, message: FALLBACK_MESSAGE });
  }
}

/**
 * Spoken whenever we can't book for ANY reason — booking off, unclaimed site, no connected
 * calendar, or an outage. Identical across causes so nothing leaks, and free of the word "calendar".
 */
const FALLBACK_MESSAGE =
  "I'm not able to lock in a time on this call, but if I take your name and number someone will call you right back to get you scheduled.";

/**
 * Is this event one WE created, for THIS caller, at THIS instant?
 *
 * This gate short-circuits the booking with "you're already down" — a false positive silently
 * refuses a real job with no record of it, so it has to be near-certain. The previous version
 * matched any event whose summary merely CONTAINED the caller's name, case-insensitively: an owner
 * with "Lunch w/ Dave" on the books at 11am would turn every caller named Dave away.
 *
 * Three independent conditions, all required:
 *   1. `tbjBooking` — the TBJ_BOOKING_KEY extended property we stamp on events we create. On its
 *      own it's not enough: google-oauth also infers it heuristically from the summary for events
 *      that predate the marker.
 *   2. The summary is EXACTLY the title bookForSite writes — no substring, no partial name.
 *   3. The description carries bookForSite's own opening line, which a human-created event on the
 *      owner's calendar would not have.
 *
 * If any of them is off we do NOT short-circuit. A rare duplicate booking is a phone call to fix;
 * a job silently turned away is lost revenue nobody ever hears about.
 */
function isOurBookingFor(e: ClientCalEvent, name: string, start: Date): boolean {
  if (!e.tbjBooking) return false;
  if (new Date(e.start).getTime() !== start.getTime()) return false;
  // Case/whitespace tolerance only — speech-to-text varies there and nowhere else that matters.
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  if (norm(e.summary) !== norm(`${name} — booking`)) return false;
  return norm(e.description).includes("new booking from the");
}

/**
 * Phone-friendly label in the TENANT's zone. Duplicated from site-availability/route.ts rather than
 * shared, because voice-booking.ts's spokenLabel() is hardcoded to Pacific (it serves TBJ's own
 * sales calendar) and belongs to another owner — see the note in this slice's handoff.
 */
function spokenLabelIn(iso: string, tz: string): string {
  const d = new Date(iso);
  const day = d.toLocaleString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" });
  const time = d.toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const zone = spokenZone(d, tz);
  return zone ? `${day} at ${time} ${zone}` : `${day} at ${time}`;
}

/** A zone label a person would SAY ("Mountain"); TTS reads "MST" as letters, which sounds robotic. */
function spokenZone(d: Date, tz: string): string | undefined {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(d);
  const abbr = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const named: Record<string, string> = {
    PST: "Pacific", PDT: "Pacific",
    MST: "Mountain", MDT: "Mountain",
    CST: "Central", CDT: "Central",
    EST: "Eastern", EDT: "Eastern",
    AKST: "Alaska", AKDT: "Alaska",
    HST: "Hawaii", HDT: "Hawaii",
  };
  // Offset-style abbreviations ("GMT-7") read terribly aloud — better to say nothing than that.
  return named[abbr] ?? (/^[A-Z]{2,5}$/.test(abbr) ? abbr : undefined);
}
