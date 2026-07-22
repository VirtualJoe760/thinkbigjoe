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
  const phone = String(form.get("phone") || "").trim();
  // A2P 10DLC consent capture — itemized, so we have a record of exactly what the
  // contact agreed to (transactional SMS, marketing SMS, email).
  const smsTransactional = String(form.get("sms_transactional") || "") === "yes";
  const smsMarketing = String(form.get("sms_marketing") || "") === "yes";
  const emailConsent = String(form.get("email_consent") || "") === "yes";
  // Where to send them back — the dedicated /contact page or the homepage anchor.
  const fromContactPage = String(form.get("source_path") || "") === "/contact";
  const okUrl = fromContactPage ? "/contact?sent=1" : "/?sent=1#contact";
  const errUrl = fromContactPage ? "/contact?error=contact" : "/?error=contact#contact";
  // Honeypot — bots fill every field; humans never see this one.
  const website = String(form.get("website") || "").trim();
  // Paid-traffic attribution, injected as hidden inputs by <AttributionFields /> (docs/ADS.md).
  const attr = (k: string, max = 200) => {
    const v = String(form.get(k) || "").trim();
    return v ? v.slice(0, max) : null;
  };

  if (website) {
    return NextResponse.redirect(new URL(okUrl, req.url), 303);
  }
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message) {
    return NextResponse.redirect(new URL(errUrl, req.url), 303);
  }

  const consentSummary = [
    smsTransactional && "transactional SMS",
    smsMarketing && "marketing SMS",
    emailConsent && "email",
  ].filter(Boolean).join(", ") || "none";

  try {
    await db.insert(leads).values({
      name,
      email,
      phone: phone || null,
      problem: message,
      notes: `Consent: ${consentSummary}${phone ? ` · phone ${phone}` : ""}`,
      source: "contact-form",
      sourcePath: fromContactPage ? "/contact" : "/",
      status: "new",
      utmSource: attr("utm_source"),
      utmMedium: attr("utm_medium"),
      utmCampaign: attr("utm_campaign"),
      utmContent: attr("utm_content"),
      utmTerm: attr("utm_term"),
      fbclid: attr("fbclid", 500),
      referrer: attr("attr_referrer", 500),
      landingPath: attr("attr_landing_path"),
    });

    sendNotificationEmail({
      to: process.env.EMAIL_BCC || "josephsardella@gmail.com",
      subject: `New message from ${name}`,
      heading: "New contact message",
      message: `${name} (${email})${phone ? ` · ${phone}` : ""}<br/>Consent: ${consentSummary}<br/><br/>${message.replace(/</g, "&lt;").replace(/\n/g, "<br/>")}`,
    }).catch(() => {});

    notifyTelegram(
      `💬 <b>New contact message</b>\n${name} (${email})${phone ? ` · ${phone}` : ""}\nConsent: ${consentSummary}\n\n${message.slice(0, 500)}`,
    ).catch(() => {});
  } catch (err) {
    console.error("[contact] failed:", err);
    // Still bounce them to the success state — the message attempt shouldn't
    // surface a scary error; it's logged for us.
  }

  return NextResponse.redirect(new URL(okUrl, req.url), 303);
}
