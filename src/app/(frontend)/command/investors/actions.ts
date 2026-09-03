"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, investors, activityLog, agents } from "@/db";
import { assertAdmin } from "@/lib/require-admin";

// Joe's controls over Vera's investor pipeline (ChatRealty raise — NOT ThinkBigJoe).
//
// Vera researches and tiers; Joe overrides. The one thing he can't do from here is contact
// anyone: that path runs Vera → Edward (drafts) → Venus (approves) → Joe (sends), and this
// board deliberately has no send button. An investor is a name you get to spend once.

const PATH = "/command/investors";

async function logDecision(id: number, eventType: string, summary: string) {
  await db.insert(activityLog).values({
    actor: "joe",
    eventType,
    summary,
    metadata: { id, via: PATH },
  });
}

/** Re-tier. Joe's read of fit beats Vera's — she scores axes, he knows the room. */
export async function setInvestorTier(id: number, tier: "T1" | "T2" | "T3"): Promise<void> {
  await assertAdmin();
  const rows = await db
    .update(investors)
    .set({ tier, updatedAt: new Date().toISOString() })
    .where(eq(investors.id, id))
    .returning({ name: investors.name });
  if (rows[0]) await logDecision(id, "investor_retiered", `${rows[0].name} → ${tier}`);
  revalidatePath(PATH);
}

/**
 * Disqualify, with a reason. The reason is not optional and not decoration: it is the only
 * thing that stops Vera re-researching and re-adding the same person next month, which is
 * exactly how a pipeline quietly starts looping.
 */
export async function disqualifyInvestor(id: number, reason: string): Promise<void> {
  await assertAdmin();
  const clean = reason.trim();
  if (!clean) throw new Error("A disqualification needs a reason.");
  const rows = await db
    .update(investors)
    .set({ status: "disqualified", disqualifiedReason: clean, updatedAt: new Date().toISOString() })
    .where(eq(investors.id, id))
    .returning({ name: investors.name });
  if (rows[0]) await logDecision(id, "investor_disqualified", `${rows[0].name} — ${clean}`);
  revalidatePath(PATH);
}

/** Move an investor along (or back) by hand — e.g. Joe met them at an event and it's live now. */
export async function setInvestorStatus(id: number, status: string): Promise<void> {
  await assertAdmin();
  const allowed = ["qualified", "drafting", "awaiting_approval", "contacted", "replied", "passed", "disqualified"];
  if (!allowed.includes(status)) throw new Error(`Unknown status: ${status}`);
  const rows = await db
    .update(investors)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(investors.id, id))
    .returning({ name: investors.name });
  if (rows[0]) await logDecision(id, "investor_status_changed", `${rows[0].name} → ${status}`);
  revalidatePath(PATH);
}

/** Stop Vera. add_investor checks this and stands her down mid-run rather than at the next cron. */
export async function setVeraPaused(paused: boolean): Promise<void> {
  await assertAdmin();
  await db
    .update(agents)
    .set({ paused, updatedAt: new Date().toISOString() })
    .where(eq(agents.id, "angel-scout"));
  await db.insert(activityLog).values({
    actor: "joe",
    eventType: paused ? "agent_paused" : "agent_resumed",
    summary: `${paused ? "Paused" : "Resumed"} Vera`,
    metadata: { agent: "angel-scout", via: PATH },
  });
  revalidatePath(PATH);
}
