import { NextResponse } from "next/server";

import {
  ADVANCE_BOOKING_DAYS,
  getAvailableSlots,
  isCalendarConfigured,
} from "@/lib/gcal";

export async function GET(req: Request) {
  if (!isCalendarConfigured()) {
    return NextResponse.json({ error: "Booking is not available" }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date is required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  // Date-level bounds: not in the past, within the advance-booking window.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const requested = new Date(date + "T12:00:00");
  if (requested.getTime() < today.getTime() - 24 * 60 * 60 * 1000) {
    return NextResponse.json({ slots: [] });
  }
  const maxDate = new Date(today.getTime() + ADVANCE_BOOKING_DAYS * 24 * 60 * 60 * 1000);
  if (requested.getTime() > maxDate.getTime()) {
    return NextResponse.json({ slots: [] });
  }

  try {
    const slots = await getAvailableSlots(date);
    return NextResponse.json({ slots });
  } catch (err) {
    console.error("[appointments] available-slots failed:", err);
    return NextResponse.json(
      { error: "Could not load availability" },
      { status: 500 },
    );
  }
}
