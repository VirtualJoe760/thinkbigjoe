import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { EditWorkspace } from "./edit-workspace";

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
  const owns = site.claimedByUserId === session.user.id || isAdminEmail(session.user.email);
  if (!owns) redirect("/portal");

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
