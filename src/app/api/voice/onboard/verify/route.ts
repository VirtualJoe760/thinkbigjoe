import { NextResponse } from "next/server";

import { parseRetellArgs, voiceAuthed } from "@/lib/voice-booking";
import { verifyChallenge } from "@/lib/voice-onboarding";

export const dynamic = "force-dynamic";

/**
 * Ivy tool: `verify_receptionist_code`.
 *
 * Step 2 of 3. The caller reads back the code we sent to their on-file number. This is the step
 * that turns "identified" into "authorized" — nothing may write receptionist config until it passes.
 *
 * `site_id` comes from OUR previous response (../start), not from the caller. Retell threads it
 * back through the tool arguments. That matters: if the caller could name the site here, the whole
 * verification would be bypassable by simply claiming a different one.
 */
export async function POST(req: Request) {
  if (!voiceAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const args = parseRetellArgs(body);
    const siteId = Number(args.site_id);
    const code = String(args.code ?? "");

    if (!Number.isFinite(siteId)) {
      return NextResponse.json({
        verified: false,
        message: "Let's start again — could you read me your account number?",
      });
    }

    const res = await verifyChallenge(siteId, code);
    if (res.ok) {
      return NextResponse.json({
        verified: true,
        message:
          "Perfect, that's you. I'm going to ask you a handful of questions about how you want " +
          "your phone answered — there's no wrong answer, and you can change any of it later.",
      });
    }

    // Each failure gets its own spoken line: this caller has already proven nothing, but they are
    // also probably the real owner fumbling a code, so being useful here costs us nothing.
    const spoken: Record<typeof res.reason, string> = {
      no_challenge:
        "I don't have a code outstanding for that account. Want me to send a fresh one?",
      expired: "That code has expired — I can send you a new one if you'd like.",
      locked:
        "That's too many tries, so I've locked this off for now. Someone from the team will " +
        "reach out to get you set up.",
      wrong:
        res.reason === "wrong" && res.attemptsLeft
          ? `That's not matching what I've got. Want to try again? You've got ${res.attemptsLeft} more ${res.attemptsLeft === 1 ? "try" : "tries"}.`
          : "That's not matching what I've got.",
    };

    return NextResponse.json({ verified: false, message: spoken[res.reason] });
  } catch (err) {
    console.error("[voice/onboard/verify] threw:", err);
    return NextResponse.json({
      verified: false,
      message: "Something went wrong on my end — let me have someone from the team call you back.",
    });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "voice/onboard/verify" });
}
