import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";

import { db, jobApplications, agents } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { approveJob, dismissJob, reopenJob, bumpPriority, setWhitneyPaused } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Whitney — applications",
  robots: { index: false, follow: false },
};

type Job = typeof jobApplications.$inferSelect;
type Review = { source?: string; rating?: number; count?: number; url?: string; summary?: string };
type Contact = { recruiter_name?: string; email?: string; phone?: string; careers_url?: string; linkedin?: string };

const STAGE: Record<string, { label: string; cls: string }> = {
  found: { label: "Needs review", cls: "bg-amber-50 text-amber-700" },
  approved: { label: "Approved · queued", cls: "bg-blue-50 text-blue-700" },
  account_created: { label: "Account created", cls: "bg-indigo-50 text-indigo-700" },
  verified: { label: "Verified", cls: "bg-indigo-50 text-indigo-700" },
  applied: { label: "Applied", cls: "bg-green-50 text-green-700" },
  interview: { label: "Interview", cls: "bg-green-100 text-green-800" },
  dismissed: { label: "Dismissed", cls: "bg-surface text-ink-soft" },
  rejected: { label: "Rejected", cls: "bg-surface text-ink-soft" },
  closed: { label: "Closed", cls: "bg-surface text-ink-soft" },
};

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function asJson<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return null; }
  }
  return v as T;
}

function StageBadge({ status }: { status: string }) {
  const s = STAGE[status] ?? { label: status, cls: "bg-surface text-ink-soft" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.cls}`}>
      {s.label}
    </span>
  );
}

function ScoreChip({ label, score }: { label: string; score: number | null }) {
  if (score == null) return null;
  const cls = score >= 75 ? "bg-green-50 text-green-700" : score >= 50 ? "bg-amber-50 text-amber-700" : "bg-surface text-ink-soft";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label} {score}%
    </span>
  );
}

function MetaRow({ job }: { job: Job }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-soft">
      {job.location && <span>{job.location}</span>}
      {job.pay && <span>· {job.pay}</span>}
      {job.platform && <span>· {job.platform}</span>}
      {job.url && (
        <a href={job.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">· posting ↗</a>
      )}
      {job.companyWebsite && (
        <a href={job.companyWebsite} target="_blank" rel="noreferrer" className="text-brand hover:underline">· company site ↗</a>
      )}
    </div>
  );
}

function Stars({ rating }: { rating?: number }) {
  if (rating == null) return null;
  return <span className="font-semibold text-ink">★ {rating.toFixed(1)}</span>;
}

/** Expandable detail: full JD, company profile, sourced reviews, contact. */
function JobDetails({ job }: { job: Job }) {
  const reviews = asJson<Review[]>(job.companyReviews) ?? [];
  const contact = asJson<Contact>(job.contactInfo);
  const hasCompany = job.companyAbout || job.companyAddress || job.companyWebsite;
  const hasContact = contact && Object.values(contact).some(Boolean);
  const hasAny = job.jobDescription || hasCompany || reviews.length > 0 || hasContact;
  if (!hasAny) return null;

  return (
    <details className="group mt-3 [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer select-none text-xs font-semibold text-brand hover:underline">
        Details — job description, company, reviews, contact ▾
      </summary>
      <div className="mt-3 space-y-4 border-t border-line pt-3">
        {job.jobDescription && (
          <section>
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Job description</p>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink">{job.jobDescription}</p>
          </section>
        )}

        {hasCompany && (
          <section>
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Company</p>
            {job.companyAbout && <p className="mt-1 text-xs leading-relaxed text-ink">{job.companyAbout}</p>}
            <div className="mt-1 space-y-0.5 text-[11px] text-ink-soft">
              {job.companyAddress && <p>📍 {job.companyAddress}</p>}
              {job.companyWebsite && (
                <p>🔗 <a href={job.companyWebsite} target="_blank" rel="noreferrer" className="text-brand hover:underline">{job.companyWebsite}</a></p>
              )}
            </div>
          </section>
        )}

        {reviews.length > 0 && (
          <section>
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Reviews</p>
            <div className="mt-1 space-y-1.5">
              {reviews.map((rv, i) => (
                <div key={i} className="rounded-lg bg-surface px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{rv.source ?? "Review"}</span>
                    <Stars rating={rv.rating} />
                    {rv.count != null && <span className="text-[11px] text-ink-soft">({rv.count} reviews)</span>}
                    {rv.url && (
                      <a href={rv.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">source ↗</a>
                    )}
                  </div>
                  {rv.summary && <p className="mt-1 leading-relaxed text-ink-soft">{rv.summary}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {hasContact && contact && (
          <section>
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Contact</p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-soft">
              {contact.recruiter_name && <span>{contact.recruiter_name}</span>}
              {contact.email && <a href={`mailto:${contact.email}`} className="text-brand hover:underline">{contact.email}</a>}
              {contact.phone && <span>{contact.phone}</span>}
              {contact.careers_url && <a href={contact.careers_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">careers ↗</a>}
              {contact.linkedin && <a href={contact.linkedin} target="_blank" rel="noreferrer" className="text-brand hover:underline">LinkedIn ↗</a>}
            </div>
          </section>
        )}
      </div>
    </details>
  );
}

export default async function ApplicationsPage() {
  await requireAdmin();

  const jobs = (await db
    .select()
    .from(jobApplications)
    .orderBy(desc(jobApplications.priority), desc(jobApplications.createdAt))
    .limit(400)) as Job[];

  const whit = await db
    .select({ paused: agents.paused, status: agents.status })
    .from(agents)
    .where(eq(agents.id, "whitney"))
    .limit(1);
  const registered = whit.length > 0;
  const paused = whit[0]?.paused === true;

  const review = jobs.filter((j) => j.status === "found");
  const queued = jobs.filter((j) => j.status === "approved");
  const working = jobs.filter((j) => j.status === "account_created" || j.status === "verified");
  const done = jobs.filter((j) => j.status === "applied" || j.status === "interview");
  const archived = jobs.filter((j) => ["dismissed", "rejected", "closed"].includes(j.status));

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Whitney — applications 📮</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Whitney finds roles and posts them here with the full picture — job description, company,
          sourced reviews, contact, and how well it matches your skills <em>and</em> your interests.{" "}
          <span className="font-medium text-ink">You</span> approve the ones worth applying to; approved
          jobs enter her priority queue and she applies (account → email-verify → tailor → submit).
        </p>

        {/* pause / resume control */}
        {registered && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-background px-4 py-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                paused ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${paused ? "bg-amber-500" : "bg-green-500"}`} />
              {paused ? "Paused" : "Active"}
            </span>
            <span className="text-xs text-ink-soft">
              {paused
                ? "Whitney will not apply or find jobs. Approved jobs wait until you resume her."
                : "Whitney works her queue on schedule. Pause to make her stand down without losing the queue."}
            </span>
            <form action={setWhitneyPaused.bind(null, !paused)} className="ml-auto">
              <button
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  paused ? "bg-brand text-white hover:opacity-90" : "bg-surface text-ink-soft hover:text-ink"
                }`}
              >
                {paused ? "Resume Whitney" : "Pause Whitney"}
              </button>
            </form>
          </div>
        )}

        {/* counts */}
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-700">{review.length} to review</span>
          <span className="rounded-full bg-blue-50 px-3 py-1 font-semibold text-blue-700">{queued.length} queued</span>
          <span className="rounded-full bg-indigo-50 px-3 py-1 font-semibold text-indigo-700">{working.length} in progress</span>
          <span className="rounded-full bg-green-50 px-3 py-1 font-semibold text-green-700">{done.length} applied</span>
        </div>

        {/* NEEDS REVIEW — the human gate */}
        <section className="mt-7">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Needs your review</h2>
          {review.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-line bg-background p-8 text-center text-sm text-ink-soft">
              Nothing waiting. When Whitney finds a fitting role, it lands here for your approval.
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2">
              {review.map((job) => (
                <div key={job.id} className="rounded-2xl border border-line bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        {job.role} <span className="font-normal text-ink-soft">@ {job.company}</span>
                      </p>
                      <MetaRow job={job} />
                    </div>
                    <span className="shrink-0 text-[11px] text-ink-soft">{relativeTime(job.createdAt)}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <ScoreChip label="Fit" score={job.fitScore} />
                    <ScoreChip label="Interest" score={job.interestScore} />
                  </div>

                  {job.fitReason && (
                    <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed text-ink-soft">
                      <span className="font-semibold text-ink">Why it fits:</span> {job.fitReason}
                    </p>
                  )}
                  {job.interestMatch && (
                    <p className="mt-1.5 rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed text-ink-soft">
                      <span className="font-semibold text-ink">Matches your interests:</span> {job.interestMatch}
                    </p>
                  )}

                  <JobDetails job={job} />

                  <div className="mt-3 flex gap-2">
                    <form action={approveJob.bind(null, job.id)}>
                      <button className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90">
                        Approve — apply to this
                      </button>
                    </form>
                    <form action={dismissJob.bind(null, job.id)}>
                      <button className="rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:text-ink">
                        Dismiss
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* PIPELINE — Whitney's work in flight */}
        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">In flight</h2>
          {queued.length + working.length + done.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-line bg-background p-8 text-center text-sm text-ink-soft">
              No applications in progress yet.
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 items-start gap-2 md:grid-cols-2">
              {[...queued, ...working, ...done].map((job) => (
                <div key={job.id} className="rounded-2xl border border-line bg-background px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">
                        <span className="font-semibold">{job.role}</span>{" "}
                        <span className="text-ink-soft">@ {job.company}</span>
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <StageBadge status={job.status} />
                        {job.status === "approved" && job.priority > 0 && (
                          <span className="text-[11px] font-semibold text-blue-700">priority {job.priority}</span>
                        )}
                        <ScoreChip label="Fit" score={job.fitScore} />
                        <ScoreChip label="Interest" score={job.interestScore} />
                        <MetaRow job={job} />
                      </div>
                      {job.notes && <p className="mt-1 text-[11px] text-ink-soft">{job.notes}</p>}
                      <JobDetails job={job} />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="whitespace-nowrap text-[11px] text-ink-soft">
                        {relativeTime(job.appliedAt ?? job.approvedAt ?? job.updatedAt)}
                      </span>
                      {job.status === "approved" && (
                        <form action={bumpPriority.bind(null, job.id)}>
                          <button
                            title="Bump to front of Whitney's queue"
                            className="rounded-md bg-surface px-2 py-1 text-[11px] font-semibold text-ink-soft transition-colors hover:text-ink"
                          >
                            ↑ bump
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ARCHIVE */}
        {archived.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
              Dismissed &amp; closed ({archived.length})
            </h2>
            <div className="mt-3 divide-y divide-line rounded-2xl border border-line bg-background">
              {archived.slice(0, 40).map((job) => (
                <div key={job.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-ink-soft">{job.role} @ {job.company}</p>
                  </div>
                  <StageBadge status={job.status} />
                  <form action={reopenJob.bind(null, job.id)}>
                    <button className="rounded-md px-2 py-1 text-[11px] font-semibold text-ink-soft transition-colors hover:text-brand">
                      reopen
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
