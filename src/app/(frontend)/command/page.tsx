import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";

import { db, outreach, prospects, leads } from "@/db";
import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Overview",
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

export default async function OverviewPage() {
  await requireAdmin();

  const [rows, leadRows] = await Promise.all([
    db
      .select({
        outreachStatus: outreach.status,
        sentAt: outreach.sentAt,
        fitScore: prospects.fitScore,
        name: prospects.name,
        prospectId: prospects.id,
        vertical: prospects.vertical,
        pstatus: prospects.status,
      })
      .from(outreach)
      .innerJoin(prospects, eq(outreach.prospectId, prospects.id))
      .where(eq(outreach.step, "connection")),
    db.select().from(leads),
  ]);

  const pending = rows.filter(
    (r) => r.outreachStatus === "draft" || r.outreachStatus === "edited",
  );
  const priority = pending.filter((r) => Number(r.fitScore || 0) >= 5);
  const ready = rows.filter((r) => r.outreachStatus === "approved").length;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const sentWeek = rows.filter(
    (r) => r.outreachStatus === "sent" && r.sentAt && new Date(r.sentAt).getTime() > weekAgo,
  ).length;

  const booked = leadRows.filter((l) => l.status === "booked" || l.bookedSlot).length;

  const pipelineCounts: Record<string, number> = {};
  for (const r of rows) {
    const s = String(r.pstatus || "new");
    pipelineCounts[s] = (pipelineCounts[s] || 0) + 1;
  }

  const topPriority = [...priority]
    .sort((a, b) => Number(b.fitScore || 0) - Number(a.fitScore || 0))
    .slice(0, 5);

  const recentLeads = [...leadRows]
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 5);

  const metrics = [
    { label: "Prospects", value: rows.length, accent: "" },
    { label: "Priority", value: priority.length, accent: "text-brand" },
    { label: "Ready to send", value: ready, accent: "" },
    { label: "Sent this week", value: sentWeek, accent: "" },
    { label: "Inbound leads", value: leadRows.length, accent: "" },
    { label: "Booked calls", value: booked, accent: "text-brand" },
  ];

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-ink-soft">Your prospecting and pipeline at a glance.</p>

        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-xl bg-surface p-4">
              <div className="text-sm text-ink-soft">{m.label}</div>
              <div className={`mt-1 text-3xl font-extrabold tracking-tight ${m.accent}`}>
                {m.value}
              </div>
            </div>
          ))}
        </div>

        <h2 className="mt-8 mb-2 text-sm font-bold tracking-wide text-ink-soft uppercase">
          Pipeline
        </h2>
        <div className="flex items-stretch gap-1.5 overflow-x-auto">
          {PIPELINE.map((stage, i) => (
            <div key={stage.key} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-ink-soft/40">›</span>}
              <div className="min-w-[84px] rounded-xl bg-surface px-3 py-2 text-center">
                <div className="text-lg font-bold">{pipelineCounts[stage.key] || 0}</div>
                <div className="text-[11px] text-ink-soft">{stage.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-line bg-background p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Top priority</h2>
              <Link href="/command/prospects?view=priority" className="text-xs font-semibold text-brand hover:underline">
                Open queue
              </Link>
            </div>
            {topPriority.length === 0 ? (
              <p className="text-sm text-ink-soft">No priority prospects pending.</p>
            ) : (
              <ul className="space-y-2">
                {topPriority.map((p) => (
                  <li key={p.prospectId}>
                    <Link
                      href={`/command/${p.prospectId}`}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface"
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                        fit {Number(p.fitScore || 0)}/6
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-background p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Recent inbound leads</h2>
              <Link href="/command/leads" className="text-xs font-semibold text-brand hover:underline">
                All leads
              </Link>
            </div>
            {recentLeads.length === 0 ? (
              <p className="text-sm text-ink-soft">No inbound leads yet — they arrive via the site forms.</p>
            ) : (
              <ul className="space-y-2">
                {recentLeads.map((l) => (
                  <li key={l.id} className="rounded-lg px-2 py-1.5 text-sm">
                    <span className="font-medium">{l.name}</span>
                    {l.company ? <span className="text-ink-soft"> · {l.company}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
