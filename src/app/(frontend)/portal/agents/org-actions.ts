"use server";

import { desc, eq, sql } from "drizzle-orm";

import { agentMessages, db } from "@/db";
import { assertAdmin } from "@/lib/require-admin";

export type AgentMsg = {
  id: number;
  direction: "to_agent" | "from_agent";
  body: string;
  status: string;
  createdAt: string;
};

/**
 * Queue a message for an OpenClaw agent. The web app can't reach the gateway (localhost on the
 * Mac), so rows queue here and scripts/agent-bridge.mjs delivers them within ~a minute and writes
 * the agent's reply back. Admin-only.
 */
export async function sendAgentMessage(agentId: string, body: string): Promise<void> {
  await assertAdmin();
  const text = (body || "").trim();
  if (!text || !agentId) return;
  await db.insert(agentMessages).values({ agentId, direction: "to_agent", body: text.slice(0, 4000) });
}

/** The recent thread with one agent, oldest→newest. Polled by the chat panel. Admin-only. */
export async function getAgentThread(agentId: string, limit = 40): Promise<AgentMsg[]> {
  await assertAdmin();
  const rows = await db
    .select({
      id: agentMessages.id,
      direction: agentMessages.direction,
      body: agentMessages.body,
      status: agentMessages.status,
      createdAt: agentMessages.createdAt,
    })
    .from(agentMessages)
    .where(eq(agentMessages.agentId, agentId))
    .orderBy(desc(agentMessages.createdAt))
    .limit(limit);
  return rows.reverse().map((r) => ({ ...r, direction: r.direction as AgentMsg["direction"], createdAt: String(r.createdAt) }));
}

/** Recent inter-agent + cron activity for one agent (what it's been DOING), from activity_log. */
export async function getAgentActivity(agentLike: string, limit = 12): Promise<Array<{ summary: string; at: string }>> {
  await assertAdmin();
  const rows = (
    await db.execute(sql`
      SELECT summary, created_at FROM activity_log
      WHERE actor = ${agentLike} OR summary ILIKE ${"%" + agentLike + "%"}
      ORDER BY created_at DESC LIMIT ${limit}`)
  ).rows as Array<{ summary: string; created_at: string }>;
  return rows.map((r) => ({ summary: r.summary, at: String(r.created_at) }));
}
