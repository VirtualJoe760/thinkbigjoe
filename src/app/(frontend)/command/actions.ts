"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";

import { and, sql } from "drizzle-orm";

import { db, outreach, prospects, forgeSites, activityLog, forgeBlacklist, leadEngine, jobRequests, outreachEngine, previewEngine, forgeEngine, forgeReplies, designReports, contactOverrides } from "@/db";
import { assertAdmin } from "@/lib/require-admin";
import { sendForgeOutreachEmail, sendReplyEmail, sendBookingConfirmationEmail } from "@/lib/email";
import { notifyTelegram } from "@/lib/telegram";
import { sendSms } from "@/lib/sms";
import { mintCallbackCode, callbackCodeMessage } from "@/lib/callback-codes";
import {
  BOOKING_TIMEZONE,
  SLOT_DURATION_MIN,
  createEvent,
  getAvailableSlots,
  isCalendarConfigured,
  isWindowFree,
  meetLinkOf,
} from "@/lib/gcal";

const now = () => new Date().toISOString();

/** Set the showroom pacing dials — the daily outreach goal (token cap) + preview wave budget + on/off. */
export async function updateShowroomEngines(input: {
  dailyGoal: number;
  dailyBudget: number;
  outreachEnabled: boolean;
  previewEnabled: boolean;
}) {
  await assertAdmin();
  const g = Math.max(0, Math.min(500, Math.round(input.dailyGoal || 0)));
  const b = Math.max(0, Math.min(1000, Math.round(input.dailyBudget || 0)));
  await db.update(outreachEngine).set({ dailyGoal: g, enabled: input.outreachEnabled, updatedAt: now() }).where(eq(outreachEngine.id, 1));
  await db.update(previewEngine).set({ dailyBudget: b, enabled: input.previewEnabled, updatedAt: now() }).where(eq(previewEngine.id, 1));
  revalidatePath("/command/prospects");
}

/** Flip the build engine (forge) on or off. The launchd poller reads this each tick and only builds when on. */
export async function toggleForge(enabled: boolean) {
  await assertAdmin();
  await db.update(forgeEngine).set({ enabled, updatedAt: now() }).where(eq(forgeEngine.id, 1));
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "forge_engine_toggled",
    summary: `Build engine ${enabled ? "turned ON" : "turned OFF"}`,
    metadata: { detail: { enabled } },
  });
  revalidatePath("/command/engine");
  revalidatePath("/command/prospects");
}

/** Flip one of the forge's granular capability switches (new-site builds, customer edits, or the
 *  idle template-designer). The poller reads these each tick — master `enabled` still gates all of
 *  them, these throttle spend within it (e.g. "edits only, no new sites"). */
export async function setForgeCapability(
  capability: "builds" | "edits" | "idleTemplates",
  on: boolean,
): Promise<{ ok: boolean }> {
  await assertAdmin();
  const col = { builds: "buildsEnabled", edits: "editsEnabled", idleTemplates: "idleTemplatesEnabled" } as const;
  await db.update(forgeEngine).set({ [col[capability]]: on, updatedAt: now() }).where(eq(forgeEngine.id, 1));
  const label = { builds: "New-site builds", edits: "Customer edits", idleTemplates: "Idle template-building" }[capability];
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "forge_engine_toggled",
    summary: `${label} ${on ? "turned ON" : "turned OFF"}`,
    metadata: { detail: { capability, on } },
  });
  revalidatePath("/command/engine");
  return { ok: true };
}

/** Set the weekly forge run-budget (the quota gauge cap). A "run" = one build, edit, or template. */
export async function setWeeklyRunBudget(budget: number): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  const clean = Math.max(1, Math.min(1000, Math.round(Number(budget) || 0)));
  await db.update(forgeEngine).set({ weeklyRunBudget: clean, lastWarnPct: 0, updatedAt: now() }).where(eq(forgeEngine.id, 1));
  revalidatePath("/command/engine");
  return { ok: true, message: `Weekly run-budget set to ${clean}.` };
}

/** Clear stuck build state: re-queue any 'building' row that's been stuck too long (a crashed/hung
 *  build). The forge picks a fresh worker + rebuilds it. Safe — only touches long-stuck rows. */
export async function resetStuckBuilds(): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  const stuck = await db
    .update(forgeSites)
    .set({ status: "approved", updatedAt: now() })
    .where(sql`status = 'building' AND updated_at < now() - interval '25 minutes'`)
    .returning({ id: forgeSites.id });
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "forge_cache_cleared",
    summary: `Cleared stuck builds — ${stuck.length} re-queued`,
    metadata: { detail: { reset: stuck.length } },
  });
  revalidatePath("/command/engine");
  return { ok: true, message: stuck.length ? `Re-queued ${stuck.length} stuck build(s).` : "No stuck builds — queue is clean." };
}
const slugify = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const hostOf = (u: string) => {
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

export async function approveDraft(id: string) {
  await assertAdmin();
  await db
    .update(outreach)
    .set({ status: "approved", approvedAt: now() })
    .where(eq(outreach.id, Number(id)));
  revalidatePath("/command", "layout");
}

export async function denyDraft(id: string, reason?: string) {
  await assertAdmin();
  await db
    .update(outreach)
    .set({ status: "denied", denyReason: reason || null })
    .where(eq(outreach.id, Number(id)));
  revalidatePath("/command", "layout");
}

export async function editDraft(id: string, body: string) {
  await assertAdmin();
  await db
    .update(outreach)
    .set({ body, status: "edited" })
    .where(eq(outreach.id, Number(id)));
  revalidatePath("/command", "layout");
}

export async function approveMany(ids: string[]) {
  await assertAdmin();
  if (!ids.length) return;
  await db
    .update(outreach)
    .set({ status: "approved", approvedAt: now() })
    .where(inArray(outreach.id, ids.map(Number)));
  revalidatePath("/command", "layout");
}

export async function denyMany(ids: string[], reason?: string) {
  await assertAdmin();
  if (!ids.length) return;
  await db
    .update(outreach)
    .set({ status: "denied", denyReason: reason || null })
    .where(inArray(outreach.id, ids.map(Number)));
  revalidatePath("/command", "layout");
}

export async function approveForgeSite(id: string) {
  await assertAdmin();
  await db
    .update(forgeSites)
    .set({ status: "approved", approvedAt: now() })
    .where(eq(forgeSites.id, Number(id)));
  revalidatePath("/command/sites");
}

export async function denyForgeSite(id: string, reason?: string) {
  await assertAdmin();
  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, Number(id))).limit(1);
  await db
    .update(forgeSites)
    .set({ status: "denied", deniedReason: reason || null })
    .where(eq(forgeSites.id, Number(id)));
  // Blacklist the business so the prospector never re-crawls or re-adds it. Keyed on
  // normalized name+city and (if any) its website domain — so a reworded name still hits.
  if (site) {
    await db
      .insert(forgeBlacklist)
      .values({
        normKey: `${slugify(site.businessName)}|${slugify(site.city || "")}`,
        businessName: site.businessName,
        city: site.city || null,
        domain: hostOf(site.existingWebsiteUrl || ""),
        reason: reason || "denied",
      })
      .onConflictDoNothing();
  }
  revalidatePath("/command/sites");
  revalidatePath("/command/prospects");
  revalidatePath("/command/leads");
}

/** Record a manual reach-out attempt from the call room (call / text / email click). Fire-and-forget
 *  from the client so the tally + "last tried" update without blocking the tel:/sms:/mailto: link. */
export async function logContactAttempt(siteId: string, channel: "call" | "text" | "email"): Promise<{ ok: boolean }> {
  await assertAdmin();
  const id = Number(siteId);
  if (!Number.isFinite(id)) return { ok: false };
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "lead_contact_attempt",
    summary: `${channel === "call" ? "Called" : channel === "text" ? "Texted" : "Emailed"} lead (site #${id})`,
    metadata: { detail: { siteId: id, channel } },
  });
  await db.update(forgeSites).set({ contactedAt: now() }).where(eq(forgeSites.id, id));
  revalidatePath("/command/leads");
  return { ok: true };
}

/**
 * One-click "text a priority callback code" from the lead page. Mints a code tied
 * to this lead, texts it via our Twilio number, and drops it on the lead's
 * timeline. When the lead calls the TBJ number and gives the code, Ivy verifies it
 * and transfers them straight to Joe. Gracefully degrades if SMS isn't live yet
 * (still mints + returns the code + message so Joe can send it by hand).
 */
export async function sendCallbackCodeText(
  siteId: string,
): Promise<{ ok: boolean; message: string; code?: string }> {
  await assertAdmin();
  const id = Number(siteId);
  if (!Number.isFinite(id)) return { ok: false, message: "Bad lead id." };
  const [site] = await db
    .select({ phone: forgeSites.phone, businessName: forgeSites.businessName, ownerName: forgeSites.ownerName })
    .from(forgeSites)
    .where(eq(forgeSites.id, id))
    .limit(1);
  if (!site) return { ok: false, message: "Lead not found." };
  if (!site.phone) return { ok: false, message: "No phone number on this lead — add one first." };

  const firstName = (site.ownerName || "").trim().split(/\s+/)[0] || null;
  let code: string;
  try {
    code = await mintCallbackCode({ phone: site.phone, name: site.ownerName || site.businessName, forgeSiteId: id });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't mint a code." };
  }

  const msg = callbackCodeMessage(code, firstName);
  const res = await sendSms(site.phone, msg);
  const sent = "ok" in res && res.ok;

  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "callback_code_sent",
    summary: `${sent ? "Texted" : "Minted"} callback code ${code} — ${site.businessName}`,
    metadata: { detail: { siteId: id, channel: "code", code, note: msg, sent } },
  });
  if (sent) await db.update(forgeSites).set({ contactedAt: now() }).where(eq(forgeSites.id, id));
  revalidatePath("/command/leads");

  if (sent) return { ok: true, message: `Texted code ${code} to ${site.phone}. Reaches you when they call + give it.`, code };
  if ("skipped" in res)
    return {
      ok: false,
      message: `Code ${code} is ready, but texting isn't live yet (add the Twilio keys in Vercel). Send it manually: "${msg}"`,
      code,
    };
  return { ok: false, message: `Code ${code} minted, but the text failed: ${"error" in res ? res.error : "unknown"}`, code };
}

/** Send a text to a contact from the Messages inbox (Joe jumping into a conversation). */
export async function sendConversationMessage(siteId: string, text: string): Promise<{ ok: boolean; message?: string }> {
  await assertAdmin();
  const id = Number(siteId);
  const body = text.trim();
  if (!Number.isFinite(id)) return { ok: false, message: "Bad contact id." };
  if (!body) return { ok: false, message: "Empty message." };
  const [site] = await db
    .select({ phone: forgeSites.phone, businessName: forgeSites.businessName })
    .from(forgeSites)
    .where(eq(forgeSites.id, id))
    .limit(1);
  if (!site?.phone) return { ok: false, message: "No phone number on this contact." };

  const res = await sendSms(site.phone, body);
  if (!("ok" in res) || res.ok !== true) {
    return { ok: false, message: "skipped" in res ? "SMS isn't configured yet." : "error" in res ? res.error : "Send failed." };
  }
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "sms_outbound",
    summary: `📤 You texted ${site.businessName}: ${body.slice(0, 120)}`,
    metadata: { detail: { siteId: id, note: body, to: site.phone, via: "manual" } },
  });
  await db.update(forgeSites).set({ contactedAt: now() }).where(eq(forgeSites.id, id));
  revalidatePath("/command/messages");
  return { ok: true };
}

/**
 * Rename a contact in the Messages inbox. Stores a display-name override keyed by phone
 * (contact_overrides) so it works for any number — including ones that don't match a business
 * yet. Passing an empty name clears the override (falls back to the business name / phone).
 */
export async function renameContact(phone: string, name: string): Promise<{ ok: boolean; message?: string }> {
  await assertAdmin();
  const key = (phone || "").trim();
  const display = name.trim().slice(0, 80);
  if (!key) return { ok: false, message: "No phone to attach the name to." };
  if (!display) {
    await db.delete(contactOverrides).where(eq(contactOverrides.phone, key));
  } else {
    await db
      .insert(contactOverrides)
      .values({ phone: key, displayName: display })
      .onConflictDoUpdate({ target: contactOverrides.phone, set: { displayName: display, updatedAt: now() } });
  }
  revalidatePath("/command/messages");
  return { ok: true };
}

/** Save a free-text note on a lead (e.g. what happened on a call). Lands on the lead's timeline. */
export async function saveLeadNote(siteId: string, note: string): Promise<{ ok: boolean; message?: string }> {
  await assertAdmin();
  const id = Number(siteId);
  const text = note.trim();
  if (!Number.isFinite(id)) return { ok: false, message: "Bad lead id." };
  if (!text) return { ok: false, message: "Note is empty." };
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "lead_note",
    summary: `Note — site #${id}: ${text.slice(0, 100)}`,
    metadata: { detail: { siteId: id, note: text } },
  });
  revalidatePath("/command/leads");
  return { ok: true };
}

/**
 * Send Joe's reply to an inbound prospect message. The draft→approve→send gate: the poller
 * pre-wrote a draft (forge_replies), Joe reviewed/edited the text here, and this actually sends it
 * via SMTP (reply-to Joe, threaded on their subject). Marks the row 'sent' + logs the touch so it
 * lands on the lead's Message history. Nothing goes out without this explicit action.
 */
export async function sendReply(replyId: number, text: string): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  const body = text.trim();
  if (!body) return { ok: false, message: "Nothing to send — the reply is empty." };
  const [r] = await db
    .select({ id: forgeReplies.id, siteId: forgeReplies.siteId, fromEmail: forgeReplies.fromEmail, subject: forgeReplies.subject, status: forgeReplies.status })
    .from(forgeReplies).where(eq(forgeReplies.id, replyId)).limit(1);
  if (!r) return { ok: false, message: "Reply not found." };
  if (r.status === "sent") return { ok: false, message: "This reply was already sent." };
  if (!r.fromEmail) return { ok: false, message: "No address to reply to." };

  const res = await sendReplyEmail({ to: r.fromEmail, subject: r.subject || "your website", text: body });
  if ("error" in res && res.error) return { ok: false, message: "Send failed — check the email logs." };
  if ("skipped" in res && res.skipped) return { ok: false, message: "SMTP isn't configured — can't send." };

  await db.update(forgeReplies)
    .set({ status: "sent", finalText: body, updatedAt: now() })
    .where(eq(forgeReplies.id, replyId));
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "email_reply_sent",
    summary: `Replied to ${r.fromEmail} (site #${r.siteId})`,
    metadata: { detail: { siteId: r.siteId, channel: "email", to: r.fromEmail, snippet: body.slice(0, 300) } },
  });
  await db.update(forgeSites).set({ contactedAt: now() }).where(eq(forgeSites.id, r.siteId));
  revalidatePath("/command/leads");
  return { ok: true, message: "Reply sent." };
}

/** Dismiss an inbound reply without sending (handled elsewhere, spam, or not worth a response). */
export async function dismissReply(replyId: number): Promise<{ ok: boolean }> {
  await assertAdmin();
  await db.update(forgeReplies)
    .set({ status: "dismissed", updatedAt: now() })
    .where(eq(forgeReplies.id, replyId));
  revalidatePath("/command/leads");
  return { ok: true };
}

/** Include/exclude a built site from the scheduled outreach batch (the 10am send). Skipping sets
 *  outreach_status='skipped' so the sender passes it over; including resets it to 'none'. */
export async function setOutreachSkip(id: string, skip: boolean): Promise<{ ok: boolean }> {
  await assertAdmin();
  await db.update(forgeSites)
    .set({ outreachStatus: skip ? "skipped" : "none", updatedAt: now() })
    .where(eq(forgeSites.id, Number(id)));
  revalidatePath("/command/outreach");
  return { ok: true };
}

/**
 * Delete a forge site from the UI. SOFT delete — sets status='deleted' so it disappears from every
 * view (review/queued/built/archive all filter by specific statuses) but the row + its live
 * deployment are recoverable. Unlike Deny, it does NOT blacklist (a demo/test/mistake, not a real
 * business we're rejecting). Logged to the audit trail.
 */
export async function deleteForgeSite(id: string): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  const [site] = await db.select({ businessName: forgeSites.businessName, status: forgeSites.status })
    .from(forgeSites).where(eq(forgeSites.id, Number(id))).limit(1);
  if (!site) return { ok: false, message: "Site not found." };
  await db.update(forgeSites)
    .set({ status: "deleted", updatedAt: now() })
    .where(eq(forgeSites.id, Number(id)));
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "forge_site_deleted",
    summary: `Deleted site — ${site.businessName}`,
    metadata: { detail: { siteId: Number(id), prevStatus: site.status } },
  });
  revalidatePath("/command/prospects");
  revalidatePath("/command/sites");
  revalidatePath("/command/leads");
  revalidatePath("/command/engine");
  return { ok: true, message: `Deleted "${site.businessName}".` };
}

/**
 * Send the owner-outreach email for a built site (Joe's approve-&-send gate).
 * Uses the possibly-edited subject/body from the review UI, emails the owner the
 * claim code + see-your-site + book-a-call CTAs, then marks the site contacted.
 */
export async function sendForgeOutreach(
  id: string,
  subject: string,
  body: string,
): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, Number(id))).limit(1);
  if (!site) return { ok: false, message: "Site not found." };
  if (site.status !== "built") return { ok: false, message: "Site isn't built yet." };
  if (!site.email) return { ok: false, message: "No owner email on this lead — can't send." };
  if (!site.claimCode) return { ok: false, message: "No claim code on this site yet." };
  const subj = subject.trim();
  const text = body.trim();
  if (!subj || !text) return { ok: false, message: "Subject and message are both required." };

  // Persist the (edited) draft first so nothing is lost even if the send fails.
  await db
    .update(forgeSites)
    .set({ outreachSubject: subj, outreachDraft: text, updatedAt: now() })
    .where(eq(forgeSites.id, site.id));

  const res = await sendForgeOutreachEmail({
    to: site.email,
    subject: subj,
    body: text,
    businessName: site.businessName,
    liveUrl: site.liveUrl,
    claimCode: site.claimCode,
  });
  if ("skipped" in res) return { ok: false, message: "Email isn't configured (SMTP) — nothing was sent." };
  if ("error" in res) return { ok: false, message: "Send failed — check the logs and try again." };

  const touch = (site.followupCount || 0) + 1;
  await db
    .update(forgeSites)
    .set({ outreachStatus: "sent", contactedAt: now(), followupCount: touch, updatedAt: now() })
    .where(eq(forgeSites.id, site.id));
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "forge_outreach_sent",
    summary: `Sent owner outreach (touch ${touch}) for ${site.businessName} → ${site.email}`,
    metadata: { auto: true, target: site.slug, detail: { siteId: site.id, email: site.email, subject: subj, touch } },
  });
  revalidatePath("/command/prospects");
  revalidatePath("/command/leads");
  return { ok: true, message: `Sent to ${site.email}.` };
}

/** Dismiss a built site from the outreach queue without contacting the owner. */
export async function skipForgeOutreach(id: string) {
  await assertAdmin();
  await db
    .update(forgeSites)
    .set({ outreachStatus: "skipped", updatedAt: now() })
    .where(eq(forgeSites.id, Number(id)));
  revalidatePath("/command/prospects");
  revalidatePath("/command/leads");
}

export async function markSent(id: string, prospectId: string) {
  await assertAdmin();
  await db
    .update(outreach)
    .set({ status: "sent", sentAt: now() })
    .where(eq(outreach.id, Number(id)));
  if (prospectId) {
    await db
      .update(prospects)
      .set({ status: "connected" })
      .where(eq(prospects.id, Number(prospectId)));
  }
  revalidatePath("/command", "layout");
}

// --- Lead engine config (goal + Apify budget the scheduled scraper works toward) ---
export async function updateLeadEngine(input: {
  monthlyLeadGoal: number;
  monthlyBudgetUsd: number;
  enabled: boolean;
}) {
  await assertAdmin();
  const goal = Math.max(0, Math.round(input.monthlyLeadGoal || 0));
  const budget = Math.max(0, Math.round((input.monthlyBudgetUsd || 0) * 100) / 100);
  await db
    .update(leadEngine)
    .set({
      monthlyLeadGoal: goal,
      monthlyBudgetUsd: String(budget),
      enabled: !!input.enabled,
      updatedAt: now(),
    })
    .where(eq(leadEngine.id, 1));
  revalidatePath("/command/prospects");
}

/**
 * Queue an on-demand engine run. The web app can't reach the Mac directly, so we
 * drop a row in job_requests; a launchd poller on the Mac picks it up and runs the
 * matching engine/cron (find = lead-engine, enrich = the free browser agent cron).
 * Returns a friendly status; de-dupes against an already-pending request of the kind.
 */
export async function requestLeadJob(kind: "find" | "enrich"): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  if (kind !== "find" && kind !== "enrich") return { ok: false, message: "Unknown job." };
  const pending = await db
    .select({ id: jobRequests.id })
    .from(jobRequests)
    .where(and(eq(jobRequests.kind, kind), sql`${jobRequests.status} in ('pending','running')`))
    .limit(1);
  if (pending.length) {
    return { ok: true, message: kind === "find" ? "A find run is already queued." : "An enrichment run is already queued." };
  }
  await db.insert(jobRequests).values({ kind, requestedBy: "joe" });
  revalidatePath("/command/prospects");
  return {
    ok: true,
    message:
      kind === "find"
        ? "Queued — the lead engine will run within a couple minutes."
        : "Queued — the agent will start enriching within a couple minutes.",
  };
}

/**
 * Queue a NEW TEMPLATE design run. brand-lead authors design languages into the forge's
 * design-languages.json; this fires the forge template-designer on the next unbuilt one
 * (a long ~30-min run; new template registers disabled for review). Human-gated + one at
 * a time (the forge lock). Same job_requests → trigger-poll rails as the engine buttons.
 */
export async function requestTemplateDesign(): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  const pending = await db
    .select({ id: jobRequests.id })
    .from(jobRequests)
    .where(and(eq(jobRequests.kind, "design_template"), sql`${jobRequests.status} in ('pending','running')`))
    .limit(1);
  if (pending.length) return { ok: true, message: "A template design run is already queued." };
  await db.insert(jobRequests).values({ kind: "design_template", requestedBy: "joe" });
  revalidatePath("/command/engine");
  return { ok: true, message: "Queued — the forge will design the next new template in the background (~30 min). It registers disabled for your review." };
}

/** Approve (enable) or disable a template. The cloud `templates` table is the source of
 *  truth; forge-poll.mjs mirrors its enabled flags into the forge's registry.json each
 *  tick, so the change takes effect on the forge's next poll. */
export async function setTemplateEnabled(
  id: string,
  enabled: boolean,
): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  await db.execute(sql`UPDATE templates SET enabled = ${enabled}, updated_at = now() WHERE id = ${id}`);
  await db.insert(activityLog).values({
    actor: "command",
    eventType: enabled ? "template_enabled" : "template_disabled",
    summary: `Template ${id} ${enabled ? "enabled" : "disabled"}`,
    metadata: { detail: { id, enabled } },
  });
  revalidatePath("/command/engine");
  return {
    ok: true,
    message: enabled
      ? `${id} approved — the forge picks it up on its next poll.`
      : `${id} disabled — the forge will stop using it on its next poll.`,
  };
}

/** Retire (trash) a template — hide it from the library and pull it from rotation.
 *  Soft delete: keeps the row (restorable) but archived+disabled. */
export async function retireTemplate(id: string): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  await db.execute(sql`UPDATE templates SET archived = true, enabled = false, updated_at = now() WHERE id = ${id}`);
  await db.insert(activityLog).values({
    actor: "command",
    eventType: "template_retired",
    summary: `Template ${id} retired`,
    metadata: { detail: { id } },
  });
  revalidatePath("/command/engine");
  return { ok: true, message: `${id} retired — removed from the library and rotation.` };
}

/** Un-retire a template — back into the library (stays disabled until approved). */
export async function restoreTemplate(id: string): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  await db.execute(sql`UPDATE templates SET archived = false, updated_at = now() WHERE id = ${id}`);
  revalidatePath("/command/engine");
  return { ok: true, message: `${id} restored — review and approve it to re-enable.` };
}

/** Re-prompt the forge to rebuild/fix a template from its design brief. Queues a
 *  `fix_template` job (the Mac's trigger-poll runs forge-template.sh <dir>). Costs a
 *  forge run, so it's one-at-a-time and de-duped. `dir` is the forge template directory. */
export async function requestTemplateFix(
  id: string,
  dir: string,
): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  const pending = await db
    .select({ id: jobRequests.id })
    .from(jobRequests)
    .where(and(eq(jobRequests.kind, "fix_template"), eq(jobRequests.note, dir), sql`${jobRequests.status} in ('pending','running')`))
    .limit(1);
  if (pending.length) return { ok: true, message: `A fix for ${id} is already queued.` };
  await db.insert(jobRequests).values({ kind: "fix_template", requestedBy: "joe", note: dir });
  await db.insert(activityLog).values({
    actor: "command",
    eventType: "template_fix_requested",
    summary: `Rebuild requested for template ${id}`,
    metadata: { detail: { id, dir } },
  });
  revalidatePath("/command/engine");
  return {
    ok: true,
    message: `Queued — the forge will rebuild ${id} from its design brief in the background (~30 min, costs a run). It re-registers for review.`,
  };
}

/**
 * Verify or reject a Brand Lead design-research report. Verifying is Joe's sign-off
 * that the report's sources check out and the design direction is sound — the agent
 * reads these back on its next run, so verified reports steer future research and
 * rejected ones stop being repeated.
 */
export async function setDesignReportStatus(
  id: number,
  status: "verified" | "rejected",
): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  const rows = await db
    .update(designReports)
    .set({ status, verifiedAt: now(), verifiedBy: "joe", updatedAt: now() })
    .where(eq(designReports.id, id))
    .returning({ id: designReports.id, vertical: designReports.vertical, title: designReports.title });
  if (!rows.length) return { ok: false, message: "Report not found." };
  const r = rows[0];
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: status === "verified" ? "brand_design_verified" : "brand_design_rejected",
    summary: `${status === "verified" ? "Verified" : "Rejected"} design report #${r.id}: ${r.title} (${r.vertical})`,
    metadata: { detail: { report_id: r.id, vertical: r.vertical } },
  });
  revalidatePath("/command/engine");
  return { ok: true, message: status === "verified" ? "Verified — this steers the next research run." : "Rejected — the Brand Lead won't repeat this direction." };
}

// --- Marketing-approval gate: a built site becomes a LEAD only when approved ---
export async function approveForMarketing(id: string): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, Number(id))).limit(1);
  if (!site) return { ok: false, message: "Site not found." };
  // Sell-first: a prospect's PREVIEW is the marketing asset (the real build fires on claim).
  // Approve any live prospect that has — or will soon have — a preview; the preview engine
  // fills in un-previewed ones and outreach only sends once a preview exists.
  if (site.status === "denied" || site.status === "deleted") {
    return { ok: false, message: "This prospect was denied — can't market it." };
  }
  await db
    .update(forgeSites)
    .set({ marketingApprovedAt: now(), updatedAt: now() })
    .where(eq(forgeSites.id, site.id));
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "forge_marketing_approved",
    summary: `Approved ${site.businessName} for marketing — outreach can begin${site.preview ? "" : " once its preview is ready"}.`,
    metadata: { auto: true, target: site.slug, detail: { siteId: site.id } },
  });
  revalidatePath("/command/prospects");
  revalidatePath("/command/leads");
  return {
    ok: true,
    message: site.preview
      ? `${site.businessName} approved — outreach starts on its preview.`
      : `${site.businessName} approved — outreach begins once the preview engine generates its preview.`,
  };
}

/** Pull a lead back out of marketing (e.g. to revise it further). */
export async function unapproveMarketing(id: string) {
  await assertAdmin();
  await db.update(forgeSites).set({ marketingApprovedAt: null, updatedAt: now() }).where(eq(forgeSites.id, Number(id)));
  revalidatePath("/command/prospects");
  revalidatePath("/command/leads");
}

/**
 * Send a plain-English revision to the forge (Claude Code) — e.g. "change the hero to
 * an image carousel". Re-queues the site so the poller rebuilds it applying the note.
 * Faster than the editor/studio for structural changes.
 */
export async function requestForgeRevision(id: string, prompt: string): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  const note = (prompt || "").trim();
  if (note.length < 4) return { ok: false, message: "Describe the change you want." };
  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, Number(id))).limit(1);
  if (!site) return { ok: false, message: "Site not found." };
  if (site.status !== "built") return { ok: false, message: "Only built sites can be revised." };
  await db
    .update(forgeSites)
    .set({
      revisionNote: note,
      revisionRequestedAt: now(),
      status: "approved", // re-enters the build queue; forge-build applies the note in place
      marketingApprovedAt: null, // pull it out of marketing until the revision is reviewed
      updatedAt: now(),
    })
    .where(eq(forgeSites.id, site.id));
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "forge_revision_requested",
    summary: `Revision for ${site.businessName}: "${note.slice(0, 120)}"`,
    metadata: { auto: true, target: site.slug, detail: { siteId: site.id, note } },
  });
  revalidatePath("/command/prospects");
  return { ok: true, message: "Sent to the forge — it'll rebuild with your change within a few minutes." };
}

/**
 * "Don't like it — try something completely different." Re-queues the site for a FRESH
 * forge build with a DIFFERENT template/design (not a targeted edit). Clears the forced
 * template so the registry's variety picks a new look.
 */
export async function requestForgeRebuild(id: string): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, Number(id))).limit(1);
  if (!site) return { ok: false, message: "Site not found." };
  if (site.status !== "built") return { ok: false, message: "Only built sites can be rebuilt." };
  await db
    .update(forgeSites)
    .set({
      status: "approved", // re-enters the build queue
      preferredTemplate: null, // let variety pick a DIFFERENT template
      revisionNote: "REBUILD: take a completely different design approach than the last build — different template, layout, section order, and overall feel.",
      revisionRequestedAt: now(),
      marketingApprovedAt: null,
      updatedAt: now(),
    })
    .where(eq(forgeSites.id, site.id));
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "forge_rebuild_requested",
    summary: `Rebuild (different approach) for ${site.businessName}`,
    metadata: { auto: true, target: site.slug, detail: { siteId: site.id } },
  });
  revalidatePath("/command/prospects");
  return { ok: true, message: "Sent for a fresh rebuild with a different design — a few minutes." };
}

// ── Book an appointment FOR a lead (from the call room) ─────────────────────
// A rep, on a call with the prospect, books them a call with Joe. Books onto Joe's
// calendar with the prospect as the attendee (their name/email from the site).

export type ContactSlot = { start: string; end: string };

/** Open 30-min slots for a date (YYYY-MM-DD), Joe's regular window. Admin-only. */
export async function getContactSlots(date: string): Promise<{ ok: boolean; slots: ContactSlot[] }> {
  await assertAdmin();
  if (!isCalendarConfigured() || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, slots: [] };
  try {
    return { ok: true, slots: await getAvailableSlots(date) };
  } catch (err) {
    console.error("[getContactSlots] failed:", err);
    return { ok: false, slots: [] };
  }
}

export type BookForContactState = { ok: boolean; message: string };

/** Book a call for a lead onto Joe's calendar; emails the prospect the invite. Admin-only. */
export async function bookForContact(
  _prev: BookForContactState,
  formData: FormData,
): Promise<BookForContactState> {
  await assertAdmin();
  if (!isCalendarConfigured()) return { ok: false, message: "Booking isn't available (calendar not connected)." };

  const siteId = Number(formData.get("siteId"));
  const startTime = String(formData.get("startTime") || "");
  const start = new Date(startTime);
  if (!Number.isFinite(siteId) || Number.isNaN(start.getTime())) {
    return { ok: false, message: "Pick a time slot to book." };
  }
  const end = new Date(start.getTime() + SLOT_DURATION_MIN * 60000);

  const [site] = await db
    .select({ businessName: forgeSites.businessName, ownerName: forgeSites.ownerName, email: forgeSites.email, phone: forgeSites.phone })
    .from(forgeSites)
    .where(eq(forgeSites.id, siteId))
    .limit(1);
  if (!site) return { ok: false, message: "Lead not found." };

  const name = site.ownerName || site.businessName;
  const email = site.email || "";

  try {
    if (!(await isWindowFree(start.toISOString(), end.toISOString()))) {
      return { ok: false, message: "That time was just taken — pick another." };
    }
    const event = await createEvent({
      summary: `Call — ${site.businessName}${site.ownerName ? ` (${site.ownerName})` : ""}`,
      description: [
        `Booked from the call room for ${site.businessName}.`,
        ``,
        `Contact: ${name}`,
        email ? `Email: ${email}` : null,
        site.phone ? `Phone: ${site.phone}` : null,
      ].filter((l): l is string => l !== null).join("\n"),
      start: { dateTime: start.toISOString(), timeZone: BOOKING_TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: BOOKING_TIMEZONE },
      attendees: email ? [{ email, displayName: name }] : undefined,
      conferenceData: {
        createRequest: {
          requestId: `tbj-lead-${siteId}-${start.getTime()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }, { method: "popup", minutes: 15 }] },
    });

    const whenLabel = `${start.toLocaleString("en-US", { timeZone: BOOKING_TIMEZONE, dateStyle: "full", timeStyle: "short" })} Pacific`;
    if (email) {
      sendBookingConfirmationEmail({ to: email, name, whenLabel, meetLink: meetLinkOf(event) }).catch(() => {});
    }
    notifyTelegram(`📅 <b>Call booked from the room</b>\n${site.businessName}${site.ownerName ? ` · ${site.ownerName}` : ""}\n${whenLabel}`).catch(() => {});
    await db.insert(activityLog).values({
      actor: "joe",
      eventType: "booking_made",
      summary: `Booked a call for ${site.businessName} — ${whenLabel}`,
      metadata: { auto: false, target: String(siteId), detail: { siteId, eventId: event.id, channel: "call" } },
    }).catch(() => {});

    revalidatePath("/command/leads");
    return { ok: true, message: `Booked ${whenLabel}${email ? ` — invite sent to ${email}` : ""}.` };
  } catch (err) {
    console.error("[bookForContact] failed:", err);
    return { ok: false, message: "Couldn't book that — try another slot." };
  }
}
