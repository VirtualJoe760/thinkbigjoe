import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, leads, activityLog } from "@/db";
import { notifyTelegram } from "@/lib/telegram";
import { sendBookingConfirmationEmail } from "@/lib/email";
import {
  BOOKING_TIMEZONE,
  SLOT_DURATION_MIN,
  createEvent,
  isCalendarConfigured,
  isWindowFree,
  meetLinkOf,
} from "@/lib/gcal";
import { callerPhone, parseRetellArgs, spokenLabel, voiceAuthed } from "@/lib/voice-booking";

export const dynamic = "force-dynamic";

/**
 * Retell custom function: `book_appointment`.
 * The receptionist agent calls this after collecting name, email, and a chosen slot.
 * Args: { name, email, start_time (ISO from check_availability), phone?, notes? }
 * Books the strategy call into Google Calendar (Meet) + records the lead — same path as venus-book.
 */
export async function POST(req: Request) {
  if (!voiceAuthed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isCalendarConfigured()) {
    return NextResponse.json({ booked: false, message: "Booking isn't available right now." });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ booked: false, message: "Sorry, I didn't catch that." });
  }
  const args = parseRetellArgs(body);
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const email = typeof args.email === "string" ? args.email.trim() : "";
  const startTime = typeof args.start_time === "string" ? args.start_time : "";
  const notes = typeof args.notes === "string" ? args.notes.trim() : undefined;
  const reason = typeof args.reason === "string" ? args.reason.trim() : undefined;
  const isAgentic = args.type === "agentic";
  const callLabel = isAgentic ? "Agentic Strategy Call" : "Strategy Call";
  const phone =
    (typeof args.phone === "string" && args.phone.trim()) || callerPhone(body) || undefined;

  if (!name || !email || !startTime) {
    return NextResponse.json({
      booked: false,
      message: "I still need your name, email, and a preferred time to book the call.",
    });
  }

  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ booked: false, message: "That time didn't look right — which slot would you like?" });
  }
  const end = new Date(start.getTime() + SLOT_DURATION_MIN * 60000);

  try {
    if (!(await isWindowFree(start.toISOString(), end.toISOString()))) {
      return NextResponse.json({
        booked: false,
        message: "It looks like that time was just taken — want me to check other openings?",
      });
    }

    const description = [
      `${callLabel} booked by the ThinkBigJoe phone assistant.`,
      ``,
      `Name: ${name}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : null,
      reason ? `Reason: ${reason}` : null,
      isAgentic ? `Type: AGENTIC ($999 tier) — bespoke OpenClaw agent scoping.` : null,
      notes ? `` : null,
      notes ? `Notes:\n${notes}` : null,
    ]
      .filter((l): l is string => l !== null)
      .join("\n");

    const event = await createEvent({
      summary: `${callLabel} — ${name}`,
      description,
      start: { dateTime: start.toISOString(), timeZone: BOOKING_TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: BOOKING_TIMEZONE },
      attendees: [{ email, displayName: name }],
      conferenceData: {
        createRequest: {
          requestId: `tbj-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 60 },
          { method: "popup", minutes: 15 },
        ],
      },
    });

    const existing = await db
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.email, email))
      .limit(1);
    if (existing.length > 0) {
      await db
        .update(leads)
        .set({ status: "booked", bookedSlot: start.toISOString(), phone: phone ?? null })
        .where(eq(leads.email, email));
    } else {
      await db.insert(leads).values({
        name,
        email,
        phone: phone ?? null,
        notes: [reason, notes].filter(Boolean).join(" — ") || "Booked via ThinkBigJoe phone assistant",
        status: "booked",
        bookedSlot: start.toISOString(),
        source: "booking-page",
      });
    }

    const label = spokenLabel(start.toISOString());
    const meetLink = meetLinkOf(event);
    sendBookingConfirmationEmail({ to: email, name, whenLabel: label, meetLink, isAgentic }).catch((err) =>
      console.error("[voice/book] confirmation email failed:", err),
    );
    notifyTelegram(
      `📞 <b>New ${isAgentic ? "AGENTIC " : ""}strategy call booked</b> (via phone assistant)\n${name}${phone ? ` · ${phone}` : ""}\n${label}${reason ? `\nReason: ${reason}` : ""}`,
    ).catch(() => {});
    await db
      .insert(activityLog)
      .values({
        actor: "voice",
        eventType: "booking_made",
        summary: `Phone assistant booked a strategy call with ${name}`,
        metadata: { email, phone, startTime, eventId: event.id },
      })
      .catch((err) => console.error("[voice/book] activity_log insert failed:", err));

    return NextResponse.json({
      booked: true,
      message: `You're all set — I've booked your call for ${label}. A calendar invite with the video link is on its way to ${email}.`,
    });
  } catch (err) {
    console.error("[voice/book] booking failed:", err);
    return NextResponse.json({
      booked: false,
      message: "I ran into a problem booking that — I'll have Joe's team reach out to confirm a time.",
    });
  }
}
