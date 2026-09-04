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
 * The money desk: Max 💸 (speed) and Ryan 🔍 (proof) hunting NEW ways for Joe to make money
 * online — income he is not already earning. TBJ's own pipeline is explicitly off their desk.
 *
 * Design notes, because the first version of this page failed on exactly these points:
 *
 * 1. **It should read like watching two people work, not like a database dump.** The first cut
 *    opened with two red warning banners and printed every 2KB message in full, so the page was a
 *    wall before it was information. Now: the two of them lead as characters, the conversation is
 *    a chat with long messages collapsed behind <details>, and status is a calm strip rather than
 *    a klaxon.
 *
 * 2. **It is a MIRROR, not the master.** Their real state is a JSON file on Joe's Mac
 *    (~/.openclaw/shared/max-ryan/desk.json) because the claim lock, the round cap and the 7-day
 *    bar are enforced in desk.mjs. Vercel can't read that file, so money-desk-sync.mjs pushes it up
 *    on a launchd interval. Nothing here writes back — it would be clobbered on the next pass and
 *    would desync the lock. Hence the sync-age note: a stale mirror and a quiet desk look identical.
 *
 * 3. **Dissent renders louder than agreement.** These two are built as opposites because identical
 *    agents don't validate each other, they agree with each other. A verdict with no recorded
 *    objection is flagged as unreviewed rather than shown as a clean win.
 *
 * 4. **No auto-refresh; the list never selects report_html** (~9KB/row) — egress.
 */

type Claim = { topic: string; one_liner?: string; rounds?: number; claimed_at?: string } | null;
type Grave = { topic: string; why: string; killed_by?: string; at?: string };
type Evidence = { claim?: string; url: string; tier: string; date?: string };

const AGENT = {
  max: {
    emoji: "💸", name: "Max", role: "The hunter",
    lens: "Chases speed. Asks how many days until a dollar.",
    text: "text-amber-800", chip: "bg-amber-100 text-amber-800", bubble: "bg-amber-50 border-amber-200",
  },
  ryan: {
    emoji: "🔍", name: "Ryan", role: "The skeptic",
    lens: "Chases proof. Asks who actually got paid.",
    text: "text-blue-800", chip: "bg-blue-100 text-blue-800", bubble: "bg-blue-50 border-blue-200",
  },
  desk: {
    emoji: "⚙️", name: "Desk", role: "System",
    lens: "Automatic note from the desk itself.",
    text: "text-ink-soft", chip: "bg-surface text-ink-soft", bubble: "bg-surface border-line",
  },
} as const;

const VERDICT = {
  pursue: { label: "Worth doing", cls: "bg-green-100 text-green-800" },
  park: { label: "Parked", cls: "bg-amber-100 text-amber-800" },
  kill: { label: "Ruled out", cls: "bg-surface text-ink-soft" },
} as const;

const TIER = {
  verified: { label: "verified", cls: "bg-green-100 text-green-800" },
  reported: { label: "claimed", cls: "bg-amber-100 text-amber-800" },
  anecdotal: { label: "hearsay", cls: "bg-surface text-ink-soft" },
} as const;

// Plain English beats jargon on a board you read once a day.
const KIND: Record<string, string> = {
  claim: "picked a lane",
  question: "asked",
  challenge: "pushed back",
  advice: "suggested",
  answer: "answered",
  verdict: "decided",
  system: "note",
};

const agentOf = (id: string) => AGENT[id as keyof typeof AGENT] ?? AGENT.desk;

function speedBand(days: number | null) {
  if (days === null) return { label: "timing unknown", cls: "bg-surface text-ink-soft" };
  if (days <= 2) return { label: `Pays in ${days} day${days === 1 ? "" : "s"}`, cls: "bg-green-100 text-green-800" };
  if (days <= 7) return { label: `Pays in ${days} days`, cls: "bg-amber-100 text-amber-800" };
  return { label: `Pays in ${days} days — slow`, cls: "bg-red-50 text-red-700" };
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

/** Long messages collapse. The first version printed 2KB of text per turn and buried the thread. */
const PREVIEW = 240;

function Message({ m }: { m: typeof moneyDeskMessages.$inferSelect }) {
  const a = agentOf(m.fromAgent);
  const mine = m.fromAgent === "max";
  const long = m.body.length > PREVIEW;

  return (
    <div className={`flex ${mine ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[85%] rounded-2xl border px-4 py-3 ${a.bubble}`}>
        <div className="mb-1 flex flex-wrap items-baseline gap-2">
          <span className={`text-sm font-semibold ${a.text}`}>
            {a.emoji} {a.name}
          </span>
          <span className="text-xs text-ink-soft">{KIND[m.kind] ?? m.kind}</span>
          <span className="text-xs text-ink-soft">· {ago(m.at)}</span>
        </div>
        {long ? (
          <details className="group">
            <summary className="cursor-pointer list-none text-sm text-ink">
              {m.body.slice(0, PREVIEW).trimEnd()}…
              <span className="ml-1 whitespace-nowrap font-medium underline decoration-dotted group-open:hidden">
                read it all
              </span>
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{m.body}</p>
          </details>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-ink">{m.body}</p>
        )}
      </div>
    </div>
  );
}

function Who({ who, claim }: { who: "max" | "ryan"; claim: Claim }) {
  const a = AGENT[who];
  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl ${a.chip}`}>
          {a.emoji}
        </div>
        <div>
          <h3 className="text-base font-semibold text-ink">{a.name}</h3>
          <p className="text-xs text-ink-soft">{a.role}</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-ink-soft">{a.lens}</p>
      <div className="mt-4 border-t border-line pt-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">Working on</p>
        {claim ? (
          <>
            <p className="mt-1 text-sm font-medium text-ink">{claim.topic}</p>
            {claim.one_liner ? <p className="mt-1 text-xs text-ink-soft">{claim.one_liner}</p> : null}
            <p className="mt-2 text-[11px] text-ink-soft">
              started {ago(claim.claimed_at ?? null)}
              {claim.rounds ? ` · ${claim.rounds} of 3 rounds of argument used` : ""}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-ink-soft">Nothing right now — free to pick something up.</p>
        )}
      </div>
    </div>
  );
}

export default async function MoneyDeskPage() {
  await requireAdmin();

  const [state] = await db.select().from(moneyDeskState).limit(1);

  // report_html deliberately omitted — ~9KB/row, and only the single-report route needs it.
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
      retracted: moneyDeskVerdicts.retracted,
      retractedWhy: moneyDeskVerdicts.retractedWhy,
    })
    .from(moneyDeskVerdicts)
    .orderBy(desc(moneyDeskVerdicts.decidedAt))
    .limit(50);

  const messages = await db.select().from(moneyDeskMessages).orderBy(desc(moneyDeskMessages.at)).limit(40);

  const claims = (state?.claims ?? {}) as Record<string, Claim>;
  const graveyard = (state?.graveyard ?? []) as Grave[];
  const live = VENUS_CRONS.filter((c) => c.name.startsWith("Money Desk") && c.enabled).length;
  const syncMins = state?.syncedAt ? (Date.now() - new Date(state.syncedAt).getTime()) / 60_000 : null;
  const syncStale = syncMins === null || syncMins > 20;
  const openIdeas = verdicts.filter((v) => !v.retracted && v.verdict === "pursue").length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* ---- who they are, in plain words ------------------------------------------------ */}
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink">Quick Money</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
          Two agents looking for <strong className="text-ink">new ways for you to make money online</strong> — income
          you aren&apos;t already earning. They work separate ideas, argue about each other&apos;s, and only an idea
          that survived the argument gets written up.
        </p>
      </header>

      {/* ---- calm status strip, not a klaxon --------------------------------------------- */}
      <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
        <span className="text-ink">
          {live === 2 ? (
            <><span className="text-green-700">●</span> Both running</>
          ) : live === 1 ? (
            <><span className="text-red-600">●</span> Only one running</>
          ) : (
            <><span className="text-ink-soft">○</span> Paused</>
          )}
        </span>
        <span className="text-ink-soft">
          {openIdeas} live idea{openIdeas === 1 ? "" : "s"} · {messages.length} messages · {graveyard.length} ruled out
        </span>
        <span className={syncStale ? "text-red-600" : "text-ink-soft"}>
          {syncStale ? "⚠ not updating" : "updated"} {ago(state?.syncedAt ?? null)}
        </span>
      </div>

      {live === 0 ? (
        <p className="mb-6 rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-soft">
          They&apos;re paused, so nothing new will appear on its own. Everything below is from runs done by hand.
          To let them work: set <code className="rounded bg-surface px-1 text-xs">enabled: true</code> on the two
          “Money Desk” entries in <code className="rounded bg-surface px-1 text-xs">venus-crons.mjs</code>, then run{" "}
          <code className="rounded bg-surface px-1 text-xs">npm run venus:sync</code>.
        </p>
      ) : null}

      {syncStale ? (
        <p className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>This page has stopped updating.</strong> It reads a copy pushed from your Mac every 5 minutes — if
          that job stopped, a quiet desk and a broken pipe look identical. Check{" "}
          <code className="rounded bg-white px-1 text-xs">/tmp/tbj-money-desk-sync.log</code>.
        </p>
      ) : null}

      {/* ---- the two of them -------------------------------------------------------------- */}
      <section className="mb-8 grid gap-4 sm:grid-cols-2">
        <Who who="max" claim={claims.max ?? null} />
        <Who who="ryan" claim={claims.ryan ?? null} />
      </section>

      {/* ---- what they've decided --------------------------------------------------------- */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-ink">What they&apos;ve decided</h2>

        {verdicts.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface px-4 py-4 text-sm text-ink-soft">
            Nothing yet. An idea lands here once they&apos;ve argued it out — three rounds at most, then whoever owns
            it has to call it.
          </p>
        ) : (
          <div className="space-y-4">
            {verdicts.map((v) => {
              const a = agentOf(v.owner);
              const vd = VERDICT[v.verdict as keyof typeof VERDICT] ?? { label: v.verdict, cls: "bg-surface text-ink-soft" };
              const band = speedBand(v.days);
              const steps = (Array.isArray(v.how) ? v.how : []) as string[];
              const ev = (Array.isArray(v.evidence) ? v.evidence : []) as Evidence[];
              const noDissent = !v.dissent || /^\(none recorded/i.test(v.dissent);
              const other = v.owner === "max" ? "Ryan" : "Max";

              return (
                <article
                  key={v.id}
                  className={`rounded-xl border p-5 ${v.retracted ? "border-line bg-surface opacity-75" : "border-line bg-white"}`}
                >
                  {v.retracted ? (
                    <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                      <strong>Withdrawn.</strong> {v.retractedWhy}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className={`text-base font-semibold text-ink ${v.retracted ? "line-through" : ""}`}>
                      {v.topic}
                    </h3>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${v.retracted ? "bg-surface text-ink-soft" : band.cls}`}>
                        {band.label}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${v.retracted ? "bg-surface text-ink-soft" : vd.cls}`}>
                        {v.retracted ? "Withdrawn" : vd.label}
                      </span>
                    </div>
                  </div>

                  <p className="mt-1 text-xs text-ink-soft">
                    Found by <span className={a.text}>{a.name}</span> ·{" "}
                    {new Date(v.decidedAt).toLocaleDateString("en-US", { timeZone: "America/Phoenix", dateStyle: "medium" })}
                    {v.cost !== null ? ` · costs $${v.cost} to start` : ""}
                    {v.whoPays ? ` · paid by ${v.whoPays}` : ""}
                  </p>

                  {v.whatToDo ? <p className="mt-3 text-[15px] leading-relaxed text-ink">{v.whatToDo}</p> : null}

                  {steps.length ? (
                    <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink">
                      {steps.map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                  ) : null}

                  {/* The objection is the product — never collapsed. */}
                  <div className={`mt-4 rounded-lg px-3 py-2.5 ${noDissent ? "bg-red-50" : "bg-amber-50"}`}>
                    <p className="text-xs font-semibold text-ink">
                      {noDissent ? "⚠ Nobody argued with this" : `${other} still isn't sold:`}
                    </p>
                    <p className="mt-1 text-sm text-ink">
                      {noDissent
                        ? "No objection was recorded. These two are supposed to attack each other's ideas, so an unopposed verdict means the check didn't happen — treat it as unreviewed, not agreed."
                        : v.dissent}
                    </p>
                  </div>

                  {v.overrideReason ? (
                    <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                      <strong>Pushed through anyway:</strong> {v.overrideReason}
                    </p>
                  ) : null}

                  {ev.length ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-medium text-ink-soft underline decoration-dotted">
                        {ev.length} source{ev.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-2 space-y-1.5">
                        {ev.map((e, i) => {
                          const t = TIER[e.tier as keyof typeof TIER] ?? { label: e.tier, cls: "bg-surface text-ink-soft" };
                          let host = "source";
                          try { host = new URL(e.url).hostname.replace(/^www\./, ""); } catch {}
                          return (
                            <li key={i} className="flex flex-wrap items-baseline gap-1.5 text-xs">
                              <span className={`rounded px-1.5 py-0.5 font-medium ${t.cls}`}>{t.label}</span>
                              <span className="text-ink">{e.claim}</span>
                              <a href={e.url} target="_blank" rel="noreferrer noopener" className="text-ink-soft underline decoration-dotted hover:text-brand">
                                {host}
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  ) : null}

                  {v.reportPath ? (
                    <Link
                      href={`/command/money/${v.id}`}
                      className="mt-4 inline-block rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface"
                    >
                      Read the write-up →
                    </Link>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- the argument ----------------------------------------------------------------- */}
      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold text-ink">Their conversation</h2>
        <p className="mb-4 text-sm text-ink-soft">Newest first. Max on the left, Ryan on the right.</p>

        {messages.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface px-4 py-4 text-sm text-ink-soft">
            They haven&apos;t said anything yet.
          </p>
        ) : (
          <div className="space-y-3">
            {messages.map((m) => <Message key={m.id} m={m} />)}
          </div>
        )}
      </section>

      {/* ---- ruled out --------------------------------------------------------------------- */}
      {graveyard.length ? (
        <section>
          <details>
            <summary className="cursor-pointer text-lg font-semibold text-ink">
              Ruled out <span className="text-sm font-normal text-ink-soft">({graveyard.length})</span>
            </summary>
            <p className="mt-1 mb-3 text-sm text-ink-soft">
              Dead ends, kept on purpose — neither of them is allowed to research these again.
            </p>
            <ul className="space-y-2">
              {graveyard.map((g, i) => (
                <li key={i} className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
                  <p className="font-medium text-ink">{g.topic}</p>
                  <p className="mt-0.5 text-ink-soft">{g.why}</p>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
    </div>
  );
}
