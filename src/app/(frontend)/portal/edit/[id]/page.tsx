import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";

export const metadata: Metadata = {
  title: "Edit your site",
  robots: { index: false, follow: false },
};

export default async function EditSitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const siteId = Number(id);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/login?redirect=/portal/edit/${id}`);

  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, siteId)).limit(1);
  if (!site) notFound();
  const owns = site.claimedByUserId === session.user.id || isAdminEmail(session.user.email);
  if (!owns) redirect("/portal");

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-line bg-background px-5 py-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-brand uppercase">Live edit mode</p>
          <p className="text-sm font-bold tracking-tight">{site.businessName}</p>
        </div>
        <Link
          href="/portal"
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface"
        >
          Done
        </Link>
      </header>
      {site.liveUrl ? (
        <iframe
          src={`/api/site-proxy/${siteId}`}
          title={`${site.businessName} — edit`}
          className="min-h-0 flex-1 border-0"
          // allow-scripts + allow-same-origin: the site hydrates and the editor
          // (same-origin) can call our API. NO allow-top-navigation / allow-popups
          // → the browser blocks any attempt to break out of the frame.
          sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-ink-soft">
          Your site isn&apos;t live yet — check back once it&apos;s built.
        </div>
      )}
    </div>
  );
}
