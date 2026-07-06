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

const PAGE_SIZE = 10; // LinkedIn rows
const PAGE_SIZE_SITES = 8; // web-dev cards are taller (approve/deny controls)
const PRIORITY_MIN_FIT = 5;
const BASE = "/command/prospects";

// Web-dev views are the focus; the LinkedIn funnel is demoted behind a link.
const WEBDEV_VIEWS = ["review", "queued", "built", "archive"] as const;
const LINKEDIN_VIEWS = ["priority", "queue", "ready", "sent"] as const;
type WebdevView = (typeof WEBDEV_VIEWS)[number];
type LinkedInView = (typeof LINKEDIN_VIEWS)[number];
type View = WebdevView | LinkedInView;

const SITE_TABS: Array<{ key: WebdevView; label: string }> = [
  { key: "review", label: "Needs review" },
  { key: "queued", label: "Queued to build" },
  { key: "built", label: "Built" },
  { key: "archive", label: "Denied / failed" },
];

const bucketOf = (status: string): WebdevView =>
  status === "discovered"
    ? "review"
    : status === "approved" || status === "building"
      ? "queued"
      : status === "built"
        ? "built"
        : "archive";

const hasGoogleFollowing = (i: ForgeSiteItem) =>
  Number(i.reviewCount || 0) > 0 || Number(i.googleRating || 0) > 0;

// Prioritize businesses with an established Google presence — those are the warmest leads.
const byFollowing = (a: ForgeSiteItem, b: ForgeSiteItem) =>
  (hasGoogleFollowing(b) ? 1 : 0) - (hasGoogleFollowing(a) ? 1 : 0) ||
  Number(b.reviewCount || 0) - Number(a.reviewCount || 0) ||
  Number(b.googleRating || 0) - Number(a.googleRating || 0) ||
  a.businessName.localeCompare(b.businessName);

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string; v?: string; q?: string; gf?: string }>;
}) {
  await requireAdmin();

  const sp = await searchParams;
  const allViews = [...WEBDEV_VIEWS, ...LINKEDIN_VIEWS] as readonly string[];
  const view: View = allViews.includes(sp.view || "") ? (sp.view as View) : "review";
  const isLinkedIn = (LINKEDIN_VIEWS as readonly string[]).includes(view);
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  const vertical = VERTICALS.some((x) => x.key === sp.v) ? (sp.v as string) : "";
  const gf = sp.gf === "only" ? "only" : "";
  const q = (sp.q || "").trim();
  const qLower = q.toLowerCase();

  // --- Web-dev leads (the forge queue) — always loaded; this is the primary surface. ---
  const forgeRows = await db.select().from(forgeSites).orderBy(desc(forgeSites.createdAt));
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
    claimCode: r.claimCode || "",
    claimed: Boolean(r.claimedByUserId),
    createdAt: r.createdAt,
    outreachStatus: r.outreachStatus || "none",
    outreachSubject: r.outreachSubject || "",
    outreachDraft: r.outreachDraft || "",
    contactedAt: r.contactedAt || "",
    followupCount: r.followupCount || 0,
    ownerName: r.ownerName || "",
    instagramUrl: r.instagramUrl || "",
    facebookUrl: r.facebookUrl || "",
    contactNotes: r.contactNotes || "",
  }));

  const siteCounts: Record<WebdevView, number> = { review: 0, queued: 0, built: 0, archive: 0 };
  for (const i of forgeItems) siteCounts[bucketOf(i.status)]++;
  const withFollowing = forgeItems.filter((i) => bucketOf(i.status) === "review" && hasGoogleFollowing(i)).length;

  let siteItems: ForgeSiteItem[] = [];
  if (!isLinkedIn) {
    siteItems = forgeItems.filter((i) => bucketOf(i.status) === view);
    if (q) {
      siteItems = siteItems.filter((i) =>
        `${i.businessName} ${i.city} ${i.serviceArea} ${i.niche}`.toLowerCase().includes(qLower),
      );
    }
    if (gf === "only") siteItems = siteItems.filter(hasGoogleFollowing);
    siteItems.sort(
      view === "built" || view === "archive"
        ? (a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")
        : byFollowing,
    );
  }

  // --- LinkedIn funnel — only queried when you actually open it (skips a heavy join otherwise). ---
  const byView: Record<LinkedInView, QueueItem[]> = { priority: [], queue: [], ready: [], sent: [] };
  const verticalCounts: Record<string, number> = {};
  if (isLinkedIn) {
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
    for (const i of all.filter(isPending)) verticalCounts[i.vertical] = (verticalCounts[i.vertical] || 0) + 1;

    const scoped = all.filter((i) => {
      if (vertical && i.vertical !== vertical) return false;
      if (qLower && !`${i.name} ${i.company} ${i.websiteUrl}`.toLowerCase().includes(qLower)) return false;
      return true;
    });

    const statusRank: Record<string, number> = { draft: 0, edited: 1 };
    byView.priority = scoped
      .filter((i) => isPending(i) && i.fitScore >= PRIORITY_MIN_FIT)
      .sort((a, b) => b.fitScore - a.fitScore || a.name.localeCompare(b.name));
    byView.queue = scoped
      .filter(isPending)
      .sort(
        (a, b) =>
          (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
          b.fitScore - a.fitScore ||
          a.name.localeCompare(b.name),
      );
    byView.ready = scoped
      .filter((i) => i.status === "approved")
      .sort((a, b) => (b.approvedAt || "").localeCompare(a.approvedAt || ""));
    byView.sent = scoped
      .filter((i) => i.status === "sent")
      .sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || ""));
  }

  const linkedinTabs: Array<{ key: LinkedInView; label: string; count: number }> = [
    { key: "priority", label: "Priority", count: byView.priority.length },
    { key: "queue", label: "Pending", count: byView.queue.length },
    { key: "ready", label: "Ready", count: byView.ready.length },
    { key: "sent", label: "Sent", count: byView.sent.length },
  ];

  const size = isLinkedIn ? PAGE_SIZE : PAGE_SIZE_SITES;
  const source = isLinkedIn ? byView[view as LinkedInView] : siteItems;
  const totalPages = Math.max(1, Math.ceil(source.length / size));
  const clampedPage = Math.min(page, totalPages);
  const linkedinPageItems = isLinkedIn ? (source as QueueItem[]).slice((clampedPage - 1) * size, clampedPage * size) : [];
  const sitePageItems = !isLinkedIn ? (source as ForgeSiteItem[]).slice((clampedPage - 1) * size, clampedPage * size) : [];

  const qs = (over: Record<string, string>) => {
    const params = new URLSearchParams();
    params.set("view", over.view ?? view);
    const vv = over.v ?? vertical;
    if (vv) params.set("v", vv);
    const gg = over.gf ?? gf;
    if (gg) params.set("gf", gg);
    const qq = over.q ?? q;
    if (qq) params.set("q", qq);
    if (over.page) params.set("page", over.page);
    return `${BASE}?${params.toString()}`;
  };

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight">Web-dev leads</h1>
          {isLinkedIn ? (
            <a href={qs({ view: "review", page: "" })} className="text-sm font-semibold text-brand hover:underline">
              ‹ Web-dev leads
            </a>
          ) : (
            <div className="flex items-center gap-4">
              <a href="/api/forge/export" className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink hover:bg-surface">
                ⬇ Export CSV
              </a>
              <a href="/command/analyzer" className="text-xs font-semibold text-brand hover:underline">
                Analyze a site ↗
              </a>
              <a href={qs({ view: "priority", page: "", v: "", gf: "" })} className="text-xs font-semibold text-ink-soft hover:text-ink">
                LinkedIn outreach →
              </a>
            </div>
          )}
        </div>

        {isLinkedIn ? (
          <>
            <div className="mt-6 flex flex-wrap gap-2 border-b border-line">
              {linkedinTabs.map((t) => {
                const active = t.key === view;
                return (
                  <a
                    key={t.key}
                    href={qs({ view: t.key, page: "" })}
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

            <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-1.5">
                <a
                  href={qs({ v: "", page: "" })}
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
                      href={qs({ v: active ? "" : vt.key, page: "" })}
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
                  <a href={qs({ q: "", page: "" })} className="text-xs font-semibold text-ink-soft hover:text-ink">
                    clear
                  </a>
                )}
              </form>
            </div>

            <div className="mt-5">
              <ReviewQueue items={linkedinPageItems} />
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-soft">
              Local businesses the prospector found that need a website. Approve the ones worth building —
              the forge builds, deploys, and reports back here.
            </p>

            <div className="mt-5 flex flex-wrap gap-2 border-b border-line">
              {SITE_TABS.map((t) => {
                const active = t.key === view;
                return (
                  <a
                    key={t.key}
                    href={qs({ view: t.key, page: "", gf: "" })}
                    className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                      active ? "border-brand text-brand" : "border-transparent text-ink-soft hover:text-ink"
                    }`}
                  >
                    {t.label}
                    <span className="ml-1.5 text-xs text-ink-soft">{siteCounts[t.key]}</span>
                  </a>
                );
              })}
            </div>

            <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-1.5">
                <a
                  href={qs({ gf: "", page: "" })}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    !gf ? "bg-brand text-white" : "bg-surface text-ink-soft hover:text-ink"
                  }`}
                >
                  All
                </a>
                <a
                  href={qs({ gf: "only", page: "" })}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    gf === "only" ? "bg-brand text-white" : "bg-surface text-ink-soft hover:text-ink"
                  }`}
                >
                  <span className="text-amber-500">★</span> Has Google following
                  {view === "review" && withFollowing ? (
                    <span className="opacity-70">{withFollowing}</span>
                  ) : null}
                </a>
              </div>
              <form action={BASE} method="get" className="flex w-full items-center gap-2 lg:w-auto">
                <input type="hidden" name="view" value={view} />
                {gf && <input type="hidden" name="gf" value={gf} />}
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="Search business, city, or niche"
                  className="min-w-0 flex-1 rounded-full border border-line bg-background px-4 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 lg:w-64"
                />
                {q && (
                  <a href={qs({ q: "", page: "" })} className="text-xs font-semibold text-ink-soft hover:text-ink">
                    clear
                  </a>
                )}
              </form>
            </div>

            <div className="mt-5">
              <SitesQueue items={sitePageItems} />
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
