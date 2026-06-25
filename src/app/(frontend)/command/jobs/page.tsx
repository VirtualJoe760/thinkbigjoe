import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";

import { db, activityLog } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { VENUS_CRONS } from "@/lib/venus-crons.mjs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Audit log",
  robots: { index: false, follow: false },
};

const ICONS: Record<string, string> = {
  // verified per-action events
  prospect_added: "➕",
  prospect_enriched: "✨",
  outreach_sent: "📤",
  reply_received: "📥",
  reply_drafted: "✍️",
  reply_approved: "✅",
  reply_paused: "⏸️",
  followup_scheduled: "🗓️",
  followup_sent: "💬",
  booking_made: "📅",
  // rollup summaries Venus reports
  scout_complete: "🔍",
  followups_scheduled: "📋",
};

// event_type → which cron/agent owns it (from the manifest's declared eventTypes)
const AGENT_BY_EVENT: Record<string, string> = {};
for (const cron of VENUS_CRONS) {
  for (const et of cron.eventTypes) {
    if (!AGENT_BY_EVENT[et]) AGENT_BY_EVENT[et] = cron.name;
  }
}
function agentFor(eventType: string): string {
  return AGENT_BY_EVENT[eventType] ?? "Venus (ad-hoc)";
}

function relativeTime(iso: string | Date | null): string {
  if (!iso) return "";
  const d = new Date(iso as string);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

type Meta = { auto?: boolean; prospectId?: number | null; target?: string | null; detail?: Record<string, unknown> | null };

// Pull the most human-relevant snippet out of the detail blob.
function detailSnippet(meta: Meta | null): string | null {
  const d = meta?.detail;
  if (!d || typeof d !== "object") return null;
  const pick = (d.note ?? d.body ?? d.message ?? d.draft ?? d.finalText) as string | undefined;
  if (typeof pick === "string" && pick.trim()) return pick.trim();
  if (Array.isArray(d.fields) && d.fields.length) return `fields: ${d.fields.join(", ")}`;
  return null;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  await requireAdmin();
  const { type } = await searchParams;

  const rows = await db
    .select()
    .from(activityLog)
    .orderBy(desc(activityLog.createdAt))
    .limit(300);

  const filtered = type ? rows.filter((r) => r.eventType === type) : rows;

  // distinct event types present, for filter chips
  const presentTypes = Array.from(new Set(rows.map((r) => r.eventType)));

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every action Venus and her scheduled agents take.{" "}
          <span className="font-medium text-ink">Verified</span> rows are written by the action
          itself as it hits the database — they reflect what actually happened, not what Venus
          reported. Each row is attributed to the cron that ran it.
        </p>

        {/* filter chips */}
        <div className="mt-5 flex flex-wrap gap-1.5">
          <Link
            href="/command/jobs"
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              !type ? "bg-brand text-white" : "bg-surface text-ink-soft hover:text-ink"
            }`}
          >
            All
          </Link>
          {presentTypes.map((t) => (
            <Link
              key={t}
              href={`/command/jobs?type=${encodeURIComponent(t)}`}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                type === t ? "bg-brand text-white" : "bg-surface text-ink-soft hover:text-ink"
              }`}
            >
              {ICONS[t] ?? "✦"} {t.replace(/_/g, " ")}
            </Link>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-line bg-background p-10 text-center text-ink-soft">
            No actions logged yet.
          </div>
        ) : (
          <div className="mt-5 divide-y divide-line rounded-2xl border border-line bg-background">
            {filtered.map((entry) => {
              const meta = (entry.metadata ?? null) as Meta | null;
              const verified = meta?.auto === true;
              const snippet = detailSnippet(meta);
              const pid = meta?.prospectId ?? null;
              const target = meta?.target ?? null;
              return (
                <div key={entry.id} className="flex items-start gap-3 px-5 py-4">
                  <span className="mt-0.5 shrink-0 text-lg leading-none">
                    {ICONS[entry.eventType] ?? "✦"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">
                      {pid ? (
                        <Link href={`/command/${pid}`} className="font-medium text-brand hover:underline">
                          {entry.summary}
                        </Link>
                      ) : (
                        entry.summary
                      )}
                    </p>
                    {snippet && (
                      <p className="mt-1 line-clamp-2 rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed text-ink-soft">
                        {snippet}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          verified ? "bg-green-50 text-green-700" : "bg-surface text-ink-soft"
                        }`}
                      >
                        {verified ? "verified" : "reported"}
                      </span>
                      <span className="text-[11px] text-ink-soft">{agentFor(entry.eventType)}</span>
                      <span className="text-[11px] text-ink-soft">· {entry.eventType.replace(/_/g, " ")}</span>
                      {target && !pid && (
                        <span className="text-[11px] text-ink-soft">· {target}</span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-xs text-ink-soft">
                    {relativeTime(entry.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-4 text-xs text-ink-soft">
          Showing the last {rows.length} entries.{" "}
          <span className="font-medium text-ink">Verified</span> = written by the MCP tool as the
          DB changed · <span className="font-medium text-ink">reported</span> = Venus&apos;s own
          end-of-run summary. When they disagree, trust verified.
        </p>
      </div>
    </div>
  );
}
