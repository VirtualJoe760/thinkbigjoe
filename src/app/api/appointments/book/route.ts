import { NextResponse } from "next/server";

import { sendNotificationEmail } from "@/lib/email";
import {
  BOOKING_TIMEZONE,
  createEvent,
  isCalendarConfigured,
  isWindowFree,
  MIN_NOTICE_MS,
  SLOT_DURATION_MIN,
} from "@/lib/gcal";
import { verifyTurnstileToken } from "@/lib/turnstile";

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

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const phone = String(body.phone || "").trim();
  const message = String(body.message || "").trim();
  const startTime = String(body.startTime || "");
  const endTime = String(body.endTime || "");
  const captchaToken = typeof body.captchaToken === "string" ? body.captchaToken : null;

  if (!name || !email || !startTime || !endTime) {
    return NextResponse.json(
      { error: "name, email, startTime, and endTime are required" },
      { status: 400 },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
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

  // Bot protection (same Turnstile widget as auth).
  const remoteIp = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for");
  const human = await verifyTurnstileToken(captchaToken, remoteIp);
  if (!human) {
    return NextResponse.json(
      { error: "Verification failed — please try again" },
      { status: 403 },
    );
  }

  try {
    // Re-check the window is still free (avoid double-booking races).
    const free = await isWindowFree(start.toISOString(), end.toISOString());
    if (!free) {
      return NextResponse.json(
        { error: "That time was just taken — please pick another slot" },
        { status: 409 },
      );
    }

    const description = [
      `Strategy call booked via ${SITE_URL.replace(/^https?:\/\//, "")}`,
      ``,
      `Name: ${name}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : null,
      message ? `` : null,
      message ? `Message:\n${message}` : null,
    ]
      .filter((l): l is string => l !== null)
      .join("\n");

    const event = await createEvent({
      summary: `Strategy Call — ${name}`,
      description,
      start: { dateTime: start.toISOString(), timeZone: BOOKING_TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: BOOKING_TIMEZONE },
      attendees: [{ email, displayName: name }],
      // Attach a Google Meet link to the invite.
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

    // Admin heads-up via our transactional email (no-ops until SMTP is set;
    // the Google Calendar invite is the primary notification either way).
    sendNotificationEmail({
      to: process.env.EMAIL_BCC || "no-reply@thinkbigjoe.com",
      subject: `New strategy call booked — ${name}`,
      heading: "New strategy call booked",
      message: `${name} (${email}${phone ? `, ${phone}` : ""}) booked ${start.toLocaleString("en-US", { timeZone: BOOKING_TIMEZONE, dateStyle: "full", timeStyle: "short" })} (Pacific).${message ? `<br/><br/>"${message}"` : ""}`,
    }).catch(() => {});

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
