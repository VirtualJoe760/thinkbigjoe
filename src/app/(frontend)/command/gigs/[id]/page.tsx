import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db, gigs } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { approveGig, dismissGig, reopenGig, markSubmitted, markOutcome } from "../actions";
import { type Gig, GigDetails, ScoreChip, LaneBadge, MetaRow, StageBadge, relativeTime } from "../parts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Gig — Destiny",
  robots: { index: false, follow: false },
};

export default async function GigDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const gigId = parseInt(id, 10);
  if (!Number.isFinite(gigId)) notFound();

  const rows = (await db.select().from(gigs).where(eq(gigs.id, gigId)).limit(1)) as Gig[];
  const gig = rows[0];
  if (!gig) notFound();

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <Link href="/command/gigs" className="text-xs font-semibold text-brand hover:underline">
          ← Back to Destiny
        </Link>

        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight">{gig.title}</h1>
            {gig.client && <p className="mt-0.5 text-sm text-ink-soft">{gig.client}</p>}
            <MetaRow gig={gig} />
          </div>
          <span className="shrink-0 text-[11px] text-ink-soft">{relativeTime(gig.createdAt)}</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StageBadge status={gig.status} />
          <LaneBadge gig={gig} />
          <ScoreChip label="win" score={gig.winScore} primary />
          <ScoreChip label="fit" score={gig.fitScore} />
        </div>

        {/* Timeline — when a proposal actually went out matters: her pacing rules are
            per-day and 45-minutes-apart, so these stamps are how you audit them. */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-soft">
          {gig.approvedAt && <span>Approved {relativeTime(gig.approvedAt)}</span>}
          {gig.proposalDraftedAt && <span>Written {relativeTime(gig.proposalDraftedAt)}</span>}
          {gig.submittedAt && <span className="font-medium text-ink">Sent {relativeTime(gig.submittedAt)}</span>}
        </div>

        {/* Actions — mirror whatever stage the gig is actually at */}
        <div className="mt-5 flex flex-wrap gap-2">
          {gig.status === "found" && (
            <>
              <form action={approveGig.bind(null, gig.id)}>
                <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90">
                  Approve — she bids on this
                </button>
              </form>
              <form action={dismissGig.bind(null, gig.id)}>
                <button className="rounded-lg bg-surface px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-ink">
                  Dismiss
                </button>
              </form>
            </>
          )}
          {gig.status === "drafted" && (
            <form action={markSubmitted.bind(null, gig.id)}>
              <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90">
                I sent it myself
              </button>
            </form>
          )}
          {gig.status === "submitted" && (
            <>
              <form action={markOutcome.bind(null, gig.id, "won")}>
                <button className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90">
                  Won it
                </button>
              </form>
              <form action={markOutcome.bind(null, gig.id, "lost")}>
                <button className="rounded-lg bg-surface px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-ink">
                  Lost it
                </button>
              </form>
            </>
          )}
          {gig.status === "dismissed" && (
            <form action={reopenGig.bind(null, gig.id)}>
              <button className="rounded-lg bg-surface px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-brand">
                Reopen — back to review
              </button>
            </form>
          )}
          {gig.url && (
            <a
              href={gig.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
            >
              Open on Upwork ↗
            </a>
          )}
        </div>

        {/* Full detail */}
        <div className="mt-6 rounded-2xl border border-line bg-background p-5">
          <GigDetails gig={gig} />
          {!gig.description && !gig.winReason && !gig.proposal && (
            <p className="text-sm text-ink-soft">No extended details captured for this gig yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
