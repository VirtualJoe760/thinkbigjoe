import type { Metadata } from "next";
import { desc } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { SitesQueue, type ForgeSiteItem } from "./sites-queue";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Forge sites",
  robots: { index: false, follow: false },
};

export default async function SitesPage() {
  await requireAdmin();

  const rows = await db.select().from(forgeSites).orderBy(desc(forgeSites.createdAt));

  const all: ForgeSiteItem[] = rows.map((r) => ({
    id: String(r.id),
    slug: r.slug,
    businessName: r.businessName,
    niche: r.niche || "",
    city: r.city || "",
    serviceArea: r.serviceArea || "",
    phone: r.phone || "",
    email: r.email || "",
    existingWebsiteUrl: r.existingWebsiteUrl || "",
    brandColor: r.brandColor || "",
    theme: r.theme || "",
    googleRating: r.googleRating || "",
    reviewCount: r.reviewCount || "",
    googleMapsUrl: r.googleMapsUrl || "",
    linkedinUrl: r.linkedinUrl || "",
    status: r.status,
    fitReason: r.fitReason || "",
    source: r.source || "",
    notes: r.notes || "",
    liveUrl: r.liveUrl || "",
    screenshotUrl: r.screenshotUrl || "",
    buildStatus: r.buildStatus || "",
    deniedReason: r.deniedReason || "",
    claimCode: r.claimCode || "",
    claimed: Boolean(r.claimedByUserId),
    createdAt: r.createdAt,
  }));

  const needsReview = all.filter((i) => i.status === "discovered");
  const queuedToBuild = all.filter((i) => i.status === "approved" || i.status === "building");
  const built = all.filter((i) => i.status === "built");
  const other = all.filter((i) => i.status === "denied" || i.status === "build_failed");

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Forge sites</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Local service businesses Venus found that need a website. Approve the ones worth building —
          the forge builds, deploys, and reports back here.
        </p>

        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
            Needs your review <span className="ml-1 text-ink">{needsReview.length}</span>
          </h2>
          <div className="mt-3">
            <SitesQueue items={needsReview} />
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
            Queued to build <span className="ml-1 text-ink">{queuedToBuild.length}</span>
          </h2>
          <div className="mt-3">
            <SitesQueue items={queuedToBuild} />
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
            Built — ready for outreach next <span className="ml-1 text-ink">{built.length}</span>
          </h2>
          <div className="mt-3">
            <SitesQueue items={built} />
          </div>
        </section>

        {other.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Denied / failed <span className="ml-1 text-ink">{other.length}</span>
            </h2>
            <div className="mt-3">
              <SitesQueue items={other} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
