import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db, gigs, agents, agentQuestions } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import {
  approveGig, dismissGig, markSubmitted, markOutcome, reopenGig,
  setDestinyPaused, answerGigQuestion, declineGigQuestion,
} from "./actions";
import { type Gig, StageBadge, ScoreChip, LaneBadge, ClientSignals, MetaRow, relativeTime, abbreviate } from "./parts";
import { DirectAgent } from "../direct-agent";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Destiny — gigs",
  robots: { index: false, follow: false },
};

const REVIEW_PAGE_SIZE = 10;

/**
 * Mirrors GIG_REVIEW_CAP in mcp-server/tbj-mcp.mjs. Joe reviews ten at a time; past that,
 * record_found_gig refuses and Destiny stops hunting rather than lengthening a queue he hasn't
 * worked. Shown here so a full board reads as "she's standing down", not "she's gone quiet".
 */
const REVIEW_CAP = 10;

const SORTS: { key: string; label: string }[] = [
  { key: "win", label: "Most winnable" },
  { key: "newest", label: "Newest" },
  { key: "fit", label: "Best fit" },
  { key: "uncrowded", label: "Fewest bids" },
  { key: "budget", label: "Biggest budget" },
];

const budgetValue = (g: Gig) => {
  const nums = (g.budget ?? "").replace(/[,k]/gi, (m) => (m.toLowerCase() === "k" ? "000" : "")).match(/\d+/g);
  return nums ? Math.max(...nums.map(Number)) : -1;
};

function sortReview(list: Gig[], sort: string): Gig[] {
  const byWin = (a: Gig, b: Gig) => (b.winScore ?? -1) - (a.winScore ?? -1);
  const arr = [...list];
  if (sort === "fit") arr.sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1));
  else if (sort === "budget") arr.sort((a, b) => budgetValue(b) - budgetValue(a) || byWin(a, b));
  else if (sort === "uncrowded") {
    arr.sort((a, b) => (a.proposalsSoFar ?? 9999) - (b.proposalsSoFar ?? 9999) || byWin(a, b));
  } else if (sort === "newest") {
    arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else arr.sort(byWin); // "win" is the default: it's the number that decides
  return arr;
}

function InFlightCard({ gig, showOutcome }: { gig: Gig; showOutcome?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-background px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink">
            <span className="font-semibold">{gig.title}</span>
            {gig.client && <span className="text-ink-soft"> — {gig.client}</span>}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StageBadge status={gig.status} />
            <LaneBadge gig={gig} />
            <ScoreChip label="win" score={gig.winScore} primary />
            <ScoreChip label="fit" score={gig.fitScore} />
          </div>
          <MetaRow gig={gig} />
          {gig.notes && <p className="mt-1 line-clamp-2 text-[11px] text-ink-soft">{gig.notes}</p>}
          <Link href={`/command/gigs/${gig.id}`} className="mt-1 inline-block text-xs font-semibold text-brand hover:underline">
            See full gig →
          </Link>
          {showOutcome && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-ink-soft">Heard back?</span>
              <form action={markOutcome.bind(null, gig.id, "won")}>
                <button className="rounded-md bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-700 transition-opacity hover:opacity-80">
                  Won it
                </button>
              </form>
              <form action={markOutcome.bind(null, gig.id, "lost")}>
                <button className="rounded-md bg-surface px-2 py-1 text-[11px] font-semibold text-ink-soft transition-colors hover:text-ink">
                  Lost it
                </button>
              </form>
            </div>
          )}
        </div>
        <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-soft">
          {relativeTime(gig.submittedAt ?? gig.proposalDraftedAt ?? gig.approvedAt ?? gig.updatedAt)}
        </span>
      </div>
    </div>
  );
}

function PipelineGroup({ title, gigs: list, showOutcome }: { title: string; gigs: Gig[]; showOutcome?: boolean }) {
  if (list.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">
        {title} ({list.length})
      </h3>
      <div className="mt-2 grid grid-cols-1 items-start gap-2 md:grid-cols-2">
        {list.map((g) => (
          <InFlightCard key={g.id} gig={g} showOutcome={showOutcome} />
        ))}
      </div>
    </div>
  );
}

export default async function GigsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; sort?: string }>;
}) {
  await requireAdmin();
  const { page: pageParam, sort: sortParam } = await searchParams;
  const sort = SORTS.some((s) => s.key === sortParam) ? (sortParam as string) : "win";

  const all = (await db
    .select()
    .from(gigs)
    .where(inArray(gigs.status, ["found", "approved", "drafted", "submitted", "won", "lost", "dismissed"]))
    .orderBy(desc(gigs.createdAt))
    .limit(400)) as Gig[];

  const dest = await db
    .select({ paused: agents.paused })
    .from(agents)
    .where(eq(agents.id, "destiny"))
    .limit(1);
  const registered = dest.length > 0;
  const paused = dest[0]?.paused === true;

  // Scoped to Destiny — Whitney's questions live on her own board, and a question shown on the
  // wrong page is a blocked agent nobody can unblock.
  const openQuestions = await db
    .select({
      id: agentQuestions.id,
      question: agentQuestions.question,
      options: agentQuestions.options,
      createdAt: agentQuestions.createdAt,
      title: gigs.title,
      client: gigs.client,
    })
    .from(agentQuestions)
    .leftJoin(gigs, eq(agentQuestions.gigId, gigs.id))
    .where(and(eq(agentQuestions.status, "open"), eq(agentQuestions.agent, "destiny")))
    .orderBy(desc(agentQuestions.createdAt));

  const review = all.filter((g) => g.status === "found");
  const queued = all.filter((g) => g.status === "approved");
  const stuck = all.filter((g) => g.status === "drafted");
  const sent = all.filter((g) => g.status === "submitted");
  const won = all.filter((g) => g.status === "won");
  const lost = all.filter((g) => g.status === "lost");
  const dismissed = all.filter((g) => g.status === "dismissed");

  const sortedReview = sortReview(review, sort);
  const pageCount = Math.max(1, Math.ceil(sortedReview.length / REVIEW_PAGE_SIZE));
  const page = Math.min(Math.max(1, parseInt(pageParam ?? "1", 10) || 1), pageCount);
  const reviewItems = sortedReview.slice((page - 1) * REVIEW_PAGE_SIZE, page * REVIEW_PAGE_SIZE);
  const boardFull = review.length >= REVIEW_CAP;

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Destiny — gigs 📄</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Destiny hunts the live Upwork feed in a browser and scores each gig for fit + winnability.{" "}
          <span className="font-medium text-ink">You</span> approve the ones worth bidding on; approved
          gigs enter her queue and <span className="font-medium text-ink">she writes the proposal and
          submits it</span>. Open any card&apos;s <span className="font-medium text-ink">full gig</span> for
          the posting, her reasoning, and the proposal she sent.
        </p>

        {/* How she stays on the right side of a permanent ban. This is the thing to read before
            wondering why she's slow — the limits are the product, not a throttle on it. */}
        <details className="mt-4 rounded-xl border border-line bg-background px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer list-none text-sm font-semibold text-ink">
            🔒 Her Upwork session, and the limits that protect it
          </summary>
          <div className="mt-2 space-y-1.5 text-sm text-ink-soft">
            <p>
              Upwork bans accounts <span className="font-medium text-ink">permanently and without appeal</span>{" "}
              for automation, so the safeguards are enforced in her tools — she can&apos;t talk her way past them:
            </p>
            <ul className="ml-4 list-disc space-y-0.5 text-ink">
              <li><span className="font-medium">{REVIEW_CAP} gigs</span> on this board at a time — past that she stops hunting entirely</li>
              <li><span className="font-medium">5 proposals a day</span>, at least <span className="font-medium">45 minutes</span> apart, one per run</li>
              <li><span className="font-medium">≤20 postings</span> opened per run, at reading speed</li>
            </ul>
            <p>
              <span className="font-medium text-ink">She never signs in.</span> She works in a browser profile
              where you are already logged in — no credentials, no 2FA, no device checks. If that session
              expires, her run ends at the login page and nothing happens until you sign in again.
            </p>
            <p>
              Any CAPTCHA, human-check, or Upwork notice about unusual activity{" "}
              <span className="font-medium text-ink">ends her entire run</span> and comes to you as a question.
              She never tries to get past one.
            </p>
          </div>
        </details>

        {/* pause / resume — the emergency brake */}
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
                ? "Destiny will not browse Upwork, bid, or spend a Connect. Approved gigs wait until you resume her."
                : "Destiny works her queue on schedule. Pause her the moment Upwork says anything about her activity."}
            </span>
            <form action={setDestinyPaused.bind(null, !paused)} className="ml-auto">
              <button
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  paused ? "bg-brand text-white hover:opacity-90" : "bg-surface text-ink-soft hover:text-ink"
                }`}
              >
                {paused ? "Resume Destiny" : "Pause Destiny"}
              </button>
            </form>
          </div>
        )}

        {/* counts */}
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full px-3 py-1 font-semibold ${boardFull ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
            {review.length}/{REVIEW_CAP} to review
          </span>
          <span className="rounded-full bg-blue-50 px-3 py-1 font-semibold text-blue-700">{queued.length} queued to bid</span>
          {stuck.length > 0 && (
            <span className="rounded-full bg-orange-50 px-3 py-1 font-semibold text-orange-700">{stuck.length} stuck</span>
          )}
          <span className="rounded-full bg-indigo-50 px-3 py-1 font-semibold text-indigo-700">{sent.length} sent</span>
          <span className="rounded-full bg-green-50 px-3 py-1 font-semibold text-green-700">{won.length} won</span>
        </div>

        <DirectAgent
          agent="destiny"
          label="Destiny"
          placeholder="e.g. Focus on LangGraph / agent-orchestration gigs this week, skip anything under $1k."
        />

        {/* NEEDS YOUR INPUT — she is blocked mid-bid */}
        {openQuestions.length > 0 && (
          <section className="mt-7">
            <h2 className="text-sm font-bold uppercase tracking-wide text-amber-700">
              Needs your input — Destiny asked ({openQuestions.length})
            </h2>
            <div className="mt-3 space-y-3">
              {openQuestions.map((q) => (
                <div key={q.id} className="rounded-2xl border border-amber-300 bg-amber-50/50 p-4">
                  <p className="text-sm font-semibold text-ink">
                    {q.title ? (
                      <>
                        {q.title}
                        {q.client && <span className="font-normal text-ink-soft"> — {q.client}</span>}
                      </>
                    ) : (
                      "General question"
                    )}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink">
                    <span className="font-semibold text-amber-700">Destiny asked:</span> {q.question}
                  </p>
                  <form action={answerGigQuestion.bind(null, q.id)} className="mt-2">
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
                        placeholder="Your answer — she'll read it next run and finish this bid."
                        className="w-full rounded-lg border border-line bg-background px-3 py-2 text-xs text-ink outline-none focus:border-brand"
                      />
                    )}
                    <button className="mt-2 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90">
                      Send answer
                    </button>
                  </form>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-amber-300/60 pt-2.5">
                    <span className="text-[11px] text-ink-soft">
                      Don&apos;t want to answer?{" "}
                      {q.title ? (
                        <>Declining dismisses <span className="font-medium text-ink">{q.title}</span> and she moves on.</>
                      ) : (
                        <>Declining closes the question and she moves on.</>
                      )}
                    </span>
                    <form action={declineGigQuestion.bind(null, q.id)} className="ml-auto">
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

        {/* NEEDS REVIEW — the human gate. Approving here spends real money. */}
        <section className="mt-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
              Needs your review ({review.length}/{REVIEW_CAP})
            </h2>
            {review.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-ink-soft">Sort:</span>
                {SORTS.map((s) => (
                  <Link
                    key={s.key}
                    href={s.key === "win" ? "/command/gigs" : `?sort=${s.key}`}
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

          {boardFull && (
            <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
              <span className="font-semibold">Board is full.</span> Destiny has stopped hunting — she
              won&apos;t open the Upwork feed at all until you clear some of these. That&apos;s deliberate:
              searching a board you haven&apos;t worked burns tokens and puts pointless traffic on your account.
            </p>
          )}

          {review.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-line bg-background p-8 text-center text-sm text-ink-soft">
              Nothing waiting. When Destiny finds a gig worth your Connects, it lands here for approval.
              <br />
              If it stays empty, check her Upwork session is still signed in — she never logs in herself.
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2">
              {reviewItems.map((g) => (
                <div key={g.id} className="rounded-2xl border border-line bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        {g.title}
                        {g.client && <span className="font-normal text-ink-soft"> — {g.client}</span>}
                      </p>
                      <MetaRow gig={g} />
                    </div>
                    <span className="shrink-0 text-[11px] text-ink-soft">{relativeTime(g.createdAt)}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <LaneBadge gig={g} />
                    <ScoreChip label="win" score={g.winScore} primary />
                    <ScoreChip label="fit" score={g.fitScore} />
                  </div>

                  <ClientSignals gig={g} />

                  {g.winReason && (
                    <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
                      <span className="font-medium text-ink">Winnable?</span> {g.winReason}
                    </p>
                  )}
                  {g.description && (
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-soft">{abbreviate(g.description)}</p>
                  )}

                  <div className="mt-3 flex items-center gap-2">
                    <form action={approveGig.bind(null, g.id)}>
                      <button className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90">
                        Approve — she bids
                      </button>
                    </form>
                    <form action={dismissGig.bind(null, g.id)}>
                      <button className="rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:text-ink">
                        Dismiss
                      </button>
                    </form>
                    <Link href={`/command/gigs/${g.id}`} className="ml-auto text-xs font-semibold text-brand hover:underline">
                      See full gig →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}

          {review.length > REVIEW_PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-center gap-3 text-xs">
              {page > 1 ? (
                <a href={`?sort=${sort}&page=${page - 1}`} className="rounded-lg bg-surface px-3 py-1.5 font-semibold text-ink-soft transition-colors hover:text-ink">← Prev</a>
              ) : (
                <span className="rounded-lg px-3 py-1.5 font-semibold text-ink-soft opacity-40">← Prev</span>
              )}
              <span className="text-ink-soft">Page {page} of {pageCount}</span>
              {page < pageCount ? (
                <a href={`?sort=${sort}&page=${page + 1}`} className="rounded-lg bg-surface px-3 py-1.5 font-semibold text-ink-soft transition-colors hover:text-ink">Next →</a>
              ) : (
                <span className="rounded-lg px-3 py-1.5 font-semibold text-ink-soft opacity-40">Next →</span>
              )}
            </div>
          )}
        </section>

        {/* STUCK — she wrote it but couldn't send it. Its own section because it needs YOU. */}
        {stuck.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-bold uppercase tracking-wide text-orange-700">
              Written but not sent — she stopped here ({stuck.length})
            </h2>
            <p className="mt-1 text-xs text-ink-soft">
              Destiny sends her own proposals, so a gig sitting here means something blocked her at the
              submit step — a Connect ceiling, a field she couldn&apos;t answer truthfully, or a wall on
              Upwork. Check for a question above, or send it yourself and mark it.
            </p>
            <div className="mt-3 space-y-3">
              {stuck.map((g) => (
                <div key={g.id} className="rounded-2xl border border-orange-300 bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        {g.title}
                        {g.client && <span className="font-normal text-ink-soft"> — {g.client}</span>}
                      </p>
                      <MetaRow gig={g} />
                    </div>
                    <span className="shrink-0 text-[11px] text-ink-soft">{relativeTime(g.proposalDraftedAt)}</span>
                  </div>
                  {g.proposal && (
                    <pre className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-ink">
                      {g.proposal}
                    </pre>
                  )}
                  {g.notes && (
                    <p className="mt-2 text-[11px] text-ink-soft">
                      <span className="font-medium text-ink">Her note:</span> {g.notes}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <form action={markSubmitted.bind(null, g.id)}>
                      <button className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90">
                        I sent it myself
                      </button>
                    </form>
                    <form action={dismissGig.bind(null, g.id)}>
                      <button className="rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:text-ink">
                        Drop it
                      </button>
                    </form>
                    <Link href={`/command/gigs/${g.id}`} className="ml-auto text-xs font-semibold text-brand hover:underline">
                      See full gig →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* PIPELINE */}
        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">In flight</h2>
          {queued.length + sent.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-line bg-background p-8 text-center text-sm text-ink-soft">
              Nothing in flight. Approve a gig above and she&apos;ll bid on it next run.
            </div>
          ) : (
            <>
              <PipelineGroup title="Queued to bid" gigs={queued} />
              <PipelineGroup title="Proposal sent — waiting on the client" gigs={sent} showOutcome />
            </>
          )}
        </section>

        {/* OUTCOMES — these are what eventually build the Job Success Score */}
        {won.length + lost.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
              Outcomes ({won.length} won · {lost.length} lost)
            </h2>
            <p className="mt-1 text-xs text-ink-soft">
              Your first 2–3 contracts disproportionately set your Job Success Score, so which clients
              you win matters more than how many.
            </p>
            <PipelineGroup title="Won" gigs={won} />
            <PipelineGroup title="Lost" gigs={lost} />
          </section>
        )}

        {/* ARCHIVE */}
        {dismissed.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
              Dismissed ({dismissed.length})
            </h2>
            <div className="mt-3 divide-y divide-line rounded-2xl border border-line bg-background">
              {dismissed.slice(0, 40).map((g) => (
                <div key={g.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Link href={`/command/gigs/${g.id}`} className="min-w-0 flex-1 truncate text-xs text-ink-soft hover:text-brand">
                    {g.title}
                    {g.client ? ` — ${g.client}` : ""}
                  </Link>
                  <ScoreChip label="win" score={g.winScore} />
                  <form action={reopenGig.bind(null, g.id)}>
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
