import { NextResponse } from "next/server";

import { normalizePhone, verifyTwilioSignature } from "@/lib/sms";

export const dynamic = "force-dynamic";

// Where inbound CALLS to the Twilio number ring through to — the Retell AI
// receptionist ("Ivy"). Overridable via env; defaults to the live TBJ voice line.
const VOICE_FORWARD_TO = normalizePhone(process.env.VOICE_FORWARD_TO) || "+14807642121";

function xml(body: string) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

/**
 * Twilio Voice webhook. When someone CALLS the ThinkBigJoe number, Twilio POSTs
 * here and we return TwiML that dials the Retell AI receptionist, so the call is
 * answered by "Ivy" instead of ringing a dead SMS-only line. The caller's number
 * passes through as caller ID (standard forwarding), which Retell's identify flow
 * uses to recognize returning claimants.
 *
 * Configure as the Twilio number's Voice → "A call comes in" webhook (HTTP POST):
 * https://thinkbigjoe.com/api/twilio/voice
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const url = `${proto}://${host}/api/twilio/voice`;
  if (!verifyTwilioSignature(url, params, req.headers.get("x-twilio-signature"))) {
    console.warn("[twilio:voice] bad Twilio signature from", host);
    return new NextResponse("Forbidden", { status: 403 });
  }

  // <Dial> the AI number. `answerOnBridge` connects the legs cleanly; the default
  // caller ID (the original caller) is what Retell wants for identify.
  return xml(
    `<Response><Dial answerOnBridge="true" timeout="25">${VOICE_FORWARD_TO}</Dial></Response>`,
  );
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "twilio/voice", forwardsTo: VOICE_FORWARD_TO });
}
