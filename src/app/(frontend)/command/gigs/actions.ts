"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, gigs, activityLog } from "@/db";
import { assertAdmin } from "@/lib/require-admin";

// Joe's human gate on Destiny's gig hunt. Destiny posts gigs at 'found' and drafts proposals for
// the ones Joe approves — she NEVER submits. Upwork bans accounts permanently for automated
// bidding, so "Joe clicks submit himself" is not a workflow preference, it's what keeps the
// account alive. Marking a gig submitted is therefore deliberately a HUMAN-ONLY action; the MCP
// tool refuses to set that status.

async function logDecision(id: number, eventType: string, summary: string) {
  await db.insert(activityLog).values({
    actor: "joe",
    eventType,
    summary,
    metadata: { id, via: "/command/gigs" },
  });
}

/** Approve a found gig → it enters Destiny's proposal queue (list_approved_gigs). */
export async function approveGig(id: number): Promise<void> {
  await assertAdmin();
  const now = new Date().toISOString();
  const rows = await db
    .update(gigs)
    .set({ status: "approved", approvedAt: now, updatedAt: now })
    .where(eq(gigs.id, id))
    .returning({ title: gigs.title, client: gigs.client });
  const r = rows[0];
  if (r) await logDecision(id, "gig_approved", `Approved for a proposal: ${r.title}${r.client ? ` — ${r.client}` : ""}`);
  revalidatePath("/command/gigs");
}

/** Dismiss a found gig → Destiny never writes a proposal for it. */
export async function dismissGig(id: number): Promise<void> {
  await assertAdmin();
  const now = new Date().toISOString();
  const rows = await db
    .update(gigs)
    .set({ status: "dismissed", updatedAt: now })
    .where(eq(gigs.id, id))
    .returning({ title: gigs.title });
  const r = rows[0];
  if (r) await logDecision(id, "gig_dismissed", `Dismissed: ${r.title}`);
  revalidatePath("/command/gigs");
}

/**
 * Joe has sent the proposal on Upwork himself. Human-only on purpose — this is the one action
 * that costs Connects and the one Destiny is forbidden to take.
 */
export async function markSubmitted(id: number): Promise<void> {
  await assertAdmin();
  const now = new Date().toISOString();
  const rows = await db
    .update(gigs)
    .set({ status: "submitted", submittedAt: now, updatedAt: now })
    .where(eq(gigs.id, id))
    .returning({ title: gigs.title });
  const r = rows[0];
  if (r) await logDecision(id, "gig_submitted", `Joe submitted the proposal: ${r.title}`);
  revalidatePath("/command/gigs");
}

/** Outcome, once the client decides. These are what eventually build the Job Success Score. */
export async function markOutcome(id: number, outcome: "won" | "lost"): Promise<void> {
  await assertAdmin();
  const now = new Date().toISOString();
  const rows = await db
    .update(gigs)
    .set({ status: outcome, updatedAt: now })
    .where(eq(gigs.id, id))
    .returning({ title: gigs.title });
  const r = rows[0];
  if (r) await logDecision(id, `gig_${outcome}`, `${outcome === "won" ? "WON" : "Lost"}: ${r.title}`);
  revalidatePath("/command/gigs");
}

/** Put a dismissed gig back on the review board. */
export async function reopenGig(id: number): Promise<void> {
  await assertAdmin();
  await db.update(gigs).set({ status: "found", updatedAt: new Date().toISOString() }).where(eq(gigs.id, id));
  revalidatePath("/command/gigs");
}
