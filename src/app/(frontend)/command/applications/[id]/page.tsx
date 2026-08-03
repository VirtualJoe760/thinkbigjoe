import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db, jobApplications } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { approveJob, dismissJob, reopenJob } from "../actions";
import { type Job, JobDetails, ScoreChip, MetaRow, StageBadge, relativeTime } from "../parts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Job — Whitney",
  robots: { index: false, follow: false },
};

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const jobId = parseInt(id, 10);
  if (!Number.isFinite(jobId)) notFound();

  const rows = (await db.select().from(jobApplications).where(eq(jobApplications.id, jobId)).limit(1)) as Job[];
  const job = rows[0];
  if (!job) notFound();

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <Link href="/command/applications" className="text-xs font-semibold text-brand hover:underline">
          ← Back to Whitney
        </Link>

        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight">{job.role}</h1>
            <p className="mt-0.5 text-sm text-ink-soft">{job.company}</p>
            <MetaRow job={job} />
          </div>
          <span className="shrink-0 text-[11px] text-ink-soft">{relativeTime(job.createdAt)}</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StageBadge status={job.status} />
          <ScoreChip label="Fit" score={job.fitScore} />
          <ScoreChip label="Interest" score={job.interestScore} />
        </div>

        {/* Whitney's reasoning (moved off the card to keep it uncluttered) */}
        {(job.fitReason || job.interestMatch) && (
          <div className="mt-4 space-y-2">
            {job.fitReason && (
              <p className="rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed text-ink-soft">
                <span className="font-semibold text-ink">Why it fits:</span> {job.fitReason}
              </p>
            )}
            {job.interestMatch && (
              <p className="rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed text-ink-soft">
                <span className="font-semibold text-ink">Matches your interests:</span> {job.interestMatch}
              </p>
            )}
          </div>
        )}

        {job.notes && (
          <p className="mt-3 text-xs text-ink-soft">
            <span className="font-semibold text-ink">Notes:</span> {job.notes}
          </p>
        )}

        {/* Actions */}
        <div className="mt-5 flex flex-wrap gap-2">
          {job.status === "found" && (
            <>
              <form action={approveJob.bind(null, job.id)}>
                <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90">
                  Approve — apply to this
                </button>
              </form>
              <form action={dismissJob.bind(null, job.id)}>
                <button className="rounded-lg bg-surface px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-ink">
                  Dismiss
                </button>
              </form>
            </>
          )}
          {["dismissed", "rejected", "closed"].includes(job.status) && (
            <form action={reopenJob.bind(null, job.id)}>
              <button className="rounded-lg bg-surface px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-brand">
                Reopen — back to review
              </button>
            </form>
          )}
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
            >
              Open posting ↗
            </a>
          )}
        </div>

        {/* Full detail */}
        <div className="mt-6 rounded-2xl border border-line bg-background p-5">
          <JobDetails job={job} />
          {!job.jobDescription && !job.companyAbout && (
            <p className="text-sm text-ink-soft">No extended details captured for this role yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
