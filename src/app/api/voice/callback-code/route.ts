import { NextResponse } from "next/server";
import { and, eq, or, sql } from "drizzle-orm";

import { db, callbackCodes, activityLog } from "@/db";
import { notifyTelegram } from "@/lib/telegram";
import { callerPhone, parseRetellArgs, voiceAuthed } from "@/lib/voice-booking";

export const dynamic = "force-dynamic";

/**
 * Retell custom function: `verify_callback_code`.
 * A caller who was given a priority callback code (dropped in our outreach text or
 * a voicemail) reads it to Ivy. We check it against `callback_codes`; if it's active
 * and unexpired, Ivy is told to warm-transfer the caller to Joe (via the
 * transfer_to_joe tool). Invalid/absent → Ivy just continues the normal flow, so
 * random inbound callers never ring Joe.
 * → { valid, name?, message }
 */
export async function POST(req: Request) {
  if (!voiceAuthed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* fall through — no args */
  }
  const args = parseRetellArgs(body);
  const raw = typeof args.code === "string" ? args.code : "";
  // Callers say codes with spaces/pauses ("seven seven eight eight"); keep digits+letters.
  const code = raw.replace(/[^0-9a-z]/gi, "").toUpperCase();

  if (!code) {
    return NextResponse.json({ valid: false, message: "I didn't catch a code — could you read it again?" });
  }

  const callObj = ((body ?? {}) as Record<string, unknown>).call as Record<string, unknown> | undefined;
  const callId = (typeof callObj?.call_id === "string" && callObj.call_id) || null;
  const fromPhone = callerPhone(body) || null;

  // Active + unexpired match.
  const [row] = await db
    .select()
    .from(callbackCodes)
    .where(
      and(
        eq(callbackCodes.code, code),
        eq(callbackCodes.status, "active"),
        or(sql`${callbackCodes.expiresAt} IS NULL`, sql`${callbackCodes.expiresAt} > now()`),
      ),
    )
    .limit(1);

  if (!row) {
    // Distinguish an expired/used code from a never-existed one for the log only.
    await db
      .insert(activityLog)
      .values({
        actor: "ivy",
        eventType: "callback_code_denied",
        summary: `🔒 Callback code "${code}" not valid (from ${fromPhone || "unknown"})`,
        metadata: { code, fromPhone, callId },
      })
      .catch(() => {});
    return NextResponse.json({
      valid: false,
      message: "That code isn't matching anything on my end. No worries — I can still help you here.",
    });
  }

  const name = (row.leadName || "").trim();
  const phoneMatch = Boolean(fromPhone && row.contactPhone && last10(fromPhone) === last10(row.contactPhone));

  // Record the use (reusable within its window — don't burn it on a dropped call).
  await db
    .update(callbackCodes)
    .set({
      usedAt: row.usedAt ?? new Date().toISOString(),
      usedCount: (row.usedCount ?? 0) + 1,
      usedCallId: callId ?? row.usedCallId ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(callbackCodes.id, row.id))
    .catch(() => {});

  await db
    .insert(activityLog)
    .values({
      actor: "ivy",
      eventType: "callback_code_verified",
      summary: `✅ Priority callback${name ? ` from ${name}` : ""} — code "${code}" valid, transferring to Joe`,
      metadata: { code, name, contactPhone: row.contactPhone, fromPhone, phoneMatch, callId },
    })
    .catch(() => {});

  notifyTelegram(
    `📞➡️ Priority callback${name ? ` from ${name}` : ""} (code ${code})${fromPhone ? ` at ${fromPhone}` : ""} — Ivy is transferring them to you.`,
  ).catch(() => {});

  return NextResponse.json({
    valid: true,
    name,
    // Ivy reads this, then invokes transfer_to_joe.
    message: `Verified${name ? ` — this is ${name}` : ""}. Tell them you're connecting them to Joe now, then transfer the call.`,
  });
}

function last10(p: string): string {
  return p.replace(/[^0-9]/g, "").slice(-10);
}
