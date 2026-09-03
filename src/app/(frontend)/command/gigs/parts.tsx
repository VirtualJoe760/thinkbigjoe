import { gigs } from "@/db";

// Shared presentational pieces for the Destiny gig board + the full-gig detail page.
// Mirrors applications/parts.tsx deliberately: the two boards are the same shape of work
// (agent finds → Joe approves → agent acts), so they should read the same at a glance.
export type Gig = typeof gigs.$inferSelect;

export const STAGE: Record<string, { label: string; cls: string }> = {
  found: { label: "Needs review", cls: "bg-amber-50 text-amber-700" },
  approved: { label: "Approved · queued to bid", cls: "bg-blue-50 text-blue-700" },
  drafted: { label: "Written · not sent", cls: "bg-orange-50 text-orange-700" },
  submitted: { label: "Proposal sent", cls: "bg-indigo-50 text-indigo-700" },
  won: { label: "Won", cls: "bg-green-100 text-green-800" },
  lost: { label: "Lost", cls: "bg-surface text-ink-soft" },
  dismissed: { label: "Dismissed", cls: "bg-surface text-ink-soft" },
};

export const LANE: Record<string, string> = {
  "ai-agent": "AI agent",
  engineering: "Engineering",
  "web-design": "Web design",
};

export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function abbreviate(text: string | null, max = 160): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

export function StageBadge({ status }: { status: string }) {
  const s = STAGE[status] ?? { label: status, cls: "bg-surface text-ink-soft" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.cls}`}>
      {s.label}
    </span>
  );
}

/**
 * win_score is the headline, not fit_score — and it is deliberately styled louder.
 * Joe's profile has no reviews and no Job Success Score, and Destiny now spends the Connects
 * herself, so "can he actually WIN this" is the number that decides whether approving costs money.
 */
export function ScoreChip({ label, score, primary }: { label: string; score: number | null; primary?: boolean }) {
  if (score == null) return null;
  const cls = score >= 70 ? "bg-green-50 text-green-700" : score >= 45 ? "bg-amber-50 text-amber-700" : "bg-surface text-ink-soft";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls} ${primary ? "ring-1 ring-inset ring-current/25" : ""}`}>
      {label} {score}
    </span>
  );
}

export function LaneBadge({ gig }: { gig: Gig }) {
  if (!gig.lane) return null;
  return (
    <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
      {LANE[gig.lane] ?? gig.lane}
    </span>
  );
}

/**
 * The three facts that decide whether a bid is worth real Connects. Destiny reads these off the
 * live posting now rather than guessing them from an alert email, so they're worth showing plainly
 * — an unverified client with no hires is where Connects go to die.
 */
export function ClientSignals({ gig }: { gig: Gig }) {
  const crowded = gig.proposalsSoFar != null && gig.proposalsSoFar >= 20;
  const risky = gig.clientVerified === false || gig.clientHires === 0;
  if (gig.proposalsSoFar == null && gig.clientHires == null && gig.clientVerified == null) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
      {gig.proposalsSoFar != null && (
        <span className={crowded ? "font-semibold text-red-600" : "text-ink-soft"}>
          {gig.proposalsSoFar} proposals{crowded ? " — crowded" : ""}
        </span>
      )}
      {gig.clientHires != null && <span className="text-ink-soft">· {gig.clientHires} prior hires</span>}
      {gig.clientVerified != null && (
        <span className={gig.clientVerified ? "text-ink-soft" : "font-semibold text-red-600"}>
          · {gig.clientVerified ? "payment verified" : "payment UNVERIFIED"}
        </span>
      )}
      {risky && <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-700">risky client</span>}
    </div>
  );
}

export function MetaRow({ gig }: { gig: Gig }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-soft">
      {gig.budget && <span className="font-medium text-ink">{gig.budget}</span>}
      {gig.scope && <span>· {gig.scope}</span>}
      {gig.platform && <span>· {gig.platform}</span>}
      {gig.url && (
        <a href={gig.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
          · posting ↗
        </a>
      )}
    </div>
  );
}

/** Full detail block — the posting, Destiny's two reads, client signals, and her proposal. */
export function GigDetails({ gig }: { gig: Gig }) {
  return (
    <div className="space-y-5">
      {gig.description && (
        <section>
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">The posting</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{gig.description}</p>
        </section>
      )}

      {(gig.winReason || gig.fitReason) && (
        <section>
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Destiny&apos;s read</p>
          <div className="mt-1 space-y-2">
            {gig.winReason && (
              <p className="rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed text-ink-soft">
                <span className="font-semibold text-ink">Can he win it?</span> {gig.winReason}
              </p>
            )}
            {gig.fitReason && (
              <p className="rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed text-ink-soft">
                <span className="font-semibold text-ink">Can he do it?</span> {gig.fitReason}
              </p>
            )}
          </div>
        </section>
      )}

      <section>
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">The client</p>
        <ClientSignals gig={gig} />
        {gig.proposalsSoFar == null && gig.clientHires == null && gig.clientVerified == null && (
          <p className="mt-1 text-xs text-ink-soft">No client signals captured for this posting.</p>
        )}
      </section>

      {gig.proposal && (
        <section>
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">
            The proposal {gig.status === "submitted" ? "she sent" : "she wrote"}
          </p>
          <pre className="mt-1 whitespace-pre-wrap rounded-xl border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-ink">
            {gig.proposal}
          </pre>
        </section>
      )}

      {gig.notes && (
        <section>
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Notes</p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-soft">{gig.notes}</p>
        </section>
      )}
    </div>
  );
}
