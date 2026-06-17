"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db, automationSettings } from "@/db";
import { assertAdmin } from "@/lib/require-admin";

export interface AutomationInput {
  enabled: boolean;
  workDays: string;
  workStartHour: number;
  workEndHour: number;
  dailyGoal: number;
  rampEnabled: boolean;
  rampStart: number;
  rampWeeklyStep: number;
}

export async function saveAutomationSettings(input: AutomationInput) {
  await assertAdmin();

  const cur = (
    await db.select().from(automationSettings).where(eq(automationSettings.id, 1)).limit(1)
  )[0];

  // Stamp the ramp start date the first time automation is turned on, so the
  // ramp schedule has a fixed anchor. Clearing it on disable lets a later
  // re-enable restart the ramp fresh.
  const stampRamp = input.enabled && !cur?.rampStartedOn;

  await db
    .update(automationSettings)
    .set({
      enabled: input.enabled,
      workDays: input.workDays,
      workStartHour: Math.max(0, Math.min(23, input.workStartHour)),
      workEndHour: Math.max(1, Math.min(24, input.workEndHour)),
      dailyGoal: Math.max(1, Math.min(100, input.dailyGoal)),
      rampEnabled: input.rampEnabled,
      rampStart: Math.max(1, Math.min(100, input.rampStart)),
      rampWeeklyStep: Math.max(1, Math.min(50, input.rampWeeklyStep)),
      ...(stampRamp ? { rampStartedOn: new Date().toISOString().slice(0, 10) } : {}),
      ...(!input.enabled ? { rampStartedOn: null } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(automationSettings.id, 1));

  revalidatePath("/command/automation");
  revalidatePath("/command", "layout");
}
