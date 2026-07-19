import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, forgeSites } from "@/db";
import { normalizePhone } from "@/lib/sms";
import { parseRetellArgs, voiceAuthed } from "@/lib/voice-booking";
import { isVerified } from "@/lib/voice-onboarding";

export const dynamic = "force-dynamic";

/**
 * Ivy tool: `save_receptionist_answers`.
 *
 * Step 3 of 3, and the only one that WRITES. Everything above exists to protect this call: the
 * fields below decide where a business's phone calls and emergency transfers go, so rewriting them
 * is the most valuable thing an attacker could do on this whole system.
 *
 * Two structured phone fields replace the old free-text "Where should it send messages / urgent
 * calls?" box on /portal/receptionist. That box was a real bug, not just poor UX: a customer who
 * wrote "text the office at 480-555-0177, for emergencies call my cell 480-555-0143" had BOTH
 * values resolve to the first number found — so emergencies routed to the office line nobody
 * answers, which is the exact line they bought this product to cover. Asking two questions out
 * loud and validating each one removes the guesswork entirely.
 *
 * Writes are a DRAFT: this never flips receptionist_status to active and never provisions a number.
 * Buying a Retell line costs real money per number, so it stays a human step.
 */

/** Merge only the keys Ivy actually collected, so a partial interview never wipes prior answers. */
function put(target: Record<string, unknown>, key: string, value: unknown) {
  if (value === undefined || value === null) return;
  const s = String(value).trim();
  if (s) target[key] = s;
}

export async function POST(req: Request) {
  if (!voiceAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const args = parseRetellArgs(body);
    const siteId = Number(args.site_id);

    if (!Number.isFinite(siteId)) {
      return NextResponse.json({ saved: false, message: "Let me start you over from the top." });
    }

    // THE GATE. Identification is not authorization — see src/lib/voice-onboarding.ts.
    if (!(await isVerified(siteId))) {
      console.warn(`[voice/onboard/save] unverified write attempt for site ${siteId}`);
      return NextResponse.json({
        saved: false,
        message: "Before I can save any of that, I need to send you a code to confirm it's you.",
      });
    }

    const [site] = await db
      .select({ config: forgeSites.receptionistConfig })
      .from(forgeSites)
      .where(eq(forgeSites.id, siteId))
      .limit(1);
    if (!site) return NextResponse.json({ saved: false, message: "I couldn't find that account." });

    const config: Record<string, unknown> =
      site.config && typeof site.config === "object" ? { ...(site.config as object) } : {};

    put(config, "services", args.services);
    put(config, "greeting", args.greeting);
    put(config, "hours", args.hours);
    put(config, "serviceArea", args.service_area);
    put(config, "emergencyDefinition", args.emergency_definition);
    put(config, "faqs", args.faqs);
    put(config, "doNot", args.do_not);
    put(config, "booking", args.booking);

    // The two that replace the ambiguous free-text field. Validated, and echoed back so Ivy can
    // read the digits to the caller for confirmation.
    const notifyPhone = normalizePhone(String(args.notify_phone ?? ""));
    const escalationPhone = normalizePhone(String(args.escalation_phone ?? ""));
    const rejected: string[] = [];
    if (args.notify_phone && !notifyPhone) rejected.push("the number for messages");
    if (args.escalation_phone && !escalationPhone) rejected.push("the emergency number");
    if (notifyPhone) config.notifyPhone = notifyPhone;
    if (escalationPhone) config.escalationPhone = escalationPhone;

    config.bookingMode = "message"; // booking is not sold yet; never let an interview switch it on
    config.updatedAt = new Date().toISOString();
    config.capturedBy = "ivy-onboarding";

    await db
      .update(forgeSites)
      .set({ receptionistConfig: config, updatedAt: new Date().toISOString() })
      .where(eq(forgeSites.id, siteId));

    if (rejected.length) {
      return NextResponse.json({
        saved: true,
        message: `I've saved that. I didn't quite catch ${rejected.join(" or ")} though — could you read it to me one more time?`,
        notify_phone: notifyPhone ?? null,
        escalation_phone: escalationPhone ?? null,
      });
    }

    return NextResponse.json({
      saved: true,
      message: "Got it, saved.",
      notify_phone: notifyPhone ?? null,
      escalation_phone: escalationPhone ?? null,
    });
  } catch (err) {
    console.error("[voice/onboard/save] threw:", err);
    return NextResponse.json({
      saved: false,
      message: "I couldn't save that just now — let me have someone follow up so nothing's lost.",
    });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "voice/onboard/save" });
}
