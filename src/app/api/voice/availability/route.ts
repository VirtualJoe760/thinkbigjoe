import { NextResponse } from "next/server";

import { isCalendarConfigured } from "@/lib/gcal";
import {
  getSlotsForDate,
  getUpcomingSlots,
  parseRetellArgs,
  voiceAuthed,
} from "@/lib/voice-booking";

export const dynamic = "force-dynamic";

/**
 * Retell custom function: `check_availability`.
 * The receptionist agent calls this to find open strategy-call slots.
 * Args: { date?: "YYYY-MM-DD" }  — omit for the next few open slots across upcoming days.
 * Returns a spoken-friendly list the agent reads back to the caller.
 */
export async function POST(req: Request) {
  if (!voiceAuthed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isCalendarConfigured()) {
    return NextResponse.json({ message: "Booking isn't available right now." }, { status: 200 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* Retell may send an empty body for no-arg calls */
  }
  const args = parseRetellArgs(body);
  const date = typeof args.date === "string" ? args.date.trim() : "";

  try {
    const slots = date ? await getSlotsForDate(date) : await getUpcomingSlots(5);
    if (slots.length === 0) {
      return NextResponse.json({
        slots: [],
        message: date
          ? `There are no open times on that day. We book Monday through Friday between 11 AM and 1 PM Pacific — want me to check another day?`
          : `I don't see any open times in the next few weeks. Please try again later.`,
      });
    }
    const list = slots.map((s) => s.label).join("; ");
    return NextResponse.json({
      slots,
      message: `The next available times are: ${list}. Which works best?`,
    });
  } catch (err) {
    console.error("[voice/availability] failed:", err);
    return NextResponse.json({
      slots: [],
      message: "I had trouble checking the calendar just now — let me take your details and Joe's team will confirm a time.",
    });
  }
}
