import type { Metadata } from "next";
import { eq } from "drizzle-orm";

import { db, outreach, prospects } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { Logo } from "@/components/logo";
import { ReviewQueue, type QueueItem } from "./review-queue";
import { SignOut } from "./sign-out";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Command Center",
  robots: { index: false, follow: false },
};

const PIPELINE: Array<{ key: string; label: string }> = [
  { key: "new", label: "New" },
  { key: "qualified", label: "Qualified" },
  { key: "note_ready", label: "Note ready" },
  { key: "connected", label: "Connected" },
  { key: "replied", label: "Replied" },
  { key: "meeting", label: "Booked" },
];

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

type View = "priority" | "queue" | "ready" | "sent";

export default async function CommandPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string; v?: string; q?: string }>;
}) {
  const { email } = await requireAdmin();

  const sp = await searchParams;
  const view: View = (["priority", "queue", "ready", "sent"] as const).includes(
    sp.view as View,
  )
    ? (sp.view as View)
    : "priority";
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  const vertical = VERTICALS.some((x) => x.key === sp.v) ? (sp.v as string) : "";
  const q = (sp.q || "").trim();
  const qLower = q.toLowerCase();

  const [rows, allProspects] = await Promise.all([
    db
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
      })
      .from(outreach)
      .innerJoin(prospects, eq(outreach.prospectId, prospects.id))
      .where(eq(outreach.step, "connection")),
    db.select({ status: prospects.status }).from(prospects),
  ]);

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
    profileUrl: r.profileUrl || "",
    updatedAt: r.updatedAt || "",
    approvedAt: r.approvedAt || "",
    sentAt: r.sentAt || "",
  }));

  const isPending = (i: QueueItem) =>
    i.status === "draft" || i.status === "edited";

  const verticalCounts: Record<string, number> = {};
  for (const i of all.filter(isPending)) {
    verticalCounts[i.vertical] = (verticalCounts[i.vertical] || 0) + 1;
  }

  const scoped = all.filter((i) => {
    if (vertical && i.vertical !== vertical) return false;
    if (qLower && !`${i.name} ${i.company}`.toLowerCase().includes(qLower))
      return false;
    return true;
  });

  const statusRank: Record<string, number> = { draft: 0, edited: 1 };
  const byView: Record<View, QueueItem[]> = {
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

  const tabs: Array<{ key: View; label: string; count: number }> = [
    { key: "priority", label: "Priority", count: byView.priority.length },
    { key: "queue", label: "All pending", count: byView.queue.length },
    { key: "ready", label: "Ready to send", count: byView.ready.length },
    { key: "sent", label: "Sent", count: byView.sent.length },
  ];

  const items = byView[view];
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const pageItems = items.slice(
    (clampedPage - 1) * PAGE_SIZE,
    clampedPage * PAGE_SIZE,
  );

  const prospectStatus: Record<string, number> = {};
  for (const p of allProspects) {
    const s = String(p.status || "new");
    prospectStatus[s] = (prospectStatus[s] || 0) + 1;
  }
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const sentWeek = all.filter(
    (i) => i.status === "sent" && i.sentAt && new Date(i.sentAt).getTime() > weekAgo,
  ).length;
  const metrics = [
    { label: "Priority", value: all.filter((i) => isPending(i) && i.fitScore >= PRIORITY_MIN_FIT).length, accent: "text-brand" },
    { label: "All pending", value: all.filter(isPending).length, accent: "" },
    { label: "Ready to send", value: all.filter((i) => i.status === "approved").length, accent: "" },
    { label: "Sent this week", value: sentWeek, accent: "" },
  ];

  const qs = (over: Record<string, string>) => {
    const params = new URLSearchParams();
    params.set("view", over.view ?? view);
    const vv = over.v ?? vertical;
    if (vv) params.set("v", vv);
    const qq = over.q ?? q;
    if (qq) params.set("q", qq);
    if (over.page) params.set("page", over.page);
    return `/command?${params.toString()}`;
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-ink-soft">
              command center
            </span>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <a href="/" className="font-medium text-ink-soft hover:text-ink">
              Site
            </a>
            <SignOut />
            <span className="hidden text-xs text-ink-soft sm:inline">{email}</span>
          </nav>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-xl bg-surface p-4">
              <div className="text-sm text-ink-soft">{m.label}</div>
              <div className={`mt-1 text-3xl font-extrabold tracking-tight ${m.accent}`}>
                {m.value}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-stretch gap-1.5 overflow-x-auto">
          {PIPELINE.map((stage, i) => (
            <div key={stage.key} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-ink-soft/40">›</span>}
              <div className="min-w-[84px] rounded-xl bg-surface px-3 py-2 text-center">
                <div className="text-lg font-bold">{prospectStatus[stage.key] || 0}</div>
                <div className="text-[11px] text-ink-soft">{stage.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-2 border-b border-line">
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

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
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
          <form action="/command" method="get" className="flex items-center gap-2">
            <input type="hidden" name="view" value={view} />
            {vertical && <input type="hidden" name="v" value={vertical} />}
            <input
              name="q"
              defaultValue={q}
              placeholder="Search name or company"
              className="w-52 rounded-full border border-line bg-background px-4 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
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
