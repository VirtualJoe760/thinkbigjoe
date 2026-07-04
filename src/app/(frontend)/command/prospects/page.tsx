import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";

import { db, outreach, prospects, forgeSites } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { parseProspectRecon } from "@/lib/prospect-recon";
import { ReviewQueue, type QueueItem } from "../review-queue";
import { SitesQueue, type ForgeSiteItem } from "../sites/sites-queue";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Prospecting",
  robots: { index: false, follow: false },
};

const VERTICALS: Array<{ key: string; label: string }> = [
  { key: "insurance", label: "Insurance" },
  { key: "mortgage", label: "Mortgage" },
  { key: "wealth", label: "Wealth" },
  { key: "law", label: "Law" },
  { key: "msp", label: "MSP" },
  { key: "other", label: "Other" },
];

const PAGE_SIZE = 10;
const PRIORITY_MIN_FIT = 5;
const BASE = "/command/prospects";

type View = "priority" | "queue" | "ready" | "sent" | "sites";

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string; v?: string; q?: string }>;
}) {
  await requireAdmin();

  const sp = await searchParams;
  const view: View = (["priority", "queue", "ready", "sent", "sites"] as const).includes(
    sp.view as View,
  )
    ? (sp.view as View)
    : "sites";
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  const vertical = VERTICALS.some((x) => x.key === sp.v) ? (sp.v as string) : "";
  const q = (sp.q || "").trim();
  const qLower = q.toLowerCase();

  const rows = await db
    .select({
      id: outreach.id,
      body: outreach.body,
      status: outreach.status,
      updatedAt: outreach.updatedAt,
      approvedAt: outreach.approvedAt,
      sentAt: outreach.sentAt,
      prospectId: prospects.id,
      name: prospects.name,
      title: prospects.title,
      company: prospects.company,
      vertical: prospects.vertical,
      location: prospects.location,
      degree: prospects.degree,
      hook: prospects.hook,
      fitScore: prospects.fitScore,
      profileUrl: prospects.profileUrl,
      source: prospects.source,
      recon: prospects.recon,
    })
    .from(outreach)
    .innerJoin(prospects, eq(outreach.prospectId, prospects.id))
    .where(eq(outreach.step, "connection"));

  const all: QueueItem[] = rows.map((r) => ({
    id: String(r.id),
    body: r.body || "",
    status: String(r.status || "draft"),
    prospectId: String(r.prospectId),
    name: r.name || "Unknown",
    title: r.title || "",
    company: r.company || "",
    vertical: r.vertical ? String(r.vertical) : "",
    location: r.location || "",
    degree: r.degree || "",
    hook: r.hook || "",
    fitScore: Number(r.fitScore || 0),
    source: r.source || "",
    profileUrl: r.profileUrl || "",
    ...parseProspectRecon(r.recon),
    updatedAt: r.updatedAt || "",
    approvedAt: r.approvedAt || "",
    sentAt: r.sentAt || "",
  }));

  const isPending = (i: QueueItem) => i.status === "draft" || i.status === "edited";

  const verticalCounts: Record<string, number> = {};
  for (const i of all.filter(isPending)) {
    verticalCounts[i.vertical] = (verticalCounts[i.vertical] || 0) + 1;
  }

  const scoped = all.filter((i) => {
    if (vertical && i.vertical !== vertical) return false;
    if (qLower && !`${i.name} ${i.company} ${i.websiteUrl}`.toLowerCase().includes(qLower)) return false;
    return true;
  });

  const statusRank: Record<string, number> = { draft: 0, edited: 1 };
  const byView: Record<Exclude<View, "sites">, QueueItem[]> = {
    priority: scoped
      .filter((i) => isPending(i) && i.fitScore >= PRIORITY_MIN_FIT)
      .sort((a, b) => b.fitScore - a.fitScore || a.name.localeCompare(b.name)),
    queue: scoped
      .filter(isPending)
      .sort(
        (a, b) =>
          (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
          b.fitScore - a.fitScore ||
          a.name.localeCompare(b.name),
      ),
    ready: scoped
      .filter((i) => i.status === "approved")
      .sort((a, b) => (b.approvedAt || "").localeCompare(a.approvedAt || "")),
    sent: scoped
      .filter((i) => i.status === "sent")
      .sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || "")),
  };

  // Potential sites — the forge queue (businesses the prospector found that need a website).
  const forgeRows = await db
    .select()
    .from(forgeSites)
    .orderBy(desc(forgeSites.createdAt));
  const forgeItems: ForgeSiteItem[] = forgeRows.map((r) => ({
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
    createdAt: r.createdAt,
  }));
  const forgeNeedsReview = forgeItems.filter((i) => i.status === "discovered");
  const forgeQueued = forgeItems.filter((i) => i.status === "approved" || i.status === "building");
  const forgeBuilt = forgeItems.filter((i) => i.status === "built");
  const forgeOther = forgeItems.filter((i) => i.status === "denied" || i.status === "build_failed");

  const tabs: Array<{ key: View; label: string; count: number }> = [
    { key: "sites", label: "Web-dev leads", count: forgeNeedsReview.length },
    { key: "priority", label: "LinkedIn · Priority", count: byView.priority.length },
    { key: "queue", label: "LinkedIn · Pending", count: byView.queue.length },
    { key: "ready", label: "LinkedIn · Ready", count: byView.ready.length },
    { key: "sent", label: "LinkedIn · Sent", count: byView.sent.length },
  ];

  const items = view === "sites" ? [] : byView[view];
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const pageItems = items.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  const qs = (over: Record<string, string>) => {
    const params = new URLSearchParams();
    params.set("view", over.view ?? view);
    const vv = over.v ?? vertical;
    if (vv) params.set("v", vv);
    const qq = over.q ?? q;
    if (qq) params.set("q", qq);
    if (over.page) params.set("page", over.page);
    return `${BASE}?${params.toString()}`;
  };

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Prospecting</h1>

        <div className="mt-6 flex flex-wrap gap-2 border-b border-line">
          {tabs.map((t) => {
            const active = t.key === view;
            return (
              <a
                key={t.key}
                href={qs({ view: t.key })}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                  active ? "border-brand text-brand" : "border-transparent text-ink-soft hover:text-ink"
                }`}
              >
                {t.label}
                <span className="ml-1.5 text-xs text-ink-soft">{t.count}</span>
              </a>
            );
          })}
        </div>

        {view === "sites" ? (
          <div className="mt-6 space-y-8">
            <p className="text-sm text-ink-soft">
              Local businesses the prospector found that need a website. Approve the ones worth
              building — the forge builds, deploys, and reports back here.
            </p>
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
                Needs your review <span className="ml-1 text-ink">{forgeNeedsReview.length}</span>
              </h2>
              <div className="mt-3">
                <SitesQueue items={forgeNeedsReview} />
              </div>
            </section>
            {forgeQueued.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
                  Queued to build <span className="ml-1 text-ink">{forgeQueued.length}</span>
                </h2>
                <div className="mt-3">
                  <SitesQueue items={forgeQueued} />
                </div>
              </section>
            )}
            {forgeBuilt.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
                  Built — ready for outreach <span className="ml-1 text-ink">{forgeBuilt.length}</span>
                </h2>
                <div className="mt-3">
                  <SitesQueue items={forgeBuilt} />
                </div>
              </section>
            )}
            {forgeOther.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
                  Denied / failed <span className="ml-1 text-ink">{forgeOther.length}</span>
                </h2>
                <div className="mt-3">
                  <SitesQueue items={forgeOther} />
                </div>
              </section>
            )}
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-1.5">
                <a
                  href={qs({ v: "" })}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    !vertical ? "bg-brand text-white" : "bg-surface text-ink-soft hover:text-ink"
                  }`}
                >
                  All
                </a>
                {VERTICALS.map((vt) => {
                  const active = vertical === vt.key;
                  const c = verticalCounts[vt.key] || 0;
                  return (
                    <a
                      key={vt.key}
                      href={qs({ v: active ? "" : vt.key })}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        active ? "bg-brand text-white" : "bg-surface text-ink-soft hover:text-ink"
                      }`}
                    >
                      {vt.label}
                      {c ? <span className="ml-1 opacity-70">{c}</span> : null}
                    </a>
                  );
                })}
              </div>
              <form action={BASE} method="get" className="flex w-full items-center gap-2 lg:w-auto">
                <input type="hidden" name="view" value={view} />
                {vertical && <input type="hidden" name="v" value={vertical} />}
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="Search name, company, or site"
                  className="min-w-0 flex-1 rounded-full border border-line bg-background px-4 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 lg:w-64"
                />
                {q && (
                  <a href={qs({ q: "" })} className="text-xs font-semibold text-ink-soft hover:text-ink">
                    clear
                  </a>
                )}
              </form>
            </div>

            <div className="mt-5">
              <ReviewQueue items={pageItems} />
            </div>
          </>
        )}

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2 text-sm">
            {clampedPage > 1 ? (
              <a href={qs({ page: String(clampedPage - 1) })} className="rounded-full border border-line px-4 py-2 font-semibold transition-colors hover:bg-surface">
                ‹ Prev
              </a>
            ) : (
              <span className="rounded-full border border-line px-4 py-2 font-semibold opacity-40">‹ Prev</span>
            )}
            <span className="px-2 text-ink-soft">Page {clampedPage} of {totalPages}</span>
            {clampedPage < totalPages ? (
              <a href={qs({ page: String(clampedPage + 1) })} className="rounded-full border border-line px-4 py-2 font-semibold transition-colors hover:bg-surface">
                Next ›
              </a>
            ) : (
              <span className="rounded-full border border-line px-4 py-2 font-semibold opacity-40">Next ›</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
