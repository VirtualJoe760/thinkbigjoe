import { NextResponse } from "next/server";

import { listCalendarEvents } from "@/lib/google-oauth";
import { availableSlots, getBookableSite, ownerAccessToken } from "@/lib/site-booking";
import { parseRetellArgs, voiceAuthed } from "@/lib/voice-booking";
import { siteFromCall } from "@/lib/voice-tenant";

export const dynamic = "force-dynamic";

/**
 * Retell custom function: `check_job_availability` (shared customer receptionist).
 *
 * The TENANT-SCOPED twin of /api/voice/availability. That route reads TBJ's own sales calendar
 * (Joe's hours, Pacific time); this one reads the CUSTOMER's calendar, so a plumber's caller is
 * offered the plumber's openings in the plumber's timezone.
 *
 * Which business we're acting for comes from `call.to_number` via siteFromCall() — never from a
 * tool argument, so a caller can't talk the agent into reading another business's calendar.
 *
 * Args: { date?: "YYYY-MM-DD" } — omit for the next few openings.
 */
export async function POST(req: Request) {
  if (!voiceAuthed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* Retell sends an empty body for no-arg calls. */
  }

  const tenant = await siteFromCall(body);
  if (!tenant) {
    // The dialled number isn't one of ours (or the line is paused). Say nothing business-specific.
    return NextResponse.json({ slots: [], available: false, message: FALLBACK_MESSAGE });
  }

  // Every "we can't book" path speaks the SAME reassuring line and never says "calendar" — the
  // caller doesn't know or care that a Google token expired; they just need to know a human will
  // ring them back. The agent's next move is take_message.
  if (!tenant.bookingEnabled || !tenant.ownerUserId) {
    return NextResponse.json({ slots: [], available: false, message: FALLBACK_MESSAGE });
  }

  try {
    const site = await getBookableSite(tenant.slug);
    if (!site) {
      return NextResponse.json({ slots: [], available: false, message: FALLBACK_MESSAGE });
    }
    const token = await ownerAccessToken(site);
    if (!token) {
      return NextResponse.json({ slots: [], available: false, message: FALLBACK_MESSAGE });
    }

    const args = parseRetellArgs(body);
    const date = typeof args.date === "string" ? args.date.trim() : "";

    // availableSlots fails closed: an unreadable calendar yields [] rather than slots we can't
    // verify, which would double-book the owner. Right call — but it makes [] ambiguous, and the
    // two causes need different words (see below).
    const all = await availableSlots(site, token);
    let slots = all;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      slots = all.filter((iso) => dateStrIn(iso, site.timezone) === date);
    }

    // Only the UNFILTERED list being empty is ambiguous. If we had slots and the caller's chosen day
    // filtered them all out, the calendar plainly read fine — no probe needed.
    if (all.length === 0) {
      // "We're fully booked" is a LIE during a Google outage, and it sends a paying job away for a
      // reason that has nothing to do with the owner's diary. availableSlots() collapses both cases
      // to [], so probe the calendar ourselves to tell them apart: a tiny window is one cheap read
      // that answers "is this calendar readable at all right now", and we only pay for it on the
      // ambiguous path — never when we actually have times to offer.
      const readable = await calendarReadable(token);
      if (!readable) {
        console.error(`[voice/site-availability] calendar unreadable for site ${tenant.siteId} — not claiming 'fully booked'`);
        return NextResponse.json({ slots: [], available: false, message: FALLBACK_MESSAGE });
      }
      return NextResponse.json({
        slots: [],
        available: false,
        message: date
          ? "I don't have anything open that day — would another day work, or shall I take your details and have someone call you back?"
          : "I don't have any openings coming up right now — let me take your details and someone will call you back to arrange a time.",
      });
    }

    // We have openings, just none on the day they asked for. Don't send them away — the agent can
    // offer the other days.
    if (slots.length === 0) {
      return NextResponse.json({
        slots: [],
        available: false,
        message: "I don't have anything open that day — would another day work, or shall I take your details and have someone call you back?",
      });
    }

    // At most 4 aloud. A phone caller can't hold ten options in their head, and reading a long
    // list is the fastest way to make them ask you to start over.
    const offered = slots.slice(0, MAX_SPOKEN_SLOTS).map((iso) => ({
      label: spokenLabelIn(iso, site.timezone),
      start: iso,
    }));

    return NextResponse.json({
      slots: offered,
      available: true,
      message: `I have ${offered.map((s) => s.label).join("; ")}. Which of those works best for you?`,
    });
  } catch (err) {
    console.error(`[voice/site-availability] failed for site ${tenant.siteId}:`, err);
    return NextResponse.json({ slots: [], available: false, message: FALLBACK_MESSAGE });
  }
}

const MAX_SPOKEN_SLOTS = 4;

/**
 * Can we read this owner's calendar at all right now?
 *
 * listCalendarEvents distinguishes null (couldn't read) from [] (read fine, nothing there), but
 * availableSlots deliberately collapses both to [] so it never offers a slot it couldn't verify.
 * That leaves this route unable to tell "genuinely booked solid" from "Google is down" — and it was
 * speaking the former for both. A one-minute window is the cheapest question that recovers the
 * distinction; the window's contents are irrelevant, only whether the read succeeded.
 */
async function calendarReadable(token: string): Promise<boolean> {
  const now = Date.now();
  return (await listCalendarEvents(token, new Date(now).toISOString(), new Date(now + 60000).toISOString())) !== null;
}

/**
 * Spoken when we can't offer times for ANY reason — booking off, unclaimed site, no connected
 * calendar, or an outage. Deliberately identical across causes so the agent never leaks which one
 * it hit, and deliberately free of the word "calendar".
 */
const FALLBACK_MESSAGE =
  "I'm not able to lock in a time on this call, but if I take your name and number someone will call you right back to get you scheduled.";

/** YYYY-MM-DD for an instant as observed in `tz` (en-CA renders in that order). */
function dateStrIn(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
}

/**
 * Phone-friendly label in the TENANT's zone, e.g. "Monday, July 20 at 11:00 AM Mountain".
 *
 * voice-booking.ts's spokenLabel() is hardcoded to Pacific because it serves TBJ's own sales
 * calendar; using it here would tell an Arizona plumber's customer the wrong hour.
 */
function spokenLabelIn(iso: string, tz: string): string {
  const d = new Date(iso);
  const day = d.toLocaleString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" });
  const time = d.toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const zone = spokenZone(d, tz);
  return zone ? `${day} at ${time} ${zone}` : `${day} at ${time}`;
}

/**
 * A zone label a person would SAY ("Mountain"), not one they'd read ("MST"). TTS pronounces the
 * abbreviations as letters, which sounds robotic on a live call.
 */
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
