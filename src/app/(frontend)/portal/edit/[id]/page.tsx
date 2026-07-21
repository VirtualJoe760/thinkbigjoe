import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";

import { db, forgeSites, editRequests } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { trialStatus } from "@/lib/trial";
import { EditWorkspace } from "./edit-workspace";
import { BuildLock } from "./build-lock";

export const metadata: Metadata = {
  title: "Edit your site",
  robots: { index: false, follow: false },
};

export default async function EditSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const siteId = Number(id);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/login?redirect=/portal/edit/${id}${tab === "studio" ? "?tab=studio" : ""}`);

  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, siteId)).limit(1);
  if (!site) notFound();
  const isAdmin = isAdminEmail(session.user.email);
  const owns = site.claimedByUserId === session.user.id || isAdmin;
  if (!owns) redirect("/portal");

  // Trial gate: once the 7-day trial ends unpaid, editing/Studio lock (admins bypass).
  // The site stays viewable — this only blocks the editor.
  if (!isAdmin && !trialStatus(site).canEdit) redirect(`/portal?locked=${siteId}`);

  // ONE build at a time: while a batch is being applied (requested/applying), the whole workspace
  // locks behind a friendly building screen — more edits mid-build would target a moving site.
  // The screen polls and unlocks itself; POST /api/edit-requests is the server-side backstop.
  const pending = await db
    .select({ id: editRequests.id })
    .from(editRequests)
    .where(and(eq(editRequests.siteId, siteId), inArray(editRequests.status, ["requested", "applying"])))
    .limit(1);
  if (pending.length > 0) {
    return <BuildLock siteId={siteId} businessName={site.businessName} liveUrl={site.liveUrl} />;
  }

  return (
    <EditWorkspace
      siteId={siteId}
      liveUrl={site.liveUrl}
      businessName={site.businessName}
      currentTemplate={site.preferredTemplate}
      initialTab={tab === "studio" ? "studio" : tab === "design" ? "design" : "site"}
    />
  );
}
