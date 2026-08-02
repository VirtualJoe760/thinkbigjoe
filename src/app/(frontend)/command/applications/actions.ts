"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, jobApplications, activityLog, agents, agentQuestions } from "@/db";
import { assertAdmin } from "@/lib/require-admin";

// Joe's human gate. Whitney posts jobs at status 'found'; these actions are how
// Joe decides which ones she actually applies to. Approving a job is what moves
// it into Whitney's priority queue (list_approved_jobs). Every decision is logged
// to activity_log so it shows in the audit feed alongside Whitney's own work.

async function logDecision(id: number, eventType: string, summary: string) {
  await db.insert(activityLog).values({
    actor: "joe",
    eventType,
    summary,
    metadata: { id, via: "/command/applications" },
  });
}

/** Approve a found job → it enters Whitney's priority queue. */
export async function approveJob(id: number): Promise<void> {
  await assertAdmin();
  const now = new Date().toISOString();
  const rows = await db
    .update(jobApplications)
    .set({ status: "approved", approvedAt: now, updatedAt: now })
    .where(eq(jobApplications.id, id))
    .returning({ company: jobApplications.company, role: jobApplications.role });
  const r = rows[0];
  if (r) await logDecision(id, "application_approved", `Approved to apply: ${r.role} @ ${r.company}`);
  revalidatePath("/command/applications");
}

/** Dismiss a found job → Whitney never applies to it. */
export async function dismissJob(id: number): Promise<void> {
  await assertAdmin();
  const now = new Date().toISOString();
  const rows = await db
    .update(jobApplications)
    .set({ status: "dismissed", updatedAt: now })
    .where(eq(jobApplications.id, id))
    .returning({ company: jobApplications.company, role: jobApplications.role });
  const r = rows[0];
  if (r) await logDecision(id, "application_dismissed", `Dismissed: ${r.role} @ ${r.company}`);
  revalidatePath("/command/applications");
}

/** Send a dismissed/closed job back to the review queue. */
export async function reopenJob(id: number): Promise<void> {
  await assertAdmin();
  await db
    .update(jobApplications)
    .set({ status: "found", updatedAt: new Date().toISOString() })
    .where(eq(jobApplications.id, id));
  revalidatePath("/command/applications");
}

/** Bump an approved job to the front of Whitney's queue (higher priority = sooner). */
export async function bumpPriority(id: number): Promise<void> {
  await assertAdmin();
  await db
    .update(jobApplications)
    .set({ priority: sql`${jobApplications.priority} + 1`, updatedAt: new Date().toISOString() })
    .where(eq(jobApplications.id, id));
  revalidatePath("/command/applications");
}

/** Answer a question Whitney posted. She reads it next run (list_answered_questions) and resumes. */
export async function answerQuestion(questionId: number, formData: FormData): Promise<void> {
  await assertAdmin();
  const answer = String(formData.get("answer") || "").trim();
  if (!answer) return;
  await db
    .update(agentQuestions)
    .set({ answer, status: "answered", answeredAt: new Date().toISOString() })
    .where(eq(agentQuestions.id, questionId));
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "agent_question_answered",
    summary: `Answered Whitney's question #${questionId}`,
    metadata: { questionId, via: "/command/applications" },
  });
  revalidatePath("/command/applications");
}

/**
 * Pause / resume Whitney. Sets agents.paused (survives roster sync). Her cron may
 * still fire, but her loop-entry MCP tools (list_approved_jobs / record_found_job)
 * read this flag and stand down, so she does no work while paused.
 */
export async function setWhitneyPaused(paused: boolean): Promise<void> {
  await assertAdmin();
  await db
    .update(agents)
    .set({ paused, updatedAt: new Date().toISOString() })
    .where(eq(agents.id, "whitney"));
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: paused ? "agent_paused" : "agent_resumed",
    summary: `${paused ? "Paused" : "Resumed"} Whitney`,
    metadata: { agent: "whitney", via: "/command/applications" },
  });
  revalidatePath("/command/applications");
}
