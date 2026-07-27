"use server";

import { sql } from "drizzle-orm";

import { db, activityLog } from "@/db";
import { assertAdmin } from "@/lib/require-admin";

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
