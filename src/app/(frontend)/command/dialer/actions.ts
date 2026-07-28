"use server";

import { sql } from "drizzle-orm";

import { db, activityLog } from "@/db";
import { assertAdmin } from "@/lib/require-admin";
import { sendSms } from "@/lib/sms";
import { prospectSiteUrl } from "@/lib/forge-outreach";

export type DialDisposition = "no_answer" | "voicemail" | "callback" | "interested" | "booked" | "not_interested" | "bad_number";

const LABELS: Record<DialDisposition, string> = {
  no_answer: "No answer",
  voicemail: "Left it ringing / voicemail",
  callback: "Callback scheduled",
  interested: "Interested",
  booked: "Booked",
  not_interested: "Not interested",
  bad_number: "Bad number — sent for enrichment",
};

/**
 * Log one dialer-session call outcome on the lead's timeline (event `dial_call`, rendered by
 * getLeadHistories). Dispositions also advance CRM state: `callback` sets the callback clock,
 * `not_interested` declines the lead exactly like the call-room button (opted out, visible in the
 * Declined queue — never auto-deleted). Calls happen on Joe's Boost line; this is just the record.
 */
export async function logDialOutcome(input: {
  siteId: number;
  disposition: DialDisposition;
  note?: string;
  callbackAt?: string; // ISO, only for disposition === "callback"
}): Promise<void> {
  await assertAdmin();
  const { siteId, disposition } = input;
  if (!Number.isFinite(siteId) || !LABELS[disposition]) return;
  const note = (input.note || "").trim().slice(0, 1000);

  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "dial_call",
    summary: `📞 Dialer: ${LABELS[disposition]} — lead #${siteId}${note ? ` · ${note.slice(0, 120)}` : ""}`,
    metadata: { detail: { siteId, channel: "call", disposition, note: note || null } },
  });

  if (disposition === "callback") {
    const when = input.callbackAt && !Number.isNaN(Date.parse(input.callbackAt)) ? input.callbackAt : null;
    await db.execute(sql`
      UPDATE forge_sites SET callback_at = ${when ?? sql`now() + interval '1 day'`}::timestamptz,
             callback_note = ${note || "Callback from dialer session"}, updated_at = now()
      WHERE id = ${siteId}`);
  } else if (disposition === "not_interested") {
    // Mirrors the call-room "Declined" action: suppressed from outreach, kept visible for review.
    await db.execute(sql`
      UPDATE forge_sites SET lead_stage = 'declined', outreach_status = 'opted_out',
             declined_at = COALESCE(declined_at, now()), denied_reason = 'Not interested (phone)',
             updated_at = now()
      WHERE id = ${siteId}`);
  } else if (disposition === "bad_number") {
    // Flag the number bad + clear it so contact enrichment treats this lead as needing a channel.
    // The dialer queue skips flagged leads; saving a NEW phone (enrich_forge_contact) clears the
    // flag automatically, so the lead flows back into the queue with no manual step.
    await db.execute(sql`
      UPDATE forge_sites
      SET phone_bad_at = now(),
          phone_bad_note = ${note || "Wrong/disconnected number (dialer)"} || ' (was ' || COALESCE(phone, '?') || ')',
          -- Clear the dead number so enrichment's fill-if-empty actually writes the new one.
          phone = NULL,
          contact_notes = COALESCE(contact_notes || E'\n', '') ||
            ${`[dialer ${new Date().toISOString().slice(0, 10)}] BAD NUMBER${note ? `: ${note}` : ""} — needs a new phone`},
          updated_at = now()
      WHERE id = ${siteId}`);
  } else if (disposition === "interested" || disposition === "booked") {
    await db.execute(sql`
      UPDATE forge_sites SET contact_notes = COALESCE(contact_notes || E'\n', '') ||
             ${`[dialer ${new Date().toISOString().slice(0, 10)}] ${LABELS[disposition]}${note ? `: ${note}` : ""}`},
             updated_at = now()
      WHERE id = ${siteId}`);
  }
}

/**
 * Text the lead their preview link + claim code, straight from the dialer — the "I'll send it to
 * you right now" moment on a live call, which is when a prospect is warmest. Sends through our
 * Twilio number (the one their replies already route back from), and logs to the lead's thread so
 * the conversation stays in one place.
 */
export async function textPreviewFromDialer(siteId: number): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin();
  const rows = (
    await db.execute(sql`
      SELECT id, business_name, owner_name, phone, claim_code, slug, live_url
      FROM forge_sites WHERE id = ${siteId} LIMIT 1`)
  ).rows as Array<Record<string, unknown>>;
  const s = rows[0];
  if (!s) return { ok: false, error: "Lead not found." };
  if (!s.phone) return { ok: false, error: "No phone on file." };

  const link = prospectSiteUrl({ liveUrl: s.live_url as string | null, slug: s.slug as string | null });
  const first = s.owner_name ? String(s.owner_name).trim().split(/\s+/)[0] : "";
  const body =
    `Hi${first ? ` ${first}` : ""}, Joe with ThinkBigJoe — great talking with you. Here's the website preview we made for ${s.business_name}: ${link}` +
    (s.claim_code ? ` — to claim it, make a free account at https://thinkbigjoe.com and use code ${s.claim_code}.` : ".") +
    ` Any questions, just text me back.`;

  const res = await sendSms(String(s.phone), body);
  if ("ok" in res && !res.ok) return { ok: false, error: res.error };
  if ("skipped" in res) return { ok: false, error: "SMS isn't configured." };

  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "sms_outbound",
    summary: `📲 Texted preview + code to ${s.business_name}`,
    metadata: { detail: { siteId, to: String(s.phone), note: body, via: "dialer" } },
  });
  return { ok: true };
}
