import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { callerPhone, parseRetellArgs, voiceAuthed } from "@/lib/voice-booking";

export const dynamic = "force-dynamic";

function rowsOf(res: unknown): Record<string, unknown>[] {
  return (Array.isArray(res) ? res : (res as { rows?: unknown }).rows ?? []) as Record<string, unknown>[];
}

/**
 * Retell custom function: `identify_caller`.
 * Called at the START of a call — matches the caller's phone number (from Retell's call payload,
 * or a `phone` arg) to a forge_sites lead so the agent can greet them by business name and know
 * where they are in the pipeline. Read-only; returns NO claim code (that stays in their email/text).
 * → { found, businessName?, firstName?, stage?, message }
 *   stage: "preview" | "built" | "claimed" | "live"
 */
export async function POST(req: Request) {
  if (!voiceAuthed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* no-arg call — caller phone still comes from the call payload */
  }
  const args = parseRetellArgs(body);
  const rawPhone = (typeof args.phone === "string" && args.phone) || callerPhone(body) || "";
  const last10 = rawPhone.replace(/[^0-9]/g, "").slice(-10);
  if (last10.length < 10) {
    return NextResponse.json({ found: false, message: "" }); // no usable caller ID — agent just greets normally
  }

  const site = rowsOf(
    await db.execute(sql`
      SELECT business_name, owner_name, status, claimed_by_user_id, one_time_paid, live_url
      FROM forge_sites
      WHERE right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${last10}
        AND status <> 'deleted'
      ORDER BY (claimed_by_user_id IS NOT NULL) DESC, updated_at DESC
      LIMIT 1`),
  )[0];

  if (!site) {
    return NextResponse.json({ found: false, message: "" });
  }

  const businessName = String(site.business_name ?? "your business");
  const firstName = String(site.owner_name ?? "").trim().split(/\s+/)[0] || "";
  const claimed = Boolean(site.claimed_by_user_id);
  const paid = Boolean(site.one_time_paid);
  const built = site.status === "built" || Boolean(site.live_url);

  const stage = paid ? "live" : claimed ? "claimed" : built ? "built" : "preview";
  const nextStep = {
    live: "Their site is already live — this is likely a support or how-to question; help them or offer Joe.",
    claimed: "They've claimed it but haven't picked a plan yet — nudge them to choose a plan in the portal to go live.",
    built: "We built their site and it's waiting to be claimed — walk them through creating an account and claiming it.",
    preview: "They have a preview reserved — get them to create an account and claim it (claiming builds the full site).",
  }[stage];

  return NextResponse.json({
    found: true,
    businessName,
    firstName,
    stage,
    // The agent reads a natural greeting; the nextStep guides what to do after.
    message: `This looks like ${businessName}${firstName ? ` (owner ${firstName})` : ""}. ${nextStep}`,
  });
}
