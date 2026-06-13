"use server";

import { headers as nextHeaders } from "next/headers";
import { revalidatePath } from "next/cache";
import { getPayload } from "payload";

import config from "@payload-config";
import { isAdminEmail } from "@/lib/admin";

async function requireAdmin() {
  const payload = await getPayload({ config });
  const { user } = await payload.auth({ headers: await nextHeaders() });
  if (!user || !isAdminEmail((user as { email?: string }).email)) {
    throw new Error("Unauthorized");
  }
  return payload;
}

export async function approveDraft(id: string) {
  const payload = await requireAdmin();
  await payload.update({
    collection: "outreach",
    id,
    overrideAccess: true,
    data: { status: "approved", approvedAt: new Date().toISOString() },
  });
  revalidatePath("/command");
}

export async function denyDraft(id: string, reason?: string) {
  const payload = await requireAdmin();
  await payload.update({
    collection: "outreach",
    id,
    overrideAccess: true,
    data: { status: "denied", denyReason: reason || undefined },
  });
  revalidatePath("/command");
}

export async function editDraft(id: string, body: string) {
  const payload = await requireAdmin();
  await payload.update({
    collection: "outreach",
    id,
    overrideAccess: true,
    data: { body, status: "edited" },
  });
  revalidatePath("/command");
}

export async function markSent(id: string, prospectId: string) {
  const payload = await requireAdmin();
  await payload.update({
    collection: "outreach",
    id,
    overrideAccess: true,
    data: { status: "sent", sentAt: new Date().toISOString() },
  });
  if (prospectId) {
    await payload
      .update({
        collection: "prospects",
        id: prospectId,
        overrideAccess: true,
        data: { status: "connected" },
      })
      .catch(() => {});
  }
  revalidatePath("/command");
}
