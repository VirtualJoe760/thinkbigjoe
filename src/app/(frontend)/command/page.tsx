import type { Metadata } from "next";
import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { getPayload } from "payload";

import config from "@payload-config";
import { isAdminEmail } from "@/lib/admin";
import { Logo } from "@/components/logo";
import { ReviewQueue, type QueueItem } from "./review-queue";

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

const PAGE_SIZE = 10;
const PRIORITY_MIN_FIT = 5;

type View = "priority" | "queue" | "ready" | "sent";

export default async function CommandPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const payload = await getPayload({ config });
  const { user } = await payload.auth({ headers: await nextHeaders() });
  const email = (user as { email?: string } | null)?.email;
  if (!user || !isAdminEmail(email)) {
    redirect("/admin/login");
  }

  const sp = await searchParams;
  const view: View = (["priority", "queue", "ready", "sent"] as const).includes(
    sp.view as View,
  )
    ? (sp.view as View)
    : "priority";
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);

  const [outreachRes, prospectsRes] = await Promise.all([
    payload.find({
      collection: "outreach",
      where: { step: { equals: "connection" } },
      depth: 1,
      limit: 1000,
      overrideAccess: true,
    }),
    payload.find({ collection: "prospects", limit: 1000, overrideAccess: true }),
  ]);

  type ProspectRel = {
    id?: string;
    name?: string;
    title?: string;
    company?: string;
    vertical?: string;
    location?: string;
    degree?: string;
    hook?: string;
    fitScore?: number;
    profileUrl?: string;
  };

  const all: QueueItem[] = outreachRes.docs.map((d) => {
    const p = (typeof d.prospect === "object" ? d.prospect : {}) as ProspectRel;
    return {
      id: String(d.id),
      body: String(d.body || ""),
      status: String(d.status),
      prospectId: String(p.id || ""),
      name: p.name || "Unknown",
      title: p.title || "",
      company: p.company || "",
      vertical: p.vertical || "",
      location: p.location || "",
      degree: p.degree || "",
      hook: p.hook || "",
      fitScore: Number(p.fitScore || 0),
      profileUrl: p.profileUrl || "",
      updatedAt: (d.updatedAt as string) || "",
      approvedAt: (d.approvedAt as string) || "",
      sentAt: (d.sentAt as string) || "",
    };
  });

  const isPending = (i: QueueItem) =>
    i.status === "draft" || i.status === "edited";
  const statusRank: Record<string, number> = { draft: 0, edited: 1 };

  const byView: Record<View, QueueItem[]> = {
    priority: all
      .filter((i) => isPending(i) && i.fitScore >= PRIORITY_MIN_FIT)
      .sort((a, b) => b.fitScore - a.fitScore || a.name.localeCompare(b.name)),
    queue: all
      .filter(isPending)
      .sort(
        (a, b) =>
          (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
          b.fitScore - a.fitScore ||
          a.name.localeCompare(b.name),
      ),
    ready: all
      .filter((i) => i.status === "approved")
      .sort((a, b) => (b.approvedAt || "").localeCompare(a.approvedAt || "")),
    sent: all
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

  // pipeline + metrics
  const prospectStatus: Record<string, number> = {};
  for (const p of prospectsRes.docs) {
    const s = String(p.status || "new");
    prospectStatus[s] = (prospectStatus[s] || 0) + 1;
  }
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const sentWeek = all.filter(
    (i) => i.status === "sent" && i.sentAt && new Date(i.sentAt).getTime() > weekAgo,
  ).length;
  const metrics = [
    { label: "Priority", value: byView.priority.length, accent: "text-brand" },
    { label: "All pending", value: byView.queue.length, accent: "" },
    { label: "Ready to send", value: byView.ready.length, accent: "" },
    { label: "Sent this week", value: sentWeek, accent: "" },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        {/* nav */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-ink-soft">
              command center
            </span>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <a href="/admin" className="font-medium text-ink-soft hover:text-ink">
              Payload admin
            </a>
            <a href="/" className="font-medium text-ink-soft hover:text-ink">
              Site
            </a>
            <a
              href="/admin/logout"
              className="font-medium text-ink-soft hover:text-ink"
            >
              Sign out
            </a>
            <span className="hidden text-xs text-ink-soft sm:inline">{email}</span>
          </nav>
        </div>

        {/* metrics */}
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

        {/* pipeline */}
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

        {/* tabs */}
        <div className="mt-8 flex flex-wrap gap-2 border-b border-line">
          {tabs.map((t) => {
            const active = t.key === view;
            return (
              <a
                key={t.key}
                href={`/command?view=${t.key}`}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? "border-brand text-brand"
                    : "border-transparent text-ink-soft hover:text-ink"
                }`}
              >
                {t.label}
                <span className="ml-1.5 text-xs text-ink-soft">{t.count}</span>
              </a>
            );
          })}
        </div>

        <div className="mt-5">
          <ReviewQueue items={pageItems} />
        </div>

        {/* pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2 text-sm">
            {clampedPage > 1 ? (
              <a
                href={`/command?view=${view}&page=${clampedPage - 1}`}
                className="rounded-full border border-line px-4 py-2 font-semibold transition-colors hover:bg-surface"
              >
                ‹ Prev
              </a>
            ) : (
              <span className="rounded-full border border-line px-4 py-2 font-semibold opacity-40">
                ‹ Prev
              </span>
            )}
            <span className="px-2 text-ink-soft">
              Page {clampedPage} of {totalPages}
            </span>
            {clampedPage < totalPages ? (
              <a
                href={`/command?view=${view}&page=${clampedPage + 1}`}
                className="rounded-full border border-line px-4 py-2 font-semibold transition-colors hover:bg-surface"
              >
                Next ›
              </a>
            ) : (
              <span className="rounded-full border border-line px-4 py-2 font-semibold opacity-40">
                Next ›
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
