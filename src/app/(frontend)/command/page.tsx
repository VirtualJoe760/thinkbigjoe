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

export default async function CommandPage() {
  const payload = await getPayload({ config });
  const { user } = await payload.auth({ headers: await nextHeaders() });
  if (!user || !isAdminEmail((user as { email?: string }).email)) {
    redirect("/admin/login");
  }

  const [outreachRes, prospectsRes] = await Promise.all([
    payload.find({
      collection: "outreach",
      where: { step: { equals: "connection" } },
      depth: 1,
      limit: 300,
      overrideAccess: true,
    }),
    payload.find({ collection: "prospects", limit: 500, overrideAccess: true }),
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

  const rank: Record<string, number> = { draft: 0, edited: 1, approved: 2 };
  const queue: QueueItem[] = outreachRes.docs
    .filter((d) => ["draft", "edited", "approved"].includes(String(d.status)))
    .map((d) => {
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
      };
    })
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));

  // counts
  const prospectStatus: Record<string, number> = {};
  for (const p of prospectsRes.docs) {
    const s = String(p.status || "new");
    prospectStatus[s] = (prospectStatus[s] || 0) + 1;
  }
  const inQueue = queue.filter((q) => q.status !== "approved").length;
  const ready = queue.filter((q) => q.status === "approved").length;

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const sentWeek = outreachRes.docs.filter(
    (d) =>
      String(d.status) === "sent" &&
      d.sentAt &&
      new Date(d.sentAt as string).getTime() > weekAgo,
  ).length;

  const metrics = [
    { label: "Awaiting review", value: inQueue, accent: "text-brand" },
    { label: "Ready to send", value: ready, accent: "" },
    { label: "Sent this week", value: sentWeek, accent: "" },
    { label: "Booked", value: prospectStatus["meeting"] || 0, accent: "text-brand" },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-ink-soft">
              command center
            </span>
          </div>
          <span className="text-xs text-ink-soft">
            signed in as {(user as { email?: string }).email}
          </span>
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

        {/* review queue */}
        <div className="mt-8 mb-3 flex items-center gap-2">
          <h1 className="text-lg font-bold tracking-tight">Review queue</h1>
          <span className="text-sm text-ink-soft">
            {inQueue} awaiting · {ready} ready to send
          </span>
        </div>
        <ReviewQueue items={queue} />
      </div>
    </div>
  );
}
