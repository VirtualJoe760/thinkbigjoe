import { getPayload } from "payload";
import { NextResponse } from "next/server";

import config from "@payload-config";
import { issueBookingToken } from "@/lib/booking-token";
import { verifyTurnstileToken } from "@/lib/turnstile";

const FREE_MAIL = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "aol.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "live.com",
  "msn.com",
]);

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  const company = String(body.company || "").trim();
  const role = String(body.role || "").trim();
  const industry = String(body.industry || "").trim();
  const teamSize = String(body.teamSize || "").trim();
  const timeline = String(body.timeline || "").trim();
  const problem = String(body.problem || "").trim();
  const sourcePath = String(body.sourcePath || "").trim().slice(0, 200);
  const captchaToken = typeof body.captchaToken === "string" ? body.captchaToken : null;

  if (!name || !email || !company || !problem) {
    return NextResponse.json(
      { error: "name, email, company, and problem are required" },
      { status: 400 },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  const remoteIp =
    req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for");
  const human = await verifyTurnstileToken(captchaToken, remoteIp);
  if (!human) {
    return NextResponse.json(
      { error: "Verification failed — please try again" },
      { status: 403 },
    );
  }

  const domain = email.split("@")[1] || "";
  const emailType = FREE_MAIL.has(domain) ? "free" : "business";

  try {
    const payload = await getPayload({ config });
    const lead = await payload.create({
      collection: "leads",
      overrideAccess: true,
      data: {
        name,
        email,
        phone: phone || undefined,
        company,
        role: role || undefined,
        industry: industry || undefined,
        teamSize: (teamSize || undefined) as never,
        timeline: (timeline || undefined) as never,
        problem,
        emailType: emailType as never,
        source: (sourcePath.startsWith("/for/")
          ? "industry-page"
          : "booking-page") as never,
        sourcePath: sourcePath || undefined,
        status: "new" as never,
      },
    });

    return NextResponse.json({
      ok: true,
      bookingToken: issueBookingToken(String(lead.id)),
    });
  } catch (err) {
    console.error("[intake] failed to create lead:", err);
    return NextResponse.json(
      { error: "Could not submit — please try again" },
      { status: 500 },
    );
  }
}
