import { getPayload } from "payload";
import { NextResponse } from "next/server";

import config from "@payload-config";
import { issueBookingToken } from "@/lib/booking-token";

/**
 * Homepage contact-form handler (plain HTML form POST). Stores the lead and
 * redirects straight into the booking flow with the calendar unlocked — the
 * form submission IS the intake.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const company = String(form.get("company") || "").trim();
  const message = String(form.get("message") || "").trim();
  // Honeypot — bots fill every field; humans never see this one.
  const website = String(form.get("website") || "").trim();

  const back = new URL("/#contact", req.url);

  if (website) {
    // Silently accept bot submissions without storing anything.
    return NextResponse.redirect(back, 303);
  }
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.redirect(
      new URL("/?error=missing-fields#contact", req.url),
      303,
    );
  }

  try {
    const payload = await getPayload({ config });
    const lead = await payload.create({
      collection: "leads",
      overrideAccess: true,
      data: {
        name,
        email,
        company: company || undefined,
        problem: message || undefined,
        source: "contact-form" as never,
        sourcePath: "/",
        status: "new" as never,
      },
    });

    const dest = new URL("/book-appointment", req.url);
    dest.searchParams.set("t", issueBookingToken(String(lead.id)));
    return NextResponse.redirect(dest, 303);
  } catch (err) {
    console.error("[lead] failed to create lead:", err);
    return NextResponse.redirect(new URL("/?error=lead#contact", req.url), 303);
  }
}
