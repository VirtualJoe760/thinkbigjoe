import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";

import { db, jobApplications, agents, agentQuestions } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { approveJob, dismissJob, reopenJob, bumpPriority, setWhitneyPaused, answerQuestion, declineQuestion } from "./actions";
import { type Job, StageBadge, ScoreChip, TargetBadge, MetaRow, relativeTime, abbreviate } from "./parts";
import { DirectAgent } from "../direct-agent";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Whitney — applications",
  robots: { index: false, follow: false },
};

const REVIEW_PAGE_SIZE = 12;

const SORTS: { key: string; label: string }[] = [
  { key: "newest", label: "Newest" },
  { key: "interest", label: "Most interesting" },
  { key: "fit", label: "Best fit" },
  { key: "remote", label: "Remote first" },
  { key: "pay", label: "Highest pay" },
];

const isRemote = (j: Job) => /remote|anywhere/i.test(j.location ?? "");
const payValue = (j: Job) => {
  const nums = (j.pay ?? "").replace(/[,k]/gi, (m) => (m.toLowerCase() === "k" ? "000" : "")).match(/\d+/g);
  return nums ? Math.max(...nums.map(Number)) : -1;
};

function sortReview(list: Job[], sort: string): Job[] {
  const byInterest = (a: Job, b: Job) => (b.interestScore ?? -1) - (a.interestScore ?? -1);
  const byFit = (a: Job, b: Job) => (b.fitScore ?? -1) - (a.fitScore ?? -1);
  const arr = [...list];
  if (sort === "interest") arr.sort(byInterest);
  else if (sort === "fit") arr.sort(byFit);
  else if (sort === "pay") arr.sort((a, b) => payValue(b) - payValue(a) || byInterest(a, b));
  else if (sort === "remote") arr.sort((a, b) => Number(isRemote(b)) - Number(isRemote(a)) || byInterest(a, b));
  // "newest" keeps the query order (priority desc, createdAt desc)
  return arr;
}

function InFlightCard({ job }: { job: Job }) {
  return (
    <div className="rounded-2xl border border-line bg-background px-4 py-3">
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
            <TargetBadge job={job} />
            <ScoreChip label="Fit" score={job.fitScore} />
            <ScoreChip label="Interest" score={job.interestScore} />
            <MetaRow job={job} />
          </div>
          {job.notes && <p className="mt-1 text-[11px] text-ink-soft">{job.notes}</p>}
          <Link
            href={`/command/applications/${job.id}`}
            className="mt-1 inline-block text-xs font-semibold text-brand hover:underline"
          >
            See full job →
          </Link>
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
  );
}

function PipelineGroup({ title, jobs }: { title: string; jobs: Job[] }) {
  if (jobs.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">
        {title} ({jobs.length})
      </h3>
      <div className="mt-2 grid grid-cols-1 items-start gap-2 md:grid-cols-2">
        {jobs.map((job) => (
          <InFlightCard key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; sort?: string }>;
}) {
  await requireAdmin();
  const { page: pageParam, sort: sortParam } = await searchParams;
  const sort = SORTS.some((s) => s.key === sortParam) ? (sortParam as string) : "newest";

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

  const openQuestions = await db
    .select({
      id: agentQuestions.id,
      question: agentQuestions.question,
      options: agentQuestions.options,
      createdAt: agentQuestions.createdAt,
      resumeUrl: agentQuestions.resumeUrl,
      resumeState: agentQuestions.resumeState,
      company: jobApplications.company,
      role: jobApplications.role,
    })
    .from(agentQuestions)
    .leftJoin(jobApplications, eq(agentQuestions.applicationId, jobApplications.id))
    // Scoped to Whitney — Destiny asks questions too, and hers belong on /command/gigs where
    // the gig they block actually lives. Unscoped, hers rendered here as "General question".
    .where(and(eq(agentQuestions.status, "open"), eq(agentQuestions.agent, "whitney")))
    .orderBy(desc(agentQuestions.createdAt));

  const review = jobs.filter((j) => j.status === "found");
  const queued = jobs.filter((j) => j.status === "approved");
  const working = jobs.filter((j) => j.status === "account_created" || j.status === "verified");
  const done = jobs.filter((j) => j.status === "applied" || j.status === "interview");
  const archived = jobs.filter((j) => ["dismissed", "rejected", "closed"].includes(j.status));

  const sortedReview = sortReview(review, sort);
  const reviewPageCount = Math.max(1, Math.ceil(sortedReview.length / REVIEW_PAGE_SIZE));
  const reviewPage = Math.min(Math.max(1, parseInt(pageParam ?? "1", 10) || 1), reviewPageCount);
  const reviewItems = sortedReview.slice((reviewPage - 1) * REVIEW_PAGE_SIZE, reviewPage * REVIEW_PAGE_SIZE);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Whitney — applications 📮</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Whitney finds roles and scores them for fit + interest. <span className="font-medium text-ink">You</span>{" "}
          approve the ones worth applying to; approved jobs enter her queue and she applies. Open any
          card&apos;s <span className="font-medium text-ink">full job</span> for the description, company, reviews, and contact.
        </p>

        {/* Account credentials — Joe was locked out of a Zillow account on 2026-08-30 simply
            because nobody had written down that every job account shares one login. Naming the
            env var (never the value) is enough to make that impossible again. */}
        <details className="mt-4 rounded-xl border border-line bg-background px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer list-none text-sm font-semibold text-ink">
            🔑 Sign-in for any account Whitney created
          </summary>
          <div className="mt-2 space-y-1.5 text-sm text-ink-soft">
            <p>
              Every job-site account she creates uses the <span className="font-medium text-ink">same</span> pair —
              there is no per-site password to lose:
            </p>
            <p className="text-ink">
              Email <code className="rounded bg-surface px-1">joe@thinkbigjoe.com</code> · Password ={" "}
              <code className="rounded bg-surface px-1">JOB_SIGNUP_PASSWORD</code> in{" "}
              <code className="rounded bg-surface px-1">.env.local</code>
            </p>
            <p>
              To have it autofill everywhere, add that one password to your own password manager once,
              under any job site. Whitney&apos;s browser is a separate, deliberately isolated Chrome
              profile (<code className="rounded bg-surface px-1">--disable-sync</code>, no Google account),
              so nothing she saves can ever sync to yours — and signing her profile into your Google
              account would hand an autonomous agent your whole Google identity.
            </p>
            <p>
              Cards below at <span className="font-medium text-ink">Account created</span> or{" "}
              <span className="font-medium text-ink">Verified</span> are the sites that have one.
            </p>
          </div>
        </details>

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

        <DirectAgent
          agent="whitney"
          label="Whitney"
          placeholder="e.g. Go after Compass — find their engineering roles and post the ones I'd fit."
        />

        {/* NEEDS YOUR INPUT — Whitney is blocked and asked a question */}
        {openQuestions.length > 0 && (
          <section className="mt-7">
            <h2 className="text-sm font-bold uppercase tracking-wide text-amber-700">
              Needs your input — Whitney asked ({openQuestions.length})
            </h2>
            <div className="mt-3 space-y-3">
              {openQuestions.map((q) => (
                <div key={q.id} className="rounded-2xl border border-amber-300 bg-amber-50/50 p-4">
                  <p className="text-sm font-semibold text-ink">
                    {q.role ? (
                      <>{q.role} <span className="font-normal text-ink-soft">@ {q.company}</span></>
                    ) : (
                      "General question"
                    )}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink">
                    <span className="font-semibold text-amber-700">Whitney asked:</span> {q.question}
                  </p>
                  {/* Where she was when she stopped. Her browser tab is a courtesy that dies on any
                      restart; this link is the durable way back into a half-filled application. */}
                  {q.resumeUrl && (
                    <div className="mt-2 rounded-xl border border-amber-300 bg-white/70 px-3 py-2">
                      <a
                        href={q.resumeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-brand underline break-all"
                      >
                        📍 Pick up where she stopped ↗
                      </a>
                      {q.resumeState && (
                        <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">{q.resumeState}</p>
                      )}
                    </div>
                  )}
                  <form action={answerQuestion.bind(null, q.id)} className="mt-2">
                    {Array.isArray(q.options) && (q.options as string[]).length > 0 ? (
                      <div className="space-y-1.5">
                        {(q.options as string[]).map((opt) => (
                          <label key={opt} className="flex items-center gap-2 text-xs text-ink">
                            <input type="radio" name="answer" value={opt} required className="accent-brand" />
                            {opt}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        name="answer"
                        rows={2}
                        required
                        placeholder="Your answer — she'll read it next run and resume this application."
                        className="w-full rounded-lg border border-line bg-background px-3 py-2 text-xs text-ink outline-none focus:border-brand"
                      />
                    )}
                    <button className="mt-2 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90">
                      Send answer
                    </button>
                  </form>
                  {/* The other valid outcome: refuse the question. Whitney can't finish an
                      application she can't answer for, so declining cancels it outright and
                      frees her next run — better than leaving her blocked indefinitely. */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-amber-300/60 pt-2.5">
                    <span className="text-[11px] text-ink-soft">
                      Don&apos;t want to answer?{" "}
                      {q.role ? (
                        <>Declining cancels the <span className="font-medium text-ink">{q.role} @ {q.company}</span> application and she moves on.</>
                      ) : (
                        <>Declining closes the question and she moves on.</>
                      )}
                    </span>
                    <form action={declineQuestion.bind(null, q.id)} className="ml-auto">
                      <button className="rounded-lg border border-line bg-background px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-red-300 hover:text-red-600">
                        Decline to answer
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* NEEDS REVIEW — the human gate */}
        <section className="mt-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Needs your review</h2>
            {review.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-ink-soft">Sort:</span>
                {SORTS.map((s) => (
                  <Link
                    key={s.key}
                    href={s.key === "newest" ? "/command/applications" : `?sort=${s.key}`}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      sort === s.key ? "bg-brand text-white" : "bg-surface text-ink-soft hover:text-ink"
                    }`}
                  >
                    {s.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
          {review.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-line bg-background p-8 text-center text-sm text-ink-soft">
              Nothing waiting. When Whitney finds a fitting role, it lands here for your approval.
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2">
              {reviewItems.map((job) => (
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
                    <TargetBadge job={job} />
            <ScoreChip label="Fit" score={job.fitScore} />
                    <ScoreChip label="Interest" score={job.interestScore} />
                  </div>

                  {job.jobDescription && (
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-soft">
                      {abbreviate(job.jobDescription)}
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-2">
                    <form action={approveJob.bind(null, job.id)}>
                      <button className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90">
                        Approve
                      </button>
                    </form>
                    <form action={dismissJob.bind(null, job.id)}>
                      <button className="rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:text-ink">
                        Decline
                      </button>
                    </form>
                    <Link
                      href={`/command/applications/${job.id}`}
                      className="ml-auto text-xs font-semibold text-brand hover:underline"
                    >
                      See full job →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
          {review.length > REVIEW_PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-center gap-3 text-xs">
              {reviewPage > 1 ? (
                <a href={`?sort=${sort}&page=${reviewPage - 1}`} className="rounded-lg bg-surface px-3 py-1.5 font-semibold text-ink-soft transition-colors hover:text-ink">← Prev</a>
              ) : (
                <span className="rounded-lg px-3 py-1.5 font-semibold text-ink-soft opacity-40">← Prev</span>
              )}
              <span className="text-ink-soft">Page {reviewPage} of {reviewPageCount}</span>
              {reviewPage < reviewPageCount ? (
                <a href={`?sort=${sort}&page=${reviewPage + 1}`} className="rounded-lg bg-surface px-3 py-1.5 font-semibold text-ink-soft transition-colors hover:text-ink">Next →</a>
              ) : (
                <span className="rounded-lg px-3 py-1.5 font-semibold text-ink-soft opacity-40">Next →</span>
              )}
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
            <>
              <PipelineGroup title="Queued to apply" jobs={queued} />
              <PipelineGroup title="In progress" jobs={working} />
              <PipelineGroup title="Applied" jobs={done} />
            </>
          )}
        </section>

        {/* ARCHIVE */}
        {archived.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
              Declined &amp; closed ({archived.length})
            </h2>
            <div className="mt-3 divide-y divide-line rounded-2xl border border-line bg-background">
              {archived.slice(0, 40).map((job) => (
                <div key={job.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Link href={`/command/applications/${job.id}`} className="min-w-0 flex-1 truncate text-xs text-ink-soft hover:text-brand">
                    {job.role} @ {job.company}
                  </Link>
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
