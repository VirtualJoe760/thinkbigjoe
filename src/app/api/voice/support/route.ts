import { NextResponse } from "next/server";

import { db, activityLog } from "@/db";
import { sendNotificationEmail } from "@/lib/email";
import { notifyTelegram } from "@/lib/telegram";
import { callerPhone, parseRetellArgs, voiceAuthed } from "@/lib/voice-booking";

export const dynamic = "force-dynamic";

// Interim support queue → Joe's inbox. Swap to support@thinkbigjoe.com once that mailbox + the
// dashboard ticket system exist (a support agent will watch it and answer tickets). See docs/VOICE.md.
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "joe@thinkbigjoe.com";

/**
 * Retell custom function: `create_support_ticket`.
 * When the agent can't resolve something on the call (billing, a technical issue, a complaint, or
 * "I just want Joe"), it takes a message. For now that's an email to Joe + an activity-log entry +
 * a Telegram ping so he can follow up same-day. Booking a call is the other escalation path.
 * Args: { name, issue, phone?, email?, business? }
 */
export async function POST(req: Request) {
  if (!voiceAuthed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Sorry, I didn't catch that." });
  }
  const args = parseRetellArgs(body);
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const issue = typeof args.issue === "string" ? args.issue.trim() : "";
  const email = typeof args.email === "string" ? args.email.trim() : "";
  const business = typeof args.business === "string" ? args.business.trim() : "";
  const phone = (typeof args.phone === "string" && args.phone.trim()) || callerPhone(body) || "";

  if (!issue) {
    return NextResponse.json({ ok: false, message: "What should I tell Joe you need help with?" });
  }

  const lines = [
    business ? `Business: ${business}` : null,
    name ? `Name: ${name}` : null,
    phone ? `Phone: ${phone}` : null,
    email ? `Email: ${email}` : null,
    ``,
    `Issue: ${issue}`,
  ].filter((l): l is string => l !== null);

  try {
    await sendNotificationEmail({
      to: SUPPORT_EMAIL,
      subject: `☎️ Phone support ticket${name ? ` — ${name}` : ""}${business ? ` (${business})` : ""}`,
      heading: "New support ticket from the phone assistant",
      message: lines.join("\n"),
    });
  } catch (err) {
    console.error("[voice/support] email failed:", err);
  }

  await db.insert(activityLog).values({
    actor: "voice",
    eventType: "support_ticket",
    summary: `Support ticket${name ? ` — ${name}` : ""}${business ? ` (${business})` : ""}: ${issue.slice(0, 120)}`,
    metadata: { detail: { name, phone, email, business, issue: issue.slice(0, 1000) } },
  });

  notifyTelegram(
    `🎫 <b>Support ticket</b> (phone)\n${name || "caller"}${phone ? ` · ${phone}` : ""}${business ? `\n${business}` : ""}\n"${issue.slice(0, 200)}"`,
  ).catch(() => {});

  return NextResponse.json({
    ok: true,
    message: `Got it — I've sent that to Joe and he'll follow up${phone ? ` at ${phone}` : " shortly"}. Anything else?`,
  });
}
