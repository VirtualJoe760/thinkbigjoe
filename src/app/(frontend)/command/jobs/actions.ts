"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db, coworkJobs } from "@/db";
import { assertAdmin } from "@/lib/require-admin";

export async function cancelJob(id: number) {
  await assertAdmin();
  await db
    .update(coworkJobs)
    .set({ status: "cancelled", updatedAt: new Date().toISOString() })
    .where(eq(coworkJobs.id, id));
  revalidatePath("/command/jobs");
}

export async function requeueJob(id: number) {
  await assertAdmin();
  await db
    .update(coworkJobs)
    .set({ status: "queued", resultSummary: null, updatedAt: new Date().toISOString() })
    .where(eq(coworkJobs.id, id));
  revalidatePath("/command/jobs");
}

export async function clearFinished() {
  await assertAdmin();
  // Drop done/cancelled/failed rows to keep the list tidy.
  await db.delete(coworkJobs).where(eq(coworkJobs.status, "done"));
  await db.delete(coworkJobs).where(eq(coworkJobs.status, "cancelled"));
  revalidatePath("/command/jobs");
}
