"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";

import { db, outreach, prospects, forgeSites, activityLog, forgeBlacklist, leadEngine } from "@/db";
import { assertAdmin } from "@/lib/require-admin";
import { sendForgeOutreachEmail } from "@/lib/email";

const now = () => new Date().toISOString();
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
