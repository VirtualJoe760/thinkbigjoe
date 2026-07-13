"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { disconnectGoogle } from "@/lib/google-oauth";

export async function disconnectGoogleAction(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return;
  await disconnectGoogle(session.user.id);
  revalidatePath("/portal/calendar");
}
