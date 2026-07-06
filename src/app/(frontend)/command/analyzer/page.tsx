import type { Metadata } from "next";
import { desc } from "drizzle-orm";

import { db, siteAnalyses, rebuildRequests } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import type { SiteAnalysis } from "@/lib/site-analyzer";
import { Analyzer, type AnalysisRow, type RebuildRow } from "./analyzer-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Site analyzer",
  robots: { index: false, follow: false },
};

export default async function AnalyzerPage() {
  await requireAdmin();

  const [analyses, requests] = await Promise.all([
    db.select().from(siteAnalyses).orderBy(desc(siteAnalyses.createdAt)).limit(30),
    db.select().from(rebuildRequests).orderBy(desc(rebuildRequests.createdAt)).limit(30),
  ]);

  const analysisRows: AnalysisRow[] = analyses.map((r) => ({
    id: r.id,
    url: r.url,
    status: r.status,
    businessName: r.businessName,
    analysis: (r.analysis as SiteAnalysis | null) ?? null,
    createdAt: r.createdAt,
  }));
  const rebuildRows: RebuildRow[] = requests.map((r) => ({
    id: r.id,
    existingUrl: r.existingUrl,
    businessName: r.businessName,
    email: r.email,
    status: r.status,
    createdAt: r.createdAt,
  }));

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Site analyzer</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">
          Point this at an existing website and it pulls the business details, brand (logo, colors, fonts),
          services, socials and imagery — normalized so the forge can reuse it as inspiration for a rebuild.
        </p>
        <div className="mt-6">
          <Analyzer initialAnalyses={analysisRows} rebuildRequests={rebuildRows} />
        </div>
      </div>
    </div>
  );
}
