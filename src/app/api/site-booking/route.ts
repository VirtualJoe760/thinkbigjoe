import { NextResponse } from "next/server";

import { availableSlots, bookForSite, getBookableSite, ownerAccessToken } from "@/lib/site-booking";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Open slots for a site's public booking page. `?slug=`. */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") || "";
  const site = await getBookableSite(slug);
  if (!site) return NextResponse.json({ ok: false, error: "not_bookable" }, { status: 404 });

  const token = await ownerAccessToken(site);
  // The owner hasn't connected their calendar — say so plainly rather than showing fake slots.
  if (!token) return NextResponse.json({ ok: false, error: "calendar_not_connected", businessName: site.businessName });

  const slots = await availableSlots(site, token);
  return NextResponse.json({ ok: true, businessName: site.businessName, timezone: site.timezone, slots });
}

/**
 * Take a booking from a client's website. Public by necessity (their customers aren't signed in),
 * so it validates hard and only ever writes to the calendar of the site's own claimed owner.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Bad request." }, { status: 400 });
  }

  const slug = String(body.slug || "").trim();
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const phone = String(body.phone || "").trim();
  const notes = String(body.notes || "").trim();
  const startISO = String(body.startISO || "").trim();
  // Honeypot: a real person never fills a field they can't see.
  if (String(body.company || "").trim()) return NextResponse.json({ ok: true, message: "Booked" });

  if (!name || !startISO) return NextResponse.json({ ok: false, message: "Please add your name and pick a time." }, { status: 400 });
  if (!email && !phone) return NextResponse.json({ ok: false, message: "Please leave an email or a phone number." }, { status: 400 });
  if (email && !EMAIL_RE.test(email)) return NextResponse.json({ ok: false, message: "That email doesn't look right." }, { status: 400 });
  if (name.length > 120 || notes.length > 1000) return NextResponse.json({ ok: false, message: "That's a bit long." }, { status: 400 });

  const site = await getBookableSite(slug);
  if (!site) return NextResponse.json({ ok: false, message: "This site isn't taking bookings." }, { status: 404 });

  const token = await ownerAccessToken(site);
  if (!token) return NextResponse.json({ ok: false, message: "Online booking isn't switched on yet — please call us." }, { status: 409 });

  const r = await bookForSite(site, token, {
    name,
    email: email || null,
    phone: phone || null,
    notes: notes || null,
    startISO,
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
