import type { Metadata } from "next";
import { sql } from "drizzle-orm";

import { db, activityLog } from "@/db";
import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Activity",
  robots: { index: false, follow: false },
};

const ICONS: Record<string, string> = {
  scout_complete: "🔍",
  outreach_sent: "📤",
  followup_sent: "💬",
  booking_made: "📅",
  inbox_checked: "📬",
  enrichment_complete: "✨",
};

function relativeTime(iso: string | Date | null) {
  if (!iso) return "";
  const d = new Date(iso as string);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export default async function JobsPage() {
  await requireAdmin();

  const rows = await db
    .select()
    .from(activityLog)
    .orderBy(sql`${activityLog.createdAt} DESC`)
    .limit(100);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Venus activity</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Everything Venus has scouted, sent, followed up on, and booked — most recent first.
        </p>

        {rows.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-line bg-background p-10 text-center text-ink-soft">
            No activity logged yet.
          </div>
        ) : (
          <div className="mt-6 divide-y divide-line rounded-2xl border border-line bg-background">
            {rows.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 px-5 py-4">
                <span className="mt-0.5 shrink-0 text-lg leading-none">
                  {ICONS[entry.eventType] ?? "✦"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{entry.summary}</p>
                  <p className="mt-0.5 text-xs text-ink-soft capitalize">
                    {entry.eventType.replace(/_/g, " ")}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-ink-soft whitespace-nowrap">
                  {relativeTime(entry.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
