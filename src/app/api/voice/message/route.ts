import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, calls } from "@/db";
import { sendSms, normalizePhone } from "@/lib/sms";
import { parseRetellArgs, voiceAuthed, callerPhone } from "@/lib/voice-booking";
import { calledNumber, siteFromCall, type VoiceTenant } from "@/lib/voice-tenant";

export const dynamic = "force-dynamic";

/**
 * Retell custom function: `take_message` — the Tier-1 product.
 *
 * The receptionist calls this before ending EVERY call (including wrong numbers and robocalls, so
 * the owner can see what the line filtered out). Two jobs, in this order:
 *   1. WRITE THE ROW. Retell's retention is not our database; if we don't persist it here, the
 *      call is gone. This must happen even when we can't notify anyone.
 *   2. TEXT THE OWNER. A lead the owner learns about tomorrow is a lead they lost.
 *
 * Tenancy comes from the DIALLED number (see voice-tenant.ts) — never from an argument, so a caller
 * can't talk the agent into filing a message against someone else's business.
 *
 * HONESTY RULE: the spoken reply only claims someone was notified when the SMS actually sent.
 * Telling a caller with a burst pipe "I've let them know" when the text silently failed is worse
 * than saying nothing — they stop calling and wait. `/api/voice/support` gets this wrong today
 * (returns ok:true after a swallowed email failure); do not copy it.
 */

/** Retell retries a failed tool call up to 2x, so every write here is keyed on the call id. */
function retellCallId(body: unknown): string | undefined {
  const call = ((body ?? {}) as Record<string, unknown>).call as Record<string, unknown> | undefined;
  const raw = call?.call_id ?? (body as Record<string, unknown> | undefined)?.call_id;
  return typeof raw === "string" && raw ? raw : undefined;
}

/** Retell timestamps are epoch MILLISECONDS. Off-by-1000 here shows every call as 1970. */
function startedAtIso(body: unknown): string {
  const call = ((body ?? {}) as Record<string, unknown>).call as Record<string, unknown> | undefined;
  const ms = call?.start_timestamp;
  if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  return new Date().toISOString();
}

function str(v: unknown, max = 2000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

const URGENCIES = new Set(["emergency", "urgent", "routine"]);

/**
 * Retell USUALLY serializes tool arguments as strings, but not always — a JSON boolean `false`
 * survives `parseRetellArgs` intact, and the old string-only check classified it as a real lead:
 * the exact inverse of the intent, texting the owner for every robocall.
 *
 * Asymmetric on purpose. Only an explicit negative suppresses the notification; anything we don't
 * recognise stays a lead, because a spam text costs the owner two seconds and a missed emergency
 * costs them the job.
 */
function isRealLeadFlag(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return !(s === "false" || s === "0" || s === "no");
}

/** The lock-screen text. Urgency and the callback number lead because that's all that fits. */
function composeSms(t: VoiceTenant, m: {
  callerName: string;
  callback: string;
  address: string;
  problem: string;
  urgency: string;
}): string {
  const flag =
    m.urgency === "emergency" ? "🚨 EMERGENCY" : m.urgency === "urgent" ? "⚠️ URGENT" : "New call";
  const who = m.callerName || "Caller";
  // Number first after the flag: the owner's next action is to press-and-hold it to dial back.
  const lines = [
    `${flag} — ${who}`,
    m.callback ? `Call back: ${m.callback}` : "No callback number given",
    m.problem ? `Needs: ${m.problem.slice(0, 300)}` : null,
    m.address ? `At: ${m.address.slice(0, 160)}` : null,
    `(via your ${t.businessName} line)`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

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
  const callerName = str(args.caller_name, 120);
  const address = str(args.address, 300);
  const problem = str(args.problem, 2000);
  const rawUrgency = str(args.urgency, 20).toLowerCase();
  const urgency = URGENCIES.has(rawUrgency) ? rawUrgency : "routine";
  const isRealLead = isRealLeadFlag(args.is_real_lead);
  // Fall back to the caller ID when the caller wouldn't give a number.
  const callback = normalizePhone(str(args.callback_number, 40)) ?? callerPhone(body) ?? "";

  // The tenant lookup hits the database, so it can throw like any other query. Letting that
  // propagate turns a blip into a 500 with a caller on the line — Retell reads a generic failure
  // line and the message is lost. Degrade to the same graceful, non-committal reply as an
  // unknown line; the distinction is for our logs, not the caller.
  let tenant: VoiceTenant | null = null;
  try {
    tenant = await siteFromCall(body);
  } catch (err) {
    console.error("[voice/message] tenant lookup failed for", calledNumber(body), err);
  }

  if (!tenant) {
    // The line isn't ours, or it's paused/released, or the lookup above failed. Nothing to write
    // (site_id is NOT NULL) and nobody to notify — but never 500 mid-call, and never claim we
    // delivered anything.
    console.error("[voice/message] no tenant for dialled number", calledNumber(body));
    return NextResponse.json({
      ok: false,
      message:
        "I've got your details written down. I'm not able to confirm delivery right now, so if it's urgent please try the office directly.",
    });
  }

  const callId = retellCallId(body);

  // Persist FIRST, notify second — so a failed text still leaves a recoverable record.
  let saved = false;
  try {
    const values = {
      siteId: tenant.siteId,
      retellCallId: callId ?? null,
      fromNumber: callerPhone(body) ?? null,
      toNumber: tenant.lineNumber,
      startedAt: startedAtIso(body),
      callerName: callerName || null,
      callbackNumber: callback || null,
      address: address || null,
      problem: problem || null,
      urgency,
      isRealLead,
      disposition: "message",
    };
    const insert = db.insert(calls).values(values);
    // A tool retry (or a call_started webhook that already opened the row) must update, not
    // duplicate. Deliberately does NOT touch notified_at — that's owned by the send below.
    await (callId
      ? insert.onConflictDoUpdate({
          target: calls.retellCallId,
          set: {
            callerName: values.callerName,
            callbackNumber: values.callbackNumber,
            address: values.address,
            problem: values.problem,
            urgency: values.urgency,
            isRealLead: values.isRealLead,
            disposition: values.disposition,
          },
        })
      : insert);
    saved = true;
  } catch (err) {
    console.error("[voice/message] insert failed:", err);
  }

  // Robocalls and wrong numbers are logged but never texted — waking the owner for a spam call is
  // how a customer decides the whole service is noise and turns it off.
  if (!isRealLead) {
    return NextResponse.json({
      ok: true,
      message: "Thanks for calling. Have a good one.",
    });
  }

  let notified = false;
  if (tenant.notifyTo) {
    // Same reasoning as the tenant lookup: a transport throw here must degrade to "we couldn't
    // notify" (which the reply and the portal both already handle honestly), not to a 500 that
    // drops the caller after we've already persisted their message.
    try {
      const res = await sendSms(tenant.notifyTo, composeSms(tenant, {
        callerName,
        callback,
        address,
        problem,
        urgency,
      }));
      notified = "ok" in res && res.ok === true;
      if (!notified) console.error("[voice/message] notify failed for site", tenant.siteId, res);
    } catch (err) {
      console.error("[voice/message] notify threw for site", tenant.siteId, err);
    }
  } else {
    console.error("[voice/message] no notifyTo configured for site", tenant.siteId);
  }

  if (notified && callId && saved) {
    try {
      await db
        .update(calls)
        .set({ notifiedAt: new Date().toISOString() })
        .where(eq(calls.retellCallId, callId));
    } catch (err) {
      // The text genuinely went out; a failed timestamp write shouldn't change what we tell the
      // caller. It only means the portal shows this one as un-notified.
      console.error("[voice/message] notified_at update failed:", err);
    }
  }

  // What we say is gated on what actually happened.
  const message = notified
    ? urgency === "emergency"
      ? `I've sent that through as an emergency and they'll call you back at ${callback || "the number you called from"} as soon as they can.`
      : `I've passed that along and someone will get back to you at ${callback || "the number you called from"}.`
    : `I've got all your details down${callback ? ` and the number ${callback}` : ""}, and someone will follow up. If it's urgent, it's worth trying the office directly too.`;

  return NextResponse.json({ ok: true, message });
}
