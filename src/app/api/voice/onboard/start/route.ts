import { NextResponse } from "next/server";

import { parseRetellArgs, voiceAuthed } from "@/lib/voice-booking";
import {
  MAX_SITES_PER_CALL,
  callChallengeCount,
  challengeThrottled,
  lastChallengeWentUnansweredBySms,
  onFileDestination,
  planIncludesReceptionist,
  startChallenge,
  targetByAccountNumber,
} from "@/lib/voice-onboarding";

export const dynamic = "force-dynamic";

/**
 * Ivy tool: `start_receptionist_setup`.
 *
 * Step 1 of 3. The caller reads their account number; we look up the business, check they're on a
 * plan that includes the receptionist, and text (or email) a one-time code to a destination
 * ALREADY ON FILE. Ivy then asks them to read that code back — see ../verify.
 *
 * ORACLE DISCIPLINE. Account numbers are sequential from 100001, so this endpoint is trivially
 * enumerable. Every unsuccessful outcome — no such account, unclaimed site, wrong plan, no
 * contactable destination — returns the SAME spoken sentence and `found: false`. A caller must not
 * be able to distinguish "that business doesn't exist" from "that business exists but isn't on the
 * voice plan", because the second one confirms a competitor is a customer.
 *
 * The business name IS spoken back on success, which is a deliberate trade: the real owner needs to
 * hear that we found the right record, and by that point we have already sent the code to a number
 * only the real owner can read.
 */
const DEAD_END =
  "I couldn't get that set up from here — I'll have someone from the team reach out to you directly.";

export async function POST(req: Request) {
  if (!voiceAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const args = parseRetellArgs(body);
    const accountNumber = String(args.account_number ?? "").trim();
    // Ivy may ask for email instead — when the caller says the text isn't coming, or that the
    // number we hold is their desk phone. This chooses BETWEEN on-file destinations; it never
    // accepts an address from the caller.
    const prefer = String(args.send_by ?? "").toLowerCase() === "email" ? ("email" as const) : null;
    const call = (body as Record<string, unknown>)?.call as Record<string, unknown> | undefined;
    const retellCallId = typeof call?.call_id === "string" ? call.call_id : null;

    const target = await targetByAccountNumber(accountNumber);

    // Collapse every failure into one indistinguishable answer. Log the real reason for us.
    if (!target) {
      console.warn(`[voice/onboard/start] no account for "${accountNumber}"`);
      return NextResponse.json({ found: false, message: DEAD_END });
    }
    if (!target.userId) {
      console.warn(`[voice/onboard/start] site ${target.siteId} is unclaimed`);
      return NextResponse.json({ found: false, message: DEAD_END });
    }
    if (!planIncludesReceptionist(target.plan) || !target.oneTimePaid) {
      console.warn(
        `[voice/onboard/start] site ${target.siteId} not on a voice plan (plan=${target.plan} paid=${target.oneTimePaid})`,
      );
      return NextResponse.json({ found: false, message: DEAD_END });
    }

    // Per-CALL cap. challengeThrottled below is per-site — i.e. per victim — which imposes no cost
    // on sweeping DIFFERENT account numbers, since every account is its own bucket. Each eligible
    // hit leaks business_name + site_id and fires a real SMS, so an unthrottled sweep is both a
    // customer-list oracle and owner-facing text-bombing on our bill.
    if (!retellCallId) {
      console.warn("[voice/onboard/start] refusing: no call_id on the request");
      return NextResponse.json({ found: false, message: DEAD_END });
    }
    if ((await callChallengeCount(retellCallId)) >= MAX_SITES_PER_CALL) {
      console.warn(`[voice/onboard/start] call ${retellCallId} has already challenged ${MAX_SITES_PER_CALL} sites`);
      return NextResponse.json({ found: false, message: DEAD_END });
    }

    // Same dead-end answer as every other failure: a throttled response would otherwise confirm
    // that this account number is real and eligible, which is exactly what enumeration is after.
    if (await challengeThrottled(target.siteId)) {
      console.warn(`[voice/onboard/start] throttled — site ${target.siteId} has had 3 codes this hour`);
      return NextResponse.json({ found: false, message: DEAD_END });
    }

    // If the last code went out by SMS and was never verified, the text probably didn't land —
    // a landline Lookup couldn't classify, a carrier block, a wrong number on file. Don't repeat
    // the same failure; try the email we already hold.
    const autoFallback = !prefer && (await lastChallengeWentUnansweredBySms(target.siteId));
    const dest = await onFileDestination(target, prefer ?? (autoFallback ? "email" : null));
    if (!dest) {
      console.error(`[voice/onboard/start] site ${target.siteId} has no phone or email on file`);
      return NextResponse.json({ found: false, message: DEAD_END });
    }

    const sent = await startChallenge(target, dest, retellCallId);
    if (!sent.ok) {
      console.error(`[voice/onboard/start] could not deliver code for site ${target.siteId}`);
      return NextResponse.json({ found: false, message: DEAD_END });
    }

    return NextResponse.json({
      found: true,
      site_id: target.siteId,
      business_name: target.businessName,
      message:
        `Great — I've got ${target.businessName}. I've just sent a six-digit code to ${dest.spoken}. ` +
        `Read it back to me when it comes through and we'll get your receptionist set up.`,
    });
  } catch (err) {
    console.error("[voice/onboard/start] threw:", err);
    // Never 5xx mid-call — the caller is on the line.
    return NextResponse.json({ found: false, message: DEAD_END });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "voice/onboard/start" });
}
