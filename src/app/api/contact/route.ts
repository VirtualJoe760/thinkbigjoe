import { NextResponse } from "next/server";

import { db, leads } from "@/db";
import { sendNotificationEmail } from "@/lib/email";
import { notifyTelegram } from "@/lib/telegram";

/**
 * Homepage contact form — a plain "email me" message. Captures the message as a
 * lead (so it shows in the Command Center → Leads, never lost) AND emails the
 * admin (no-ops until SMTP is configured). Does NOT route into the booking
 * flow — the strategy call has its own gated intake at /book-appointment.
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
  const message = String(form.get("message") || "").trim();
  // Honeypot — bots fill every field; humans never see this one.
  const website = String(form.get("website") || "").trim();

  if (website) {
    return NextResponse.redirect(new URL("/?sent=1#contact", req.url), 303);
  }
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message) {
    return NextResponse.redirect(new URL("/?error=contact#contact", req.url), 303);
  }

  try {
    await db.insert(leads).values({
      name,
      email,
      problem: message,
      source: "contact-form",
      sourcePath: "/",
      status: "new",
    });

    sendNotificationEmail({
      to: process.env.EMAIL_BCC || "josephsardella@gmail.com",
      subject: `New message from ${name}`,
      heading: "New contact message",
      message: `${name} (${email})<br/><br/>${message.replace(/</g, "&lt;").replace(/\n/g, "<br/>")}`,
    }).catch(() => {});

    notifyTelegram(
      `💬 <b>New contact message</b>\n${name} (${email})\n\n${message.slice(0, 500)}`,
    ).catch(() => {});
  } catch (err) {
    console.error("[contact] failed:", err);
    // Still bounce them to the success state — the message attempt shouldn't
    // surface a scary error; it's logged for us.
  }

  return NextResponse.redirect(new URL("/?sent=1#contact", req.url), 303);
}
