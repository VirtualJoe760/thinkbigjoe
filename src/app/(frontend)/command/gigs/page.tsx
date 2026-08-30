import type { Metadata } from "next";
import { desc, inArray } from "drizzle-orm";

import { db, gigs } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { approveGig, dismissGig, markSubmitted, markOutcome, reopenGig } from "./actions";
import { DirectAgent } from "../direct-agent";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Destiny — gigs",
  robots: { index: false, follow: false },
};

type Gig = typeof gigs.$inferSelect;

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** win_score is the headline number: can an empty profile actually win this? */
function ScoreChip({ label, value, primary }: { label: string; value: number | null; primary?: boolean }) {
  if (value == null) return null;
  const tone =
    value >= 70 ? "bg-green-50 text-green-700" : value >= 45 ? "bg-amber-50 text-amber-700" : "bg-surface text-ink-soft";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone} ${primary ? "ring-1 ring-inset ring-current/20" : ""}`}>
      {label} {value}
    </span>
  );
}

function ClientSignals({ g }: { g: Gig }) {
  const bits: string[] = [];
  if (g.proposalsSoFar != null) bits.push(`${g.proposalsSoFar} proposals`);
  if (g.clientHires != null) bits.push(`${g.clientHires} prior hires`);
  if (g.clientVerified != null) bits.push(g.clientVerified ? "payment verified" : "⚠️ payment UNverified");
  if (!bits.length) return null;
  return <p className="mt-1 text-[11px] text-ink-soft">{bits.join(" · ")}</p>;
}

function GigHead({ g }: { g: Gig }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{g.title}</span>
        {g.client && <span className="text-sm text-ink-soft">— {g.client}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <ScoreChip label="win" value={g.winScore} primary />
          <ScoreChip label="fit" value={g.fitScore} />
        </span>
      </div>
      <p className="mt-1 text-[11px] text-ink-soft">
        {g.budget && <span className="font-medium text-ink">{g.budget}</span>}
        {g.budget && g.scope ? " · " : ""}
        {g.scope}
        {g.lane ? ` · ${g.lane}` : ""}
      </p>
      {g.winReason && <p className="mt-1 text-[11px] text-ink-soft"><span className="font-medium text-ink">Winnable?</span> {g.winReason}</p>}
      <ClientSignals g={g} />
      {g.url && (
        <a href={g.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[11px] text-brand underline">
          Open on Upwork ↗
        </a>
      )}
    </>
  );
}

export default async function GigsPage() {
  await requireAdmin();

  const all = await db
    .select()
    .from(gigs)
    .where(inArray(gigs.status, ["found", "approved", "drafted", "submitted", "won", "lost", "dismissed"]))
    .orderBy(desc(gigs.createdAt))
    .limit(200);

  const review = all
    .filter((g) => g.status === "found")
    .sort((a, b) => (b.winScore ?? -1) - (a.winScore ?? -1));
  const queued = all.filter((g) => g.status === "approved");
  const drafted = all.filter((g) => g.status === "drafted");
  const inFlight = all.filter((g) => g.status === "submitted");
  const closed = all.filter((g) => g.status === "won" || g.status === "lost");
  const dismissed = all.filter((g) => g.status === "dismissed");

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Destiny — gigs 📄</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Destiny reads Upwork&apos;s own alert emails, scores each gig, and drafts the proposal.{" "}
          <span className="font-medium text-ink">You send it.</span> She never logs into Upwork,
          never submits, and never spends a Connect — that human step is what keeps the account
          compliant.
        </p>

        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">Why &ldquo;win&rdquo; outranks &ldquo;fit&rdquo;:</span> your
          profile has no reviews and no Job Success Score yet, and alerts arrive 15–60 min behind the
          live feed — so you lose any gig decided by speed or price. A proposal costs roughly
          $2–4 in Connects, so bidding on work you can&apos;t win is a real, recurring cost. Your
          first 2–3 contracts also set your initial JSS, which is why small and well-scoped beats big.
        </div>

        <DirectAgent
          agent="destiny"
          label="Destiny"
          placeholder="e.g. Focus on LangGraph / agent-orchestration gigs this week, skip anything under $1k."
        />

        {/* ---- Ready to send ---- */}
        <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Ready for you to send ({drafted.length})
        </h2>
        <div className="mt-2 space-y-3">
          {drafted.length === 0 && (
            <p className="rounded-2xl border border-line bg-background px-4 py-3 text-sm text-ink-soft">
              No proposals drafted yet.
            </p>
          )}
          {drafted.map((g) => (
            <div key={g.id} className="rounded-2xl border border-brand/40 bg-background p-4">
              <GigHead g={g} />
              <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-ink">
                {g.proposal}
              </pre>
              {g.notes && <p className="mt-2 text-[11px] text-ink-soft"><span className="font-medium text-ink">Destiny&apos;s note:</span> {g.notes}</p>}
              <p className="mt-2 text-[11px] text-ink-soft">
                Copy this into Upwork and submit it yourself, then mark it below. Drafted {relativeTime(g.proposalDraftedAt)}.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={markSubmitted.bind(null, g.id)}>
                  <button className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white">
                    I submitted this
                  </button>
                </form>
                <form action={dismissGig.bind(null, g.id)}>
                  <button className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft">
                    Drop it
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>

        {/* ---- Review board ---- */}
        <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Review — approve to get a proposal ({review.length})
        </h2>
        <div className="mt-2 space-y-3">
          {review.length === 0 && (
            <p className="rounded-2xl border border-line bg-background px-4 py-3 text-sm text-ink-soft">
              Nothing waiting. If this stays empty, check that your Upwork saved-search alerts are on
              and landing in the <code className="rounded bg-surface px-1">Upwork</code> mail folder —
              an empty board is usually a setup gap, not a quiet market.
            </p>
          )}
          {review.map((g) => (
            <div key={g.id} className="rounded-2xl border border-line bg-background p-4">
              <GigHead g={g} />
              {g.description && (
                <details className="mt-2 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="cursor-pointer list-none text-[11px] font-semibold text-brand">
                    Full posting
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-ink-soft">{g.description}</p>
                </details>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={approveGig.bind(null, g.id)}>
                  <button className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white">
                    Approve → draft a proposal
                  </button>
                </form>
                <form action={dismissGig.bind(null, g.id)}>
                  <button className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft">
                    Dismiss
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>

        {/* ---- Pipeline ---- */}
        {(queued.length > 0 || inFlight.length > 0) && (
          <>
            <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-soft">Pipeline</h2>
            <div className="mt-2 space-y-2">
              {queued.map((g) => (
                <div key={g.id} className="rounded-xl border border-line bg-background px-4 py-2 text-sm">
                  <span className="font-medium text-ink">{g.title}</span>
                  <span className="ml-2 text-xs text-ink-soft">approved — Destiny writes the proposal on her next run</span>
                </div>
              ))}
              {inFlight.map((g) => (
                <div key={g.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-background px-4 py-2 text-sm">
                  <span className="font-medium text-ink">{g.title}</span>
                  <span className="text-xs text-ink-soft">submitted {relativeTime(g.submittedAt)}</span>
                  <span className="ml-auto flex gap-2">
                    <form action={markOutcome.bind(null, g.id, "won")}>
                      <button className="rounded-lg border border-green-300 px-2 py-1 text-[11px] font-semibold text-green-700">Won</button>
                    </form>
                    <form action={markOutcome.bind(null, g.id, "lost")}>
                      <button className="rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-ink-soft">Lost</button>
                    </form>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ---- Closed + dismissed ---- */}
        {(closed.length > 0 || dismissed.length > 0) && (
          <details className="mt-8 [&_summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer list-none text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Closed ({closed.length}) · dismissed ({dismissed.length})
            </summary>
            <div className="mt-2 space-y-1.5">
              {closed.map((g) => (
                <div key={g.id} className="rounded-xl border border-line bg-background px-4 py-2 text-sm">
                  <span className={g.status === "won" ? "font-semibold text-green-700" : "text-ink-soft"}>
                    {g.status === "won" ? "WON" : "lost"}
                  </span>{" "}
                  <span className="text-ink">{g.title}</span>
                </div>
              ))}
              {dismissed.map((g) => (
                <div key={g.id} className="flex items-center gap-2 rounded-xl border border-line bg-background px-4 py-2 text-sm">
                  <span className="text-ink-soft">{g.title}</span>
                  <form action={reopenGig.bind(null, g.id)} className="ml-auto">
                    <button className="text-[11px] font-semibold text-brand">Reopen</button>
                  </form>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
