import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, leads, activityLog } from "@/db";
import { notifyTelegram } from "@/lib/telegram";
import { sendBookingConfirmationEmail } from "@/lib/email";
import {
  BOOKING_TIMEZONE,
  createEvent,
  isCalendarConfigured,
  isWindowFree,
  meetLinkOf,
} from "@/lib/gcal";

export async function POST(req: Request) {
  // --- Auth ---
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const expected = process.env.VENUS_API_KEY;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isCalendarConfigured()) {
    return NextResponse.json({ error: "Booking is not available" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const startTime = typeof body.startTime === "string" ? body.startTime : "";
  const endTime = typeof body.endTime === "string" ? body.endTime : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : undefined;
  const company = typeof body.company === "string" ? body.company.trim() : undefined;
  const notes = typeof body.notes === "string" ? body.notes.trim() : undefined;

  if (!name || !email || !startTime || !endTime) {
    return NextResponse.json(
      { error: "name, email, startTime, and endTime are required" },
      { status: 400 },
    );
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid start/end time" }, { status: 400 });
  }
  if (end.getTime() <= start.getTime()) {
    return NextResponse.json({ error: "endTime must be after startTime" }, { status: 400 });
  }

  try {
    const free = await isWindowFree(start.toISOString(), end.toISOString());
    if (!free) {
      return NextResponse.json(
        { error: "That time is already taken — please pick another slot" },
        { status: 409 },
      );
    }

    const description = [
      `Strategy call booked by Venus (AI outreach assistant)`,
      ``,
      `Name: ${name}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : null,
      company ? `Company: ${company}` : null,
      notes ? `` : null,
      notes ? `Notes:\n${notes}` : null,
    ]
      .filter((l): l is string => l !== null)
      .join("\n");

    const event = await createEvent({
      summary: `Strategy Call — ${name}${company ? ` (${company})` : ""}`,
      description,
      start: { dateTime: start.toISOString(), timeZone: BOOKING_TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: BOOKING_TIMEZONE },
      attendees: [{ email, displayName: name }],
      conferenceData: {
        createRequest: {
          requestId: `tbj-venus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

    // Upsert lead
    const existing = await db
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.email, email))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(leads)
        .set({ status: "booked", bookedSlot: start.toISOString() })
        .where(eq(leads.email, email));
    } else {
      await db.insert(leads).values({
        name,
        email,
        phone: phone ?? null,
        company: company ?? null,
        notes: notes ?? "Booked via Venus outreach",
        status: "booked",
        bookedSlot: start.toISOString(),
        source: "booking-page",
      });
    }

    const timeStr = start.toLocaleString("en-US", {
      timeZone: BOOKING_TIMEZONE,
      dateStyle: "medium",
      timeStyle: "short",
    });

    sendBookingConfirmationEmail({
      to: email,
      name,
      whenLabel: `${start.toLocaleString("en-US", { timeZone: BOOKING_TIMEZONE, dateStyle: "full", timeStyle: "short" })} Pacific`,
      meetLink: meetLinkOf(event),
    }).catch((err) => console.error("[venus-book] confirmation email failed:", err));

    notifyTelegram(
      `📅 <b>New strategy call booked</b> (via Venus)\n${name}${company ? ` · ${company}` : ""}\n${timeStr} PT`,
    ).catch(() => {});

    await db.insert(activityLog).values({
      actor: "venus",
      eventType: "booking_made",
      summary: `Booked strategy call with ${name}${company ? ` (${company})` : ""}`,
      metadata: { email, phone, startTime, eventId: event.id },
    }).catch((err) => console.error("[venus-book] activity_log insert failed:", err));

    return NextResponse.json({
      booked: true,
      eventId: event.id,
      htmlLink: event.htmlLink,
    });
  } catch (err) {
    console.error("[venus-book] booking failed:", err);
    return NextResponse.json(
      { error: "Could not book the appointment" },
      { status: 500 },
    );
  }
}
