"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db, replyDrafts, conversations, prospects } from "@/db";
import { requireAdmin } from "@/lib/require-admin";

export async function approveReply(draftId: number, text: string) {
  await requireAdmin();
  await db
    .update(replyDrafts)
    .set({ status: "approved", finalText: text, updatedAt: new Date().toISOString() })
    .where(eq(replyDrafts.id, draftId));
  revalidatePath("/command/[id]", "page");
}

export async function pauseReply(draftId: number, prospectId: number) {
  await requireAdmin();
  await db
    .update(replyDrafts)
    .set({ status: "paused", updatedAt: new Date().toISOString() })
    .where(eq(replyDrafts.id, draftId));
  await db
    .update(prospects)
    .set({ paused: true, updatedAt: new Date().toISOString() })
    .where(eq(prospects.id, prospectId));
  revalidatePath("/command/[id]", "page");
}

export async function saveOutboundMessage(prospectId: number, body: string) {
  await requireAdmin();
  await db.insert(conversations).values({
    prospectId,
    direction: "outbound",
    body,
    platform: "linkedin",
  });
  revalidatePath("/command/[id]", "page");
}
