"use server";

import { and, eq, ilike, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, jobApplications, activityLog, agents, agentQuestions, agentDirectives, employerBlacklist, candidateFacts } from "@/db";
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

/**
 * Answer a question Whitney posted. She reads it next run (list_answered_questions) and resumes.
 * If the question carried a `topic` (a durable fact — work authorization, relocation, …), the
 * answer is remembered permanently so Whitney answers it herself next time and never re-asks.
 */
export async function answerQuestion(questionId: number, formData: FormData): Promise<void> {
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
    summary: `Answered Whitney's question #${questionId}${topic ? ` (remembered: ${topic})` : ""}`,
    metadata: { questionId, topic, via: "/command/applications" },
  });
  revalidatePath("/command/applications");
}

/**
 * Decline to answer a question Whitney posted — Joe's "I'm not answering this" gate.
 *
 * Declining is a DECISION, not a non-answer: the application the question was blocking is
 * cancelled outright (job → 'closed'), because a question she can't get past is a question
 * that makes the application unfinishable. She sees the decline next run via
 * list_answered_questions, resolves it, and moves to the next job — no re-asking, no guessing.
 *
 * Reversible: the job lands in the archive, where `reopenJob` sends it back to the review queue.
 */
export async function declineQuestion(questionId: number): Promise<void> {
  await assertAdmin();
  const now = new Date().toISOString();
  const rows = await db
    .update(agentQuestions)
    .set({ status: "declined", answeredAt: now })
    .where(eq(agentQuestions.id, questionId))
    .returning({ applicationId: agentQuestions.applicationId, question: agentQuestions.question });
  const q = rows[0];
  if (!q) return;

  let jobLabel = "";
  if (q.applicationId) {
    const closed = await db
      .update(jobApplications)
      .set({ status: "closed", updatedAt: now })
      .where(eq(jobApplications.id, q.applicationId))
      .returning({ company: jobApplications.company, role: jobApplications.role });
    const j = closed[0];
    if (j) jobLabel = ` — cancelled ${j.role} @ ${j.company}`;
  }

  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "agent_question_declined",
    summary: `Declined to answer Whitney's question #${questionId}${jobLabel}`,
    metadata: {
      questionId,
      applicationId: q.applicationId,
      question: q.question,
      via: "/command/applications",
    },
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

/**
 * Give an agent a direct instruction — Joe's manual override.
 *
 * The daily budget cap exists to stop *autonomous* waste (an agent waking with nothing to do and
 * spending a model call to work that out). It must never stop Joe: "go after Compass", "draft a
 * reply to this", "chase that lender" are the entire point of having agents. So an open directive
 * is worked FIRST and lifts that agent's cap until it's done.
 *
 * Agent-agnostic on purpose — a newly created agent is directable the day it's registered,
 * with no code change here.
 */
export async function directAgent(agent: string, formData: FormData): Promise<void> {
  await assertAdmin();
  const request = String(formData.get("request") || "").trim();
  if (!request) return;
  const context = String(formData.get("context") || "").trim() || null;
  const rows = await db
    .insert(agentDirectives)
    .values({ agent, request, context })
    .returning({ id: agentDirectives.id });
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "agent_directive_issued",
    summary: `Directed ${agent}: ${request.slice(0, 140)}`,
    metadata: { directiveId: rows[0]?.id, agent, via: "/command/applications" },
  });
  revalidatePath("/command/applications");
  revalidatePath("/command/inbox");
}

/** Withdraw an instruction the agent hasn't finished — it stops overriding the budget cap. */
export async function cancelDirective(id: number): Promise<void> {
  await assertAdmin();
  await db
    .update(agentDirectives)
    .set({ status: "cancelled", completedAt: new Date().toISOString() })
    .where(eq(agentDirectives.id, id));
  revalidatePath("/command/applications");
  revalidatePath("/command/inbox");
}

/** Normalizes an employer name the same way tbj-mcp's normEmployer() does, so one entry blocks
 *  every variant a job board throws at us ("Zillow" also blocks "Zillow Group Technologies LLC").
 *  Keep the two in sync — they are the same rule enforced on both sides of the DB. */
function normEmployer(c: string): string {
  return c.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|group|holdings|technologies|technology|labs|software|systems|solutions|the)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

/**
 * Blacklist an employer — Joe will not work there, so Whitney must never surface it again.
 * Enforced server-side in record_found_job, not just in her prompt: he should never have to
 * decline the same company twice. Also clears anything from them still awaiting his review.
 */
export async function blacklistEmployer(formData: FormData): Promise<void> {
  await assertAdmin();
  const company = String(formData.get("company") || "").trim();
  if (!company) return;
  const reason = String(formData.get("reason") || "").trim() || null;
  const key = normEmployer(company);
  if (!key) return;

  await db.insert(employerBlacklist).values({ company, normKey: key, reason })
    .onConflictDoUpdate({ target: employerBlacklist.normKey, set: { company, reason } });

  // Pull anything from them off the review board — leaving it there would just make him
  // decline the same company a second time, which is the thing this exists to prevent.
  const cleared = await db
    .update(jobApplications)
    .set({ status: "dismissed", updatedAt: new Date().toISOString() })
    .where(and(eq(jobApplications.status, "found"), ilike(jobApplications.company, `%${company}%`)))
    .returning({ id: jobApplications.id });

  await db.insert(activityLog).values({
    actor: "joe",
    eventType: "employer_blacklisted",
    summary: `Blacklisted ${company}${reason ? ` — ${reason}` : ""}${cleared.length ? ` (cleared ${cleared.length} from the board)` : ""}`,
    metadata: { company, reason, cleared: cleared.length, via: "/command/applications" },
  });
  revalidatePath("/command/applications");
}

/** Remove an employer from the blacklist — Whitney may surface them again. */
export async function unblacklistEmployer(id: number): Promise<void> {
  await assertAdmin();
  await db.delete(employerBlacklist).where(eq(employerBlacklist.id, id));
  revalidatePath("/command/applications");
}
