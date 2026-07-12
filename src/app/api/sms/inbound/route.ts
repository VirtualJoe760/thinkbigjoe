import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db, activityLog, smsConversations } from "@/db";
import { notifyTelegram } from "@/lib/telegram";
import { sendAdminAlert } from "@/lib/email";
import { findProspectByPhone, markProspectOptedOut } from "@/lib/forge-optout";
import {
  encodeThreadCode,
  isOptOut,
  normalizePhone,
  parseThreadCode,
  sendSms,
  smsForwardTo,
  verifyTwilioSignature,
} from "@/lib/sms";

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";

// Empty TwiML — tells Twilio "no auto-reply" (we relay/forward out-of-band).
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
function twiml() {
  return new NextResponse(EMPTY_TWIML, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

/**
 * Inbound SMS webhook — the two-way relay between leads and Joe's Google Voice.
 *
 * A LEAD texts the ThinkBigJoe number → we upsert a conversation, then forward
 * the text to Joe's GV (SMS_FORWARD_TO) tagged with a short code like `#a3`.
 *
 * JOE replies from his GV (From === SMS_FORWARD_TO) → we route it back to a lead:
 *   • `#a3 your message`  → relayed to conversation #a3's contact
 *   • `your message`      → relayed to the most-recent inbound conversation
 *   • `#list`             → Joe gets the active conversations + their codes
 * Twilio's Messaging Service sticky-sender keeps each lead seeing one number.
 *
 * Configure this URL as the Messaging Service's "A message comes in" webhook:
 * https://thinkbigjoe.com/api/sms/inbound
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;

  // Twilio signs the exact public URL it was configured to call. Behind Vercel,
  // req.url is internal — rebuild it from the forwarded host.
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const url = `${proto}://${host}/api/sms/inbound`;
  const signature = req.headers.get("x-twilio-signature");

  if (!verifyTwilioSignature(url, params, signature)) {
    console.warn("[sms:inbound] bad Twilio signature from", host);
    return new NextResponse("Forbidden", { status: 403 });
  }

  const from = normalizePhone(params.From);
  const body = (params.Body || "").trim();
  const forwardTo = smsForwardTo();

  // ── JOE replying from his Google Voice → relay to a lead ──────────────────
  if (forwardTo && from === forwardTo) {
    await handleJoeReply(body);
    return twiml();
  }

  // ── A LEAD texting in → log, remember the conversation, forward to Joe ─────
  const sender = from || params.From || "unknown";
  const optOut = isOptOut(body);

  // Upsert the conversation so replies can route back. (Opt-outs still get a row
  // logged but we don't invite Joe to reply to a STOP.)
  let code = "";
  try {
    const [row] = await db
      .insert(smsConversations)
      .values({ contactPhone: sender, lastInboundAt: new Date().toISOString(), lastDirection: "inbound" })
      .onConflictDoUpdate({
        target: smsConversations.contactPhone,
        set: { lastInboundAt: new Date().toISOString(), lastDirection: "inbound", updatedAt: new Date().toISOString() },
      })
      .returning({ id: smsConversations.id });
    if (row) code = encodeThreadCode(row.id);
  } catch (err) {
    console.error("[sms:inbound] conversation upsert failed:", err);
  }

  // Resolve which prospect this number belongs to, so the reply lands on their
  // lead timeline (and marks them "replied"/engaged), not just a floating log row.
  const prospect = await findProspectByPhone(sender).catch(() => null);

  try {
    await db.insert(activityLog).values({
      actor: "twilio",
      eventType: optOut ? "sms_opt_out" : "sms_inbound",
      summary: optOut
        ? `📵 ${prospect?.businessName || sender} texted STOP (opted out)`
        : `📱 ${prospect?.businessName ? prospect.businessName + " " : ""}${code ? code + " " : ""}replied: ${body.slice(0, 200)}`,
      metadata: { detail: { siteId: prospect?.id ?? null, note: body, from: sender, code }, from: sender, body, code, messageSid: params.MessageSid || null, to: params.To || null },
    });
  } catch (err) {
    console.error("[sms:inbound] activity log failed:", err);
  }

  // On STOP: flag the prospect as opted-out and move them to the Declined queue —
  // visible so Joe can call once more before removing. NOT auto-deleted/blacklisted.
  let optedName: string | null = null;
  if (optOut) {
    try {
      optedName = await markProspectOptedOut(sender);
    } catch (err) {
      console.error("[sms:inbound] opt-out mark failed:", err);
    }
  }
  const optedNote = optedName ? ` ${optedName} → Declined queue (call to confirm, then remove).` : "";

  if (forwardTo) {
    const note = optOut
      ? `🛑 ${prospect?.businessName || sender} replied STOP — opted out of texts.${optedNote}`
      : `📱 ${code} — ${prospect?.businessName || sender} replied:\n\n${body}\n\n↩︎ Reply "${code} your message" to answer (or just reply for the latest). "#list" to see all.`;
    const res = await sendSms(forwardTo, note);
    if ("ok" in res && !res.ok) console.error("[sms:inbound] forward to GV failed:", res.error);
  }

  await notifyTelegram(
    optOut ? `📵 SMS opt-out from ${sender}.${optedNote}` : `📱 Inbound SMS ${code} from ${sender}:\n${body || "(no text)"}`,
  );

  // Email notification to the admin address (josephsardella@gmail.com by default) —
  // so SMS replies/opt-outs land in the right inbox, independent of Google Voice.
  await sendAdminAlert(
    optOut
      ? {
          subject: `SMS opt-out — ${sender}`,
          heading: "Prospect opted out (STOP)",
          message: `${sender} replied STOP and is now opted out of TBJ texts.${optedNote}`,
          ctaUrl: `${SITE}/command/leads`,
          ctaLabel: "View leads",
        }
      : {
          subject: `New text reply from ${sender}`,
          heading: `${sender} replied${code ? ` (${code})` : ""}`,
          message: body || "(no text)",
          ctaUrl: `${SITE}/command/leads`,
          ctaLabel: "View & reply",
        },
  ).catch((err) => console.error("[sms:inbound] admin alert email failed:", err));

  return twiml();
}

/**
 * Route Joe's GV reply back to a lead. Parses a leading `#code`; otherwise sends
 * to the most-recent inbound conversation. `#list` returns the active threads.
 */
async function handleJoeReply(body: string) {
  const forwardTo = smsForwardTo();
  if (!forwardTo) return;

  const notifyJoe = (text: string) => sendSms(forwardTo, text);

  if (/^\s*#?(list|threads|who)\s*$/i.test(body)) {
    const rows = await db
      .select()
      .from(smsConversations)
      .orderBy(desc(smsConversations.lastInboundAt))
      .limit(15);
    if (rows.length === 0) return void notifyJoe("No SMS conversations yet.");
    const lines = rows.map((r) => `${encodeThreadCode(r.id)}  ${r.contactPhone}`);
    return void notifyJoe(`Active SMS threads (newest first):\n${lines.join("\n")}\n\nReply "#code message" to answer one.`);
  }

  const parsed = parseThreadCode(body);
  let target: { id: number; contactPhone: string } | null = null;
  let message = body.trim();

  if (parsed) {
    const [row] = await db
      .select({ id: smsConversations.id, contactPhone: smsConversations.contactPhone })
      .from(smsConversations)
      .where(eq(smsConversations.id, parsed.id))
      .limit(1);
    if (!row) return void notifyJoe(`No thread "#${parsed.id.toString(36)}". Text "#list" to see active threads.`);
    target = row;
    message = parsed.rest;
  } else {
    const [row] = await db
      .select({ id: smsConversations.id, contactPhone: smsConversations.contactPhone })
      .from(smsConversations)
      .orderBy(desc(smsConversations.lastInboundAt))
      .limit(1);
    if (!row) return void notifyJoe("No one has texted in yet — nobody to reply to.");
    target = row;
  }

  if (!message) {
    return void notifyJoe(`Add a message after ${encodeThreadCode(target.id)} and I'll send it to ${target.contactPhone}.`);
  }

  const res = await sendSms(target.contactPhone, message);
  if ("ok" in res && !res.ok) {
    return void notifyJoe(`❌ Couldn't send to ${target.contactPhone}: ${res.error}`);
  }
  if ("skipped" in res) {
    return void notifyJoe("❌ SMS isn't configured — couldn't send.");
  }

  await db
    .update(smsConversations)
    .set({ lastOutboundAt: new Date().toISOString(), lastDirection: "outbound", updatedAt: new Date().toISOString() })
    .where(eq(smsConversations.id, target.id));

  try {
    await db.insert(activityLog).values({
      actor: "joe",
      eventType: "sms_outbound",
      summary: `📤 ${encodeThreadCode(target.id)} → ${target.contactPhone}: ${message.slice(0, 200)}`,
      metadata: { to: target.contactPhone, body: message, code: encodeThreadCode(target.id), via: "gv-relay" },
    });
  } catch (err) {
    console.error("[sms:inbound] outbound log failed:", err);
  }

  // Confirm to Joe (esp. useful when he didn't specify a code).
  if (!parsed) {
    await notifyJoe(`✅ Sent to ${target.contactPhone} (${encodeThreadCode(target.id)}). To answer someone else: "#code message".`);
  }
}

// Twilio hits the webhook with POST; a GET is a health/config check.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "sms/inbound" });
}
