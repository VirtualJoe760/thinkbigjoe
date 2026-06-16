import type { Metadata } from "next";
import { desc } from "drizzle-orm";

import { db, coworkJobs } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { verticalLabel } from "@/lib/cowork-commands";
import { JobRow } from "./job-row";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Jobs",
  robots: { index: false, follow: false },
};

function describeJob(j: typeof coworkJobs.$inferSelect): string {
  if (j.intent === "find_leads") {
    return `Find ${j.targetCount || "more"} ${verticalLabel(j.vertical)}${j.location ? ` in ${j.location}` : ""}`;
  }
  if (j.intent === "start_prospecting") {
    return `Start prospecting${j.vertical ? ` — ${verticalLabel(j.vertical)}` : ""}`;
  }
  return j.rawCommand;
}

export default async function JobsPage() {
  await requireAdmin();

  const rows = await db
    .select()
    .from(coworkJobs)
    .orderBy(desc(coworkJobs.createdAt))
    .limit(100);

  const queued = rows.filter((r) => r.status === "queued");

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Cowork jobs</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Commands you text the Telegram bot land here as jobs. They run when a
          Cowork session works the queue — web-sourced finds run autonomously,
          LinkedIn-sourced stay supervised.
        </p>

        <div className="mt-4 rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
          Text <a href="https://t.me/thinkbigjoe_alerts_bot" className="font-medium text-brand hover:underline">@thinkbigjoe_alerts_bot</a>:{" "}
          <code className="rounded bg-background px-1.5 py-0.5">find 25 insurance leads in California</code>,{" "}
          <code className="rounded bg-background px-1.5 py-0.5">find more wealth leads</code>,{" "}
          <code className="rounded bg-background px-1.5 py-0.5">start prospecting</code>, or{" "}
          <code className="rounded bg-background px-1.5 py-0.5">status</code>.
        </div>

        {rows.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-line bg-background p-10 text-center text-ink-soft">
            No jobs yet. Text the bot a command and it&apos;ll appear here.
          </div>
        ) : (
          <>
            <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              {queued.length} queued · {rows.length} total
            </p>
            <div className="mt-2 space-y-3">
              {rows.map((j) => (
                <JobRow key={j.id} job={{ ...j, label: describeJob(j) }} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
