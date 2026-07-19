import { NextResponse } from "next/server";

import { normalizePhone, verifyTwilioSignature } from "@/lib/sms";

export const dynamic = "force-dynamic";

const VOICE_FALLBACK_TO =
  normalizePhone(process.env.VOICE_FALLBACK_TO) || normalizePhone(process.env.CALLBACK_TRANSFER_TO);

function xml(body: string) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

/**
 * `action` target of the <Dial> in ../route.ts — Twilio POSTs here when the dial ENDS,
 * whatever the reason.
 *
 * The point of this route: before it existed, a <Dial> with no `action` meant that if Retell
 * failed to answer within the timeout, the TwiML simply ran out and Twilio hung up. The caller
 * got ~25 seconds of ringing and then a disconnect, with nothing to tell us it happened.
 *
 * DialCallStatus values: completed | answered | busy | no-answer | failed | canceled.
 * Only `completed`/`answered` mean the caller actually reached Ivy.
 *
 * Returning empty TwiML here is what ENDS a successful call — we must not re-dial after a
 * normal hangup, or every finished conversation would immediately ring someone else.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const url = `${proto}://${host}/api/twilio/voice/failed`;
  if (!verifyTwilioSignature(url, params, req.headers.get("x-twilio-signature"))) {
    console.warn("[twilio:voice:failed] bad Twilio signature from", host);
    return new NextResponse("Forbidden", { status: 403 });
  }

  const status = params.DialCallStatus || "unknown";

  // The caller reached Ivy and the conversation ended normally. Nothing more to do.
  if (status === "completed" || status === "answered") {
    return xml(`<Response></Response>`);
  }

  // Ivy did not pick up. This is the case that used to drop the caller silently.
  console.error(
    `[twilio:voice:failed] AI leg did not answer (DialCallStatus=${status}) from=${params.From || "?"} — falling back`,
  );

  if (VOICE_FALLBACK_TO) {
    return xml(
      `<Response><Say voice="Polly.Joanna">One moment, connecting you.</Say>` +
        `<Dial timeout="30">${VOICE_FALLBACK_TO}</Dial></Response>`,
    );
  }

  // No human to fall back to — say something true rather than hanging up on silence.
  return xml(
    `<Response><Say voice="Polly.Joanna">Sorry, we can't take your call right now. ` +
      `Please try again shortly.</Say></Response>`,
  );
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "twilio/voice/failed",
    fallbackTo: VOICE_FALLBACK_TO ?? null,
  });
}
