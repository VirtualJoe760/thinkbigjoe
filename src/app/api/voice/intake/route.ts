import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db, activityLog, forgeSites } from "@/db";
import { generateClaimCode } from "@/lib/claim-code";
import { ensureOwnerContact } from "@/lib/contacts";
import { sendAdminAlert } from "@/lib/email";
import { normalizePhone } from "@/lib/sms";
import { notifyTelegram } from "@/lib/telegram";
import { callerPhone, parseRetellArgs, voiceAuthed } from "@/lib/voice-booking";

export const dynamic = "force-dynamic";

/**
 * Retell custom function: `save_intake` (Maddie, 2026-10-26).
 * The phone twin of the portal intake (/portal/build → requestSiteBuild): Maddie collects a
 * caller's business details and saves them here. We
 *   1. queue a forge_sites row (status 'approved', source 'voice_intake') — the forge builds it
 *      when forge_engine.enabled is on; while paused it waits. If the caller's phone already
 *      matches a lead, we append the intake to that row instead of creating a duplicate.
 *   2. create the owner contact in the CRM,
 *   3. email + Telegram Joe with everything collected.
 * Args: { business_name, trade, city?, caller_name?, phone?, email?, website?, needs?, details?, best_time? }
 */
export async function POST(req: Request) {
  if (!voiceAuthed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Sorry, I didn't catch that." });
  }
  const args = parseRetellArgs(body);
  const s = (k: string) => (typeof args[k] === "string" ? String(args[k]).trim().slice(0, 1500) : "");
  const businessName = s("business_name");
  const trade = s("trade");
  const city = s("city");
  const callerName = s("caller_name");
  const email = s("email");
  let website = s("website");
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  const needs = s("needs");
  const details = s("details");
  const bestTime = s("best_time");
  const rawPhone = s("phone") || callerPhone(body) || "";
  const phone = rawPhone ? normalizePhone(rawPhone) || rawPhone : "";

  if (!businessName) {
    return NextResponse.json({ ok: false, message: "What's the name of the business?" });
  }

  const notes = [
    `☎️ Phone intake with Maddie (${new Date().toISOString().slice(0, 10)})`,
    needs ? `Looking for: ${needs}` : null,
    details ? `About the business: ${details}` : null,
    bestTime ? `Best time to call: ${bestTime}` : null,
  ].filter(Boolean).join("\n");

  try {
    // Already a lead with this phone? Append rather than duplicate.
    let siteId: number | null = null;
    if (phone) {
      // Stored phones vary in format ("(760) 218-3189" vs "+17602183189") — compare the last 10 digits.
      const last10 = phone.replace(/\D/g, "").slice(-10);
      const [existing] = last10.length === 10
        ? await db.select({ id: forgeSites.id }).from(forgeSites)
            .where(sql`right(regexp_replace(coalesce(${forgeSites.phone}, ''), '[^0-9]', '', 'g'), 10) = ${last10}`).limit(1)
        : [];
      if (existing) {
        siteId = existing.id;
        const [row] = await db.select({ contactNotes: forgeSites.contactNotes }).from(forgeSites).where(eq(forgeSites.id, existing.id)).limit(1);
        await db.update(forgeSites).set({
          contactNotes: [row?.contactNotes, notes].filter(Boolean).join("\n"),
          ownerName: callerName || undefined,
          email: email || undefined,
          updatedAt: new Date().toISOString(),
        }).where(eq(forgeSites.id, existing.id));
      }
    }
    if (!siteId) {
      const base = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "site";
      const [row] = await db.insert(forgeSites).values({
        slug: `${base}-${Math.random().toString(36).slice(2, 7)}`,
        businessName,
        niche: trade || "Home service",
        city: city || null,
        serviceArea: city || null,
        phone: phone || null,
        email: email || null,
        ownerName: callerName || null,
        existingWebsiteUrl: website || null,
        contactNotes: notes,
        status: "approved", // queued for the forge; waits while the forge is paused
        source: "voice_intake",
        claimCode: generateClaimCode(),
      }).returning({ id: forgeSites.id });
      siteId = row?.id ?? null;
    }
    if (siteId) await ensureOwnerContact(siteId).catch(() => null);

    await db.insert(activityLog).values({
      actor: "voice",
      eventType: "forge_prospect_added",
      summary: `Phone intake (Maddie) — ${businessName}${trade ? ` (${trade})` : ""}${city ? ` · ${city}` : ""}`,
      metadata: { detail: { siteId, businessName, trade, city, phone, needs, source: "voice_intake" } },
    }).catch(() => {});

    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>");
    sendAdminAlert({
      subject: `☎️ Phone intake: ${businessName}`,
      heading: "New intake from Maddie (phone)",
      message: esc(
        `${businessName}${trade ? ` — ${trade}` : ""}${city ? ` · ${city}` : ""}\n` +
        `${callerName || "(no name)"} · ${phone || "(no phone)"}${email ? ` · ${email}` : ""}\n` +
        (website ? `Current site: ${website}\n` : "") +
        `\n${notes}\n\nQueued for the forge (builds when the forge is on).`,
      ),
      ctaUrl: "https://thinkbigjoe.com/command/prospects",
      ctaLabel: "Open in Command",
    }).catch(() => {});
    notifyTelegram(
      `☎️ <b>Phone intake (Maddie)</b>\n${businessName}${trade ? ` (${trade})` : ""}${city ? ` · ${city}` : ""}\n${callerName} ${phone}` +
      (needs ? `\nWants: ${needs.slice(0, 200)}` : "") + (bestTime ? `\nBest time: ${bestTime}` : ""),
    ).catch(() => {});

    return NextResponse.json({
      ok: true,
      message: "Saved — Joe has all of that now. Would you like me to book a time for you to talk with him?",
    });
  } catch (err) {
    console.error("[voice/intake] failed:", err);
    return NextResponse.json({
      ok: false,
      message: "I had trouble saving that — let me take it as a message for Joe instead.",
    });
  }
}
