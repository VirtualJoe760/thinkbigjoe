"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";

import { and, sql } from "drizzle-orm";

import { db, outreach, prospects, forgeSites, activityLog, forgeBlacklist, leadEngine, jobRequests, outreachEngine, previewEngine, forgeEngine } from "@/db";
import { assertAdmin } from "@/lib/require-admin";
import { sendForgeOutreachEmail } from "@/lib/email";

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

// --- Marketing-approval gate: a built site becomes a LEAD only when approved ---
export async function approveForMarketing(id: string): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, Number(id))).limit(1);
  if (!site) return { ok: false, message: "Site not found." };
  if (site.status !== "built") return { ok: false, message: "Only built sites can be approved for marketing." };
  await db
    .update(forgeSites)
    .set({ marketingApprovedAt: now(), updatedAt: now() })
    .where(eq(forgeSites.id, site.id));
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "forge_marketing_approved",
    summary: `Approved ${site.businessName} for marketing — now a lead, outreach can begin.`,
    metadata: { auto: true, target: site.slug, detail: { siteId: site.id } },
  });
  revalidatePath("/command/prospects");
  revalidatePath("/command/leads");
  return { ok: true, message: `${site.businessName} is now a lead — it's in the call room and outreach can start.` };
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
