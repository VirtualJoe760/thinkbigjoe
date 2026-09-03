"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, gigs, activityLog, agents, agentQuestions, candidateFacts } from "@/db";
import { assertAdmin } from "@/lib/require-admin";

// Joe's human gate on Destiny's gig hunt. She posts gigs at 'found'; he approves; SHE then writes
// the proposal and submits it on Upwork (rewritten 2026-08-31 — she used to stop at drafting).
//
// The gate moved rather than disappeared: Joe still decides WHAT gets bid on, one gig at a time,
// and this board is deliberately capped at 10 awaiting review so approving stays a considered act
// rather than a queue to clear. Upwork still bans permanently for automation, so what protects the
// account now is server-side rate limiting in tbj-mcp.mjs — 3 proposals/day, 45 min apart — plus
// her own hard stop on any CAPTCHA or human-check wall.
//
// markSubmitted below is now a MANUAL OVERRIDE, not the only path: Destiny sets 'submitted'
// herself via update_gig_status. Joe uses this button when he sent one by hand, or when she was
// blocked at the submit step and he finished it for her.

async function logDecision(id: number, eventType: string, summary: string) {
  await db.insert(activityLog).values({
    actor: "joe",
    eventType,
    summary,
    metadata: { id, via: "/command/gigs" },
  });
}

/** Approve a found gig → it enters Destiny's queue (list_approved_gigs); she bids on it next run. */
export async function approveGig(id: number): Promise<void> {
  await assertAdmin();
  const now = new Date().toISOString();
  const rows = await db
    .update(gigs)
    .set({ status: "approved", approvedAt: now, updatedAt: now })
    .where(eq(gigs.id, id))
    .returning({ title: gigs.title, client: gigs.client });
  const r = rows[0];
  if (r) await logDecision(id, "gig_approved", `Approved to bid: ${r.title}${r.client ? ` — ${r.client}` : ""}`);
  revalidatePath("/command/gigs");
}

/** Dismiss a found gig → Destiny never bids on it, and it stops occupying a review slot. */
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
 * Joe sent the proposal on Upwork himself. Manual override: Destiny marks her own submissions,
 * so this is for the ones he finished by hand — typically a gig she got blocked on.
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


/**
 * Pause / resume Destiny. Sets agents.paused (survives roster sync). Her cron may still fire,
 * but her loop-entry MCP tools (gig_board_count / record_found_gig / update_gig_status) read this
 * flag and stand down — so while paused she opens nothing on Upwork and spends no Connects.
 *
 * This is the emergency brake. If Upwork ever shows a warning about her activity, pause first
 * and ask questions after: her limits are per-run and per-day, so a bad pattern would otherwise
 * keep going twice a day until someone edits a cron.
 */
export async function setDestinyPaused(paused: boolean): Promise<void> {
  await assertAdmin();
  await db
    .update(agents)
    .set({ paused, updatedAt: new Date().toISOString() })
    .where(eq(agents.id, "destiny"));
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: paused ? "agent_paused" : "agent_resumed",
    summary: `${paused ? "Paused" : "Resumed"} Destiny`,
    metadata: { agent: "destiny", via: "/command/gigs" },
  });
  revalidatePath("/command/gigs");
}

/**
 * Answer a question Destiny posted. She reads it next run (list_answered_questions) and resumes
 * that gig. If it carried a `topic` — a durable fact like her hourly rate or weekly hours — the
 * answer is remembered permanently, so she answers it herself from then on and never re-asks.
 */
export async function answerGigQuestion(questionId: number, formData: FormData): Promise<void> {
  await assertAdmin();
  const answer = String(formData.get("answer") || "").trim();
  if (!answer) return;
  const now = new Date().toISOString();
  const rows = await db
    .update(agentQuestions)
    .set({ answer, status: "answered", answeredAt: now })
    .where(eq(agentQuestions.id, questionId))
    .returning({ topic: agentQuestions.topic });
  const topic = rows[0]?.topic;
  if (topic) {
    await db
      .insert(candidateFacts)
      .values({ topic, fact: answer })
      .onConflictDoUpdate({ target: candidateFacts.topic, set: { fact: answer, updatedAt: now } });
  }
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "agent_question_answered",
    summary: `Answered Destiny's question #${questionId}${topic ? ` (remembered: ${topic})` : ""}`,
    metadata: { questionId, topic, via: "/command/gigs" },
  });
  revalidatePath("/command/gigs");
}

/**
 * Decline to answer — Joe's "I'm not answering this" gate, and a DECISION rather than a
 * non-answer: the gig the question was blocking is dismissed outright, because a question she
 * can't get past is a proposal she can't honestly finish. She sees the decline next run, resolves
 * it, and moves on — no re-asking, no guessing, no bidding anyway.
 *
 * Reversible: the gig lands in the archive, where `reopenGig` sends it back to review.
 */
export async function declineGigQuestion(questionId: number): Promise<void> {
  await assertAdmin();
  const now = new Date().toISOString();
  const rows = await db
    .update(agentQuestions)
    .set({ status: "declined", answeredAt: now })
    .where(eq(agentQuestions.id, questionId))
    .returning({ gigId: agentQuestions.gigId, question: agentQuestions.question });
  const q = rows[0];
  if (!q) return;

  let gigLabel = "";
  if (q.gigId) {
    const dropped = await db
      .update(gigs)
      .set({ status: "dismissed", updatedAt: now })
      .where(eq(gigs.id, q.gigId))
      .returning({ title: gigs.title });
    if (dropped[0]) gigLabel = ` — dismissed ${dropped[0].title}`;
  }

  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "agent_question_declined",
    summary: `Declined to answer Destiny's question #${questionId}${gigLabel}`,
    metadata: { questionId, gigId: q.gigId, question: q.question, via: "/command/gigs" },
  });
  revalidatePath("/command/gigs");
}
