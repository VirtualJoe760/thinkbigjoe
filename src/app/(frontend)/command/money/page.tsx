import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";

import { db, moneyDeskState, moneyDeskMessages, moneyDeskVerdicts } from "@/db";
import { VENUS_CRONS } from "@/lib/venus-crons.mjs";
import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Quick Money — Max + Ryan",
  robots: { index: false, follow: false },
};

/**
 * The money desk: Max 💸 (speed) and Ryan 🔍 (proof) hunting cash Joe can make THIS WEEK.
 *
 * Three things about this board that aren't obvious:
 *
 * 1. **It is a mirror, not the master.** The agents' real state is a JSON file on Joe's Mac
 *    (~/.openclaw/shared/max-ryan/desk.json) because the claim lock and the 7-day bar are enforced
 *    in desk.mjs, not here. Vercel can't read that file, so scripts/money-desk-sync.mjs pushes it
 *    up on a launchd interval. Nothing on this page writes back — it would be clobbered on the next
 *    pass and would desync the lock the agents actually rely on. Hence the sync-age warning: a stale
 *    mirror looks identical to a quiet desk, and those mean very different things.
 *
 * 2. **Dissent is rendered louder than agreement, on purpose.** These two are built as opposites
 *    because identical agents don't validate each other, they agree with each other. So the useful
 *    signal on a verdict is the objection that survived it. A verdict with no recorded dissent is
 *    the one to distrust — the board says so out loud rather than rendering it as a clean win.
 *
 * 3. **No auto-refresh, and the list never selects report_html.** Full-table reads behind a
 *    refresher are what ran the Neon egress quota down in July 2026, and the reports are ~9KB each.
 *    The HTML is fetched only on the single-report route.
 */

type Claim = { topic: string; one_liner?: string; rounds?: number; claimed_at?: string } | null;
type Grave = { topic: string; why: string; killed_by?: string; at?: string };
type Evidence = { claim?: string; url: string; tier: string; date?: string };

const AGENT = {
  max: { emoji: "💸", name: "Max", lens: "speed — days to the first dollar", cls: "text-amber-700", bg: "bg-amber-50", ring: "ring-amber-200" },
  ryan: { emoji: "🔍", name: "Ryan", lens: "proof — who actually got paid", cls: "text-blue-700", bg: "bg-blue-50", ring: "ring-blue-200" },
  desk: { emoji: "⚙️", name: "Desk", lens: "system", cls: "text-ink-soft", bg: "bg-surface", ring: "ring-line" },
} as const;

const VERDICT = {
  pursue: { label: "Pursue", cls: "bg-green-100 text-green-800" },
  park: { label: "Parked", cls: "bg-amber-50 text-amber-700" },
  kill: { label: "Killed", cls: "bg-surface text-ink-soft" },
} as const;

const TIER = {
  verified: "bg-green-100 text-green-800",
  reported: "bg-amber-50 text-amber-700",
  anecdotal: "bg-surface text-ink-soft",
} as const;

const KIND = {
  claim: "bg-surface text-ink-soft",
  question: "bg-blue-50 text-blue-700",
  challenge: "bg-red-50 text-red-700",
  advice: "bg-indigo-50 text-indigo-700",
  answer: "bg-surface text-ink-soft",
  verdict: "bg-green-100 text-green-800",
  system: "bg-surface text-ink-soft",
} as const;

function agentOf(id: string) {
  return AGENT[id as keyof typeof AGENT] ?? AGENT.desk;
}

/** Days-to-first-dollar is THE ranking axis, so it gets colour, not just a number. */
function speedBand(days: number | null) {
  if (days === null) return { label: "unknown", cls: "bg-surface text-ink-soft" };
  if (days <= 2) return { label: `$ in ${days}d — TODAY`, cls: "bg-green-100 text-green-800" };
  if (days <= 7) return { label: `$ in ${days}d — this week`, cls: "bg-amber-50 text-amber-700" };
  return { label: `$ in ${days}d — past the bar`, cls: "bg-red-50 text-red-700" };
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function ClaimCard({ who, claim }: { who: "max" | "ryan"; claim: Claim }) {
  const a = AGENT[who];
  return (
    <div className={`rounded-lg border border-line p-4 ${claim ? "bg-white" : "bg-surface"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={`font-semibold ${a.cls}`}>
          {a.emoji} {a.name}
        </h3>
        {claim?.rounds !== undefined ? (
          <span className="text-xs text-ink-soft">round {claim.rounds}/3</span>
        ) : null}
      </div>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-soft">{a.lens}</p>
      {claim ? (
        <>
          <p className="mt-2 text-sm font-medium text-ink">{claim.topic}</p>
          {claim.one_liner ? <p className="mt-1 text-xs text-ink-soft">{claim.one_liner}</p> : null}
          {claim.claimed_at ? (
            <p className="mt-2 text-[11px] text-ink-soft">held {ago(claim.claimed_at)}</p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-soft">Not on anything — free to claim a lane.</p>
      )}
    </div>
  );
}

export default async function MoneyDeskPage() {
  await requireAdmin();

  const [state] = await db.select().from(moneyDeskState).limit(1);

  // Explicit column list: report_html is deliberately absent — it is ~9KB per row and only the
  // single-report route needs it.
  const verdicts = await db
    .select({
      id: moneyDeskVerdicts.id,
      topic: moneyDeskVerdicts.topic,
      owner: moneyDeskVerdicts.owner,
      verdict: moneyDeskVerdicts.verdict,
      whatToDo: moneyDeskVerdicts.whatToDo,
      how: moneyDeskVerdicts.how,
      practicality: moneyDeskVerdicts.practicality,
      days: moneyDeskVerdicts.timeToFirstDollarDays,
      cost: moneyDeskVerdicts.costToStartUsd,
      whoPays: moneyDeskVerdicts.whoPays,
      evidence: moneyDeskVerdicts.evidence,
      dissent: moneyDeskVerdicts.dissent,
      overrideReason: moneyDeskVerdicts.overrideReason,
      decidedAt: moneyDeskVerdicts.decidedAt,
      reportPath: moneyDeskVerdicts.reportPath,
    })
    .from(moneyDeskVerdicts)
    .orderBy(desc(moneyDeskVerdicts.decidedAt))
    .limit(50);

  const messages = await db
    .select()
    .from(moneyDeskMessages)
    .orderBy(desc(moneyDeskMessages.at))
    .limit(60);

  const claims = (state?.claims ?? {}) as Record<string, Claim>;
  const graveyard = (state?.graveyard ?? []) as Grave[];

  // "Are they even switched on?" — the manifest is the source of truth for the crons, and the
  // difference between "cold" and "broken" is the first thing to establish when the board is empty.
  const crons = VENUS_CRONS.filter((c) => c.name.startsWith("Money Desk"));
  const live = crons.filter((c) => c.enabled).length;
  const syncMins = state?.syncedAt ? (Date.now() - new Date(state.syncedAt).getTime()) / 60_000 : null;
  const syncStale = syncMins === null || syncMins > 20;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-ink">Quick Money</h1>
        <p className="mt-1 text-sm text-ink-soft">
          <strong className="text-amber-700">Max 💸</strong> hunts speed, <strong className="text-blue-700">Ryan 🔍</strong> hunts proof.
          They work separate ideas, argue about each other&apos;s, and only a verdict that survived the argument reaches you.
        </p>
      </header>

      {/* Two different failure modes that look identical on an empty board, so both get called out. */}
      {live === 0 ? (
        <p className="mb-3 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-ink-soft">
          🧊 <strong className="text-ink">Both agents are switched off.</strong> Their crons ship cold — flip{" "}
          <code className="rounded bg-white px-1 text-xs">enabled: true</code> on the two “Money Desk” entries in{" "}
          <code className="rounded bg-white px-1 text-xs">src/lib/venus-crons.mjs</code> and run{" "}
          <code className="rounded bg-white px-1 text-xs">npm run venus:sync</code>. Nothing new will appear here until you do.
        </p>
      ) : live === 1 ? (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          ⚠ Only one of the two is running. The desk is a conversation — one agent alone has nobody to check him, which is
          the exact failure this pair exists to prevent.
        </p>
      ) : null}

      {syncStale ? (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          ⚠ <strong>Mirror is stale</strong> — last synced {ago(state?.syncedAt ?? null)}. This page reads a copy pushed from
          Joe&apos;s Mac; if the sync job stopped, a quiet desk and a broken pipe look the same. Check{" "}
          <code className="rounded bg-white px-1 text-xs">/tmp/tbj-money-desk-sync.log</code>.
        </p>
      ) : null}

      {/* ---- what each of them is on right now -------------------------------------------- */}
      <section className="mb-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">On the desk now</h2>
          <p className="text-xs text-ink-soft">
            {state?.turn ? <>turn: <strong className="text-ink">{agentOf(state.turn).name}</strong> · </> : null}
            synced {ago(state?.syncedAt ?? null)}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ClaimCard who="max" claim={claims.max ?? null} />
          <ClaimCard who="ryan" claim={claims.ryan ?? null} />
        </div>
      </section>

      {/* ---- verdicts ---------------------------------------------------------------------- */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Verdicts {verdicts.length ? <span className="font-normal normal-case">({verdicts.length})</span> : null}
        </h2>

        {verdicts.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
            No verdicts yet. One appears when the two of them converge on a topic — at most three rounds of argument, then
            the owner has to call it.
          </p>
        ) : (
          <div className="space-y-3">
            {verdicts.map((v) => {
              const a = agentOf(v.owner);
              const vd = VERDICT[v.verdict as keyof typeof VERDICT] ?? { label: v.verdict, cls: "bg-surface text-ink-soft" };
              const band = speedBand(v.days);
              const steps = (Array.isArray(v.how) ? v.how : []) as string[];
              const ev = (Array.isArray(v.evidence) ? v.evidence : []) as Evidence[];
              const noDissent = !v.dissent || /^\(none recorded/i.test(v.dissent);

              return (
                <article key={v.id} className="rounded-lg border border-line bg-white p-4">
                  <header className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-ink">{v.topic}</h3>
                      <p className="text-xs text-ink-soft">
                        <span className={a.cls}>
                          {a.emoji} {a.name}
                        </span>{" "}
                        · {new Date(v.decidedAt).toLocaleString("en-US", { timeZone: "America/Phoenix", dateStyle: "medium", timeStyle: "short" })}
                        {v.practicality ? ` · practicality ${v.practicality}/5` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${band.cls}`}>{band.label}</span>
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${vd.cls}`}>{vd.label}</span>
                    </div>
                  </header>

                  {v.whatToDo ? <p className="mt-2 text-sm text-ink">{v.whatToDo}</p> : null}

                  <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-ink-soft">Who pays</dt>
                      <dd className="text-ink">{v.whoPays || <span className="text-red-600">unnamed — no payer, no play</span>}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-ink-soft">Cost to start</dt>
                      <dd className="text-ink">{v.cost !== null ? `$${v.cost}` : "—"}</dd>
                    </div>
                  </dl>

                  {steps.length ? (
                    <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-sm text-ink">
                      {steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  ) : null}

                  {ev.length ? (
                    <div className="mt-3">
                      <p className="text-[11px] uppercase tracking-wide text-ink-soft">Evidence</p>
                      <ul className="mt-1 space-y-1">
                        {ev.map((e, i) => (
                          <li key={i} className="flex flex-wrap items-baseline gap-1.5 text-xs">
                            <span className={`rounded px-1.5 py-0.5 font-semibold ${TIER[e.tier as keyof typeof TIER] ?? "bg-surface text-ink-soft"}`}>
                              {e.tier}
                            </span>
                            <span className="text-ink">{e.claim}</span>
                            <a
                              href={e.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-ink-soft underline decoration-dotted hover:text-brand"
                            >
                              {(() => {
                                try {
                                  return new URL(e.url).hostname.replace(/^www\./, "");
                                } catch {
                                  return "source";
                                }
                              })()}
                            </a>
                            {e.date ? <span className="text-ink-soft">({e.date})</span> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {/* The objection is the product. Rendered loud, never collapsed. */}
                  <div className={`mt-3 rounded border-l-4 px-3 py-2 ${noDissent ? "border-red-400 bg-red-50" : "border-amber-400 bg-amber-50"}`}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                      {noDissent ? "⚠ Nobody argued with this" : `${agentOf(v.owner === "max" ? "ryan" : "max").name}'s unresolved objection`}
                    </p>
                    <p className="mt-0.5 text-sm text-ink">
                      {noDissent
                        ? "No dissent was recorded. These two are built to attack each other's ideas, so an unopposed verdict means the check didn't happen — treat it as unreviewed, not as agreed."
                        : v.dissent}
                    </p>
                  </div>

                  {v.overrideReason ? (
                    <p className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">
                      <strong>Override:</strong> pursued despite being slower than the 7-day bar — {v.overrideReason}
                    </p>
                  ) : null}

                  {v.reportPath ? (
                    <Link
                      href={`/command/money/${v.id}`}
                      className="mt-3 inline-block rounded border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
                    >
                      Read the full report →
                    </Link>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- the conversation --------------------------------------------------------------- */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Their conversation <span className="font-normal normal-case">(newest first)</span>
        </h2>

        {messages.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
            Nothing on the desk yet.
          </p>
        ) : (
          <div className="space-y-2">
            {messages.map((m) => {
              const a = agentOf(m.fromAgent);
              return (
                <article key={m.id} className={`rounded-lg border border-line p-3 ${a.bg}`}>
                  <header className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className={`text-sm font-semibold ${a.cls}`}>
                      {a.emoji} {a.name} <span className="font-normal text-ink-soft">→ {agentOf(m.toAgent).name}</span>
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${KIND[m.kind as keyof typeof KIND] ?? "bg-surface text-ink-soft"}`}>
                        {m.kind}
                      </span>
                      <span className="text-[11px] text-ink-soft">{ago(m.at)}</span>
                    </div>
                  </header>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink">{m.body}</p>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- graveyard ---------------------------------------------------------------------- */}
      {graveyard.length ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
            Graveyard <span className="font-normal normal-case">({graveyard.length}) — ruled out, and why</span>
          </h2>
          <ul className="space-y-1.5">
            {graveyard.map((g, i) => (
              <li key={i} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
                <span className="font-medium text-ink">☠ {g.topic}</span>
                <span className="text-ink-soft"> — {g.why}</span>
                {g.killed_by ? <span className="text-xs text-ink-soft"> ({agentOf(g.killed_by).name})</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
