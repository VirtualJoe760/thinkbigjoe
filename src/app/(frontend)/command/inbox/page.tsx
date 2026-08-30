import type { Metadata } from "next";
import { desc, eq, inArray, ne } from "drizzle-orm";

import { db, emailOutbox, activityLog } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { DirectAgent } from "../direct-agent";
import { SubNav, VENUS_TABS } from "../sub-nav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Inbox — Edward",
  robots: { index: false, follow: false },
};

const EDWARD_EVENTS = [
  "email_inbox_report",
  "email_draft_created",
  "email_spam_moved",
  "email_send_requested",
  "email_send_approved",
  "email_send_rejected",
  "email_sent",
  "email_send_failed",
];

function relativeTime(iso: string | Date | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso as string).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// Edward files his report as labelled sections (PRESSING / OWED / EMPLOYER / NEW / ...).
// Pull one out so the two that cost real money — who's waiting, and what an employer said —
// get their own panel instead of being buried in the raw report text.
function reportSection(summary: string | null | undefined, label: string): string | null {
  if (!summary) return null;
  const lines = summary.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\s*${label}\\s*:`, "i").test(l));
  if (start === -1) return null;
  const collected = [lines[start].replace(new RegExp(`^\\s*${label}\\s*:`, "i"), "").trim()];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*[A-Z][A-Z /]{2,}\s*:/.test(lines[i])) break; // next section label
    collected.push(lines[i].trim());
  }
  const value = collected.join("\n").trim();
  if (!value || /^(none|n\/a|nothing|no\b)/i.test(value)) return null;
  return value;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-brand-tint text-brand",
  approved: "bg-surface text-ink",
  sent: "bg-surface text-ink-soft",
  rejected: "bg-surface text-ink-soft",
  failed: "bg-surface text-red-600",
};

export default async function InboxPage() {
  await requireAdmin();

  const pending = await db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.status, "pending"))
    .orderBy(desc(emailOutbox.createdAt))
    .limit(50);

  const decided = await db
    .select()
    .from(emailOutbox)
    .where(ne(emailOutbox.status, "pending"))
    .orderBy(desc(emailOutbox.createdAt))
    .limit(25);

  const activity = await db
    .select({
      eventType: activityLog.eventType,
      summary: activityLog.summary,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .where(inArray(activityLog.eventType, EDWARD_EVENTS))
    .orderBy(desc(activityLog.createdAt))
    .limit(40);

  const lastReport = activity.find((a) => a.eventType === "email_inbox_report");
  const owed = reportSection(lastReport?.summary, "OWED");
  const employer = reportSection(lastReport?.summary, "EMPLOYER");
  const pressing = reportSection(lastReport?.summary, "PRESSING");

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <SubNav items={VENUS_TABS} />
        <h1 className="text-2xl font-extrabold tracking-tight">Inbox — Edward 📬</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Edward sweeps joe@thinkbigjoe.com 2×/day (6:45a / 3:45p): triage, spam out, replies
          drafted in Joe&apos;s voice. Sends queue below for{" "}
          <span className="font-semibold text-ink">Venus&apos;s</span> approval — nothing sends
          without it. Venus briefs Joe on Telegram at 12:30 / 18:30.
        </p>

        <DirectAgent
          agent="edward"
          label="Edward"
          placeholder="e.g. Draft a reply to the recruiter from Northgate — interested, ask about remote."
        />

        {/* What's actually owed — the two sections that cost money when missed. */}
        {(pressing || owed || employer) && (
          <div className="mt-8 space-y-3">
            {pressing && (
              <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-red-700">
                  🔴 Pressing
                </h2>
                <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-red-900">{pressing}</p>
              </div>
            )}
            {employer && (
              <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  🎉 Employer replies
                </h2>
                <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-emerald-900">
                  {employer}
                </p>
                <p className="mt-1 text-xs text-emerald-700">
                  Recorded onto the applications board — see /command/applications.
                </p>
              </div>
            )}
            {owed && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  ⏳ Still owed a reply
                </h2>
                <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-amber-900">{owed}</p>
                <p className="mt-1 text-xs text-amber-700">
                  Age-blind: these keep surfacing every sweep until they are answered or filed.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Latest report */}
        <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Latest inbox report
        </h2>
        {lastReport ? (
          <pre className="mt-2 whitespace-pre-wrap rounded-2xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink">
            {lastReport.summary}
            {"\n\n"}— filed {relativeTime(lastReport.createdAt)}
          </pre>
        ) : (
          <p className="mt-2 rounded-2xl border border-line bg-background px-4 py-3 text-sm text-ink-soft">
            No report filed yet — Edward hasn&apos;t run since his last sweep window.
          </p>
        )}

        {/* Pending approvals */}
        <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Awaiting Venus&apos;s approval ({pending.length})
        </h2>
        <div className="mt-2 space-y-3">
          {pending.length === 0 && (
            <p className="rounded-2xl border border-line bg-background px-4 py-3 text-sm text-ink-soft">
              Nothing queued.
            </p>
          )}
          {pending.map((r) => (
            <details
              key={r.id}
              className="rounded-2xl border border-line bg-background p-4 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                <span className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-semibold text-brand">
                  #{r.id}
                </span>
                <span className="font-semibold">{r.subject}</span>
                <span className="text-sm text-ink-soft">→ {r.toAddr}</span>
                <span className="ml-auto text-xs text-ink-soft whitespace-nowrap">
                  {relativeTime(r.createdAt)}
                  {r.sendAt ? ` · wants ${new Date(r.sendAt).toLocaleString()}` : ""}
                </span>
              </summary>
              {r.context && <p className="mt-2 text-xs text-ink-soft">why: {r.context}</p>}
              <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-surface px-4 py-3 text-xs leading-relaxed text-ink">
                {r.body}
              </pre>
            </details>
          ))}
        </div>

        {/* Decided / history */}
        <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Decided &amp; sent
        </h2>
        <div className="mt-2 space-y-2">
          {decided.length === 0 && (
            <p className="rounded-2xl border border-line bg-background px-4 py-3 text-sm text-ink-soft">
              No history yet.
            </p>
          )}
          {decided.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-background px-4 py-2.5 text-sm"
            >
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[r.status] ?? "bg-surface text-ink-soft"}`}
              >
                {r.status}
              </span>
              <span className="font-medium">{r.subject}</span>
              <span className="text-ink-soft">→ {r.toAddr}</span>
              {r.decisionNote && <span className="text-xs text-ink-soft">“{r.decisionNote}”</span>}
              {r.error && <span className="text-xs text-red-600">{r.error}</span>}
              <span className="ml-auto text-xs text-ink-soft whitespace-nowrap">
                {relativeTime(r.sentAt ?? r.decidedAt ?? r.createdAt)}
              </span>
            </div>
          ))}
        </div>

        {/* Activity */}
        <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Edward&apos;s activity
        </h2>
        <div className="mt-2 space-y-1.5">
          {activity.length === 0 && (
            <p className="rounded-2xl border border-line bg-background px-4 py-3 text-sm text-ink-soft">
              Quiet so far.
            </p>
          )}
          {activity.map((a, i) => (
            <div key={i} className="flex items-baseline gap-2 px-1 text-sm">
              <span className="shrink-0 font-mono text-[11px] text-ink-soft">
                {a.eventType.replace(/^email_/, "")}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">{a.summary}</span>
              <span className="shrink-0 text-xs text-ink-soft">{relativeTime(a.createdAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
