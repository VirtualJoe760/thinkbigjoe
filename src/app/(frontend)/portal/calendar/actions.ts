"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db, googleConnections } from "@/db";
import { disconnectGoogle } from "@/lib/google-oauth";

export async function disconnectGoogleAction(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return;
  await disconnectGoogle(session.user.id);
  revalidatePath("/portal/calendar");
}

/** Rename the category their website/AI bookings appear under on the calendar. */
export async function setBookingLabel(label: string): Promise<{ ok: boolean }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false };
  await db
    .update(googleConnections)
    .set({ bookingLabel: (label || "").trim().slice(0, 60) || "Website & AI bookings", updatedAt: new Date().toISOString() })
    .where(eq(googleConnections.userId, session.user.id));
  revalidatePath("/portal/calendar");
  return { ok: true };
}
