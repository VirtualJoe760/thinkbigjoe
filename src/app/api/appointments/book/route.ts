import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, leads } from "@/db";
import { verifyBookingToken } from "@/lib/booking-token";
import { sendNotificationEmail } from "@/lib/email";
import { notifyTelegram } from "@/lib/telegram";
import {
  BOOKING_TIMEZONE,
  createEvent,
  isCalendarConfigured,
  isWindowFree,
  MIN_NOTICE_MS,
  SLOT_DURATION_MIN,
} from "@/lib/gcal";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";

export async function POST(req: Request) {
  if (!isCalendarConfigured()) {
    return NextResponse.json({ error: "Booking is not available" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const startTime = String(body.startTime || "");
  const endTime = String(body.endTime || "");
  const bookingToken =
    typeof body.bookingToken === "string" ? body.bookingToken : null;

  // The calendar is gated: bookings only happen against a lead created by a
  // completed (Turnstile-verified) intake. Identity comes from the lead
  // record, not the request body — the token can't book on someone else's
  // behalf.
  const tokenPayload = verifyBookingToken(bookingToken);
  if (!tokenPayload) {
    return NextResponse.json(
      { error: "A completed intake is required to book" },
      { status: 403 },
    );
  }

  if (!startTime || !endTime) {
    return NextResponse.json(
      { error: "startTime and endTime are required" },
      { status: 400 },
    );
  }
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid start/end time" }, { status: 400 });
  }
  if (start.getTime() < Date.now() + MIN_NOTICE_MS - 60_000) {
    return NextResponse.json(
      { error: "That time is too soon — please pick a later slot" },
      { status: 400 },
    );
  }
  const durationMs = end.getTime() - start.getTime();
  if (durationMs <= 0 || durationMs > SLOT_DURATION_MIN * 2 * 60000) {
    return NextResponse.json({ error: "Invalid slot duration" }, { status: 400 });
  }

  try {
    const leadId = Number(tokenPayload.leadId);
    const foundLeads = await db
      .select()
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1);
    const lead = foundLeads[0];
    if (!lead) {
      return NextResponse.json({ error: "Intake not found" }, { status: 403 });
    }

    const name = String(lead.name);
    const email = String(lead.email);

    // Re-check the window is still free (avoid double-booking races).
    const free = await isWindowFree(start.toISOString(), end.toISOString());
    if (!free) {
      return NextResponse.json(
        { error: "That time was just taken — please pick another slot" },
        { status: 409 },
      );
    }

    const description = [
      `Strategy call booked via ${SITE_URL.replace(/^https?:\/\//, "")}${lead.sourcePath ? ` (${lead.sourcePath})` : ""}`,
      ``,
      `Name: ${name}`,
      `Email: ${email}`,
      lead.phone ? `Phone: ${lead.phone}` : null,
      lead.company ? `Company: ${lead.company}` : null,
      lead.role ? `Role: ${lead.role}` : null,
      lead.industry ? `Industry: ${lead.industry}` : null,
      lead.teamSize ? `Team size: ${lead.teamSize}` : null,
      lead.timeline ? `Timeline: ${lead.timeline}` : null,
      lead.problem ? `` : null,
      lead.problem ? `What they want to build:\n${lead.problem}` : null,
    ]
      .filter((l): l is string => l !== null)
      .join("\n");

    const event = await createEvent({
      summary: `Strategy Call — ${name}${lead.company ? ` (${lead.company})` : ""}`,
      description,
      start: { dateTime: start.toISOString(), timeZone: BOOKING_TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: BOOKING_TIMEZONE },
      attendees: [{ email, displayName: name }],
      conferenceData: {
        createRequest: {
          requestId: `tbj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

    await db
      .update(leads)
      .set({ status: "booked", bookedSlot: start.toISOString() })
      .where(eq(leads.id, leadId))
      .catch((err) => console.error("[appointments] lead update failed:", err));

    // Admin heads-up (no-ops until SMTP is configured; the Google Calendar
    // invite is the primary notification either way).
    sendNotificationEmail({
      to: process.env.EMAIL_BCC || "no-reply@thinkbigjoe.com",
      subject: `New strategy call booked — ${name}`,
      heading: "New strategy call booked",
      message: `${name} (${email}${lead.company ? `, ${lead.company}` : ""}) booked ${start.toLocaleString("en-US", { timeZone: BOOKING_TIMEZONE, dateStyle: "full", timeStyle: "short" })} (Pacific).`,
    }).catch(() => {});

    notifyTelegram(
      `📅 <b>New strategy call booked</b>\n${name}${lead.company ? ` · ${lead.company}` : ""}\n${start.toLocaleString("en-US", { timeZone: BOOKING_TIMEZONE, dateStyle: "medium", timeStyle: "short" })} PT`,
    ).catch(() => {});

    return NextResponse.json({
      booked: true,
      eventId: event.id,
      htmlLink: event.htmlLink,
    });
  } catch (err) {
    console.error("[appointments] booking failed:", err);
    return NextResponse.json(
      { error: "Could not book the appointment" },
      { status: 500 },
    );
  }
}
