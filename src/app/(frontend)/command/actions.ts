"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";

import { db, outreach, prospects, forgeSites } from "@/db";
import { assertAdmin } from "@/lib/require-admin";

const now = () => new Date().toISOString();

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
  await db
    .update(forgeSites)
    .set({ status: "denied", deniedReason: reason || null })
    .where(eq(forgeSites.id, Number(id)));
  revalidatePath("/command/sites");
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
