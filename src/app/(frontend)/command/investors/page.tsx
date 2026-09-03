import type { Metadata } from "next";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db, investors, organizations, agents } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { disqualifyInvestor, setInvestorStatus, setInvestorTier, setVeraPaused } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Vera — investors",
  robots: { index: false, follow: false },
};

/**
 * Vera's investor pipeline for the **ChatRealty** raise.
 *
 * Two things about this board that aren't obvious:
 *
 * 1. The data belongs to a different company than the app rendering it. ChatRealty is org #2;
 *    everything else in the Command Center is ThinkBigJoe (org #1). The org filter below is not
 *    decoration — without it this page would eventually show TBJ rows next to cap-table research.
 *
 * 2. Every record shows its sources, as links, at the point of decision. That is the whole design.
 *    An LLM researching investors fails by inventing plausible people, and the cost lands two hops
 *    downstream when Edward writes a confident email and Joe sends it. Showing the citations where
 *    Joe decides means an unsourced claim is visibly unsourced rather than quietly wrong.
 *
 * No auto-refresh here on purpose: full-table reads behind a refresher are what ran the Neon
 * egress quota down in July. Joe reloads when he wants it fresh.
 */

type Investor = typeof investors.$inferSelect;
type Source = { url: string; supports?: string | null; checked_at?: string | null };

const STATUS: Record<string, { label: string; cls: string }> = {
  qualified: { label: "Ready for Edward", cls: "bg-amber-50 text-amber-700" },
  drafting: { label: "Edward drafting", cls: "bg-blue-50 text-blue-700" },
  awaiting_approval: { label: "Awaiting Venus", cls: "bg-orange-50 text-orange-700" },
  contacted: { label: "Contacted", cls: "bg-indigo-50 text-indigo-700" },
  replied: { label: "Replied", cls: "bg-green-100 text-green-800" },
  passed: { label: "Passed", cls: "bg-surface text-ink-soft" },
  disqualified: { label: "Disqualified", cls: "bg-surface text-ink-soft" },
};

const TIER_CLS: Record<string, string> = {
  T1: "bg-green-100 text-green-800",
  T2: "bg-blue-50 text-blue-700",
  T3: "bg-surface text-ink-soft",
};

const IN_FLIGHT = ["drafting", "awaiting_approval", "contacted", "replied"];

function money(min: number | null, max: number | null): string {
  if (!min && !max) return "";
  const k = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`);
  if (min && max) return `${k(min)}–${k(max)}`;
  return k((min || max) as number);
}

function daysSince(d: string | null): number | null {
  if (!d) return null;
  return Math.round((Date.now() - new Date(d).getTime()) / 86_400_000);
}

function Sources({ raw }: { raw: unknown }) {
  const list = (Array.isArray(raw) ? raw : []) as Source[];
  if (!list.length) {
    // Shouldn't happen — add_investor rejects an empty list — but if it ever does, say so loudly
    // rather than rendering a tidy card that looks as trustworthy as a sourced one.
    return <p className="mt-2 text-xs font-semibold text-red-600">⚠ No sources on this record — do not act on it.</p>;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {list.map((s, i) => (
        <a
          key={i}
          href={s.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs text-ink-soft underline decoration-dotted hover:text-brand"
          title={s.checked_at ? `checked ${s.checked_at}` : undefined}
        >
          {s.supports || new URL(s.url).hostname.replace(/^www\./, "")}
        </a>
      ))}
    </div>
  );
}

function Card({ inv }: { inv: Investor }) {
  const st = STATUS[inv.status] ?? { label: inv.status, cls: "bg-surface text-ink-soft" };
  const age = daysSince(inv.lastCheckAt);
  const stale = age !== null && age > 365;
  const band = money(inv.checkMin, inv.checkMax);

  return (
    <article className="rounded-lg border border-line bg-white p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-ink">
            {inv.name}
            {inv.firm ? <span className="font-normal text-ink-soft"> · {inv.firm}</span> : null}
          </h3>
          <p className="text-xs text-ink-soft">
            {[inv.role, inv.location, band].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {inv.tier ? (
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${TIER_CLS[inv.tier] ?? ""}`}>{inv.tier}</span>
          ) : null}
          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
        </div>
      </header>

      {inv.whyFit ? <p className="mt-2 text-sm text-ink">{inv.whyFit}</p> : null}
      {inv.thesis ? <p className="mt-1 text-xs italic text-ink-soft">“{inv.thesis}”</p> : null}

      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-ink-soft">Last check</dt>
          <dd className={stale ? "font-semibold text-red-600" : "text-ink"}>
            {inv.lastCheckAt ? (
              <>
                {inv.lastCheckAt} ({age}d{stale ? " — dormant" : ""})
                {inv.lastCheckEvidence ? (
                  <>
                    {" "}
                    <a href={inv.lastCheckEvidence} target="_blank" rel="noreferrer noopener" className="underline decoration-dotted">
                      evidence
                    </a>
                  </>
                ) : (
                  <span className="text-red-600"> — unevidenced</span>
                )}
              </>
            ) : (
              <span className="text-red-600">none — recency unverified</span>
            )}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-ink-soft">Contact</dt>
          <dd className="text-ink">
            {inv.email ? (
              <>
                {inv.email}
                {inv.emailSource ? (
                  <>
                    {" "}
                    <a href={inv.emailSource} target="_blank" rel="noreferrer noopener" className="text-ink-soft underline decoration-dotted">
                      source
                    </a>
                  </>
                ) : (
                  <span className="font-semibold text-red-600"> — UNSOURCED, do not use</span>
                )}
              </>
            ) : (
              <span className="text-ink-soft">no address — warm intro only</span>
            )}
          </dd>
        </div>
        {inv.warmPath ? (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-ink-soft">Warm path</dt>
            <dd className="text-ink">{inv.warmPath}</dd>
          </div>
        ) : null}
        {inv.conflicts ? (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-ink-soft">Conflicts</dt>
            <dd className="text-amber-700">{inv.conflicts}</dd>
          </div>
        ) : null}
        {inv.disqualifiedReason ? (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-ink-soft">Why not</dt>
            <dd className="text-ink">{inv.disqualifiedReason}</dd>
          </div>
        ) : null}
      </dl>

      <Sources raw={inv.sources} />

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {(["T1", "T2", "T3"] as const).map((t) => (
          <form key={t} action={setInvestorTier.bind(null, inv.id, t)}>
            <button
              type="submit"
              disabled={inv.tier === t}
              className="rounded border border-line px-2 py-1 text-xs text-ink-soft hover:border-brand hover:text-brand disabled:opacity-30"
            >
              {t}
            </button>
          </form>
        ))}
        {inv.status !== "passed" ? (
          <form action={setInvestorStatus.bind(null, inv.id, "passed")}>
            <button type="submit" className="rounded border border-line px-2 py-1 text-xs text-ink-soft hover:text-ink">
              Passed
            </button>
          </form>
        ) : null}
        {inv.status === "disqualified" || inv.status === "passed" ? (
          <form action={setInvestorStatus.bind(null, inv.id, "qualified")}>
            <button type="submit" className="rounded border border-line px-2 py-1 text-xs text-ink-soft hover:text-ink">
              Reopen
            </button>
          </form>
        ) : (
          <form
            action={async (fd: FormData) => {
              "use server";
              await disqualifyInvestor(inv.id, String(fd.get("reason") || ""));
            }}
            className="flex items-center gap-1"
          >
            <input
              name="reason"
              required
              placeholder="Disqualify — why?"
              className="w-44 rounded border border-line px-2 py-1 text-xs"
            />
            <button type="submit" className="rounded border border-line px-2 py-1 text-xs text-ink-soft hover:text-red-600">
              Cut
            </button>
          </form>
        )}
        <span className="ml-auto flex gap-2 text-xs text-ink-soft">
          {inv.linkedinUrl ? <a href={inv.linkedinUrl} target="_blank" rel="noreferrer noopener" className="hover:text-brand">in</a> : null}
          {inv.xUrl ? <a href={inv.xUrl} target="_blank" rel="noreferrer noopener" className="hover:text-brand">X</a> : null}
          {inv.websiteUrl ? <a href={inv.websiteUrl} target="_blank" rel="noreferrer noopener" className="hover:text-brand">site</a> : null}
          <span>#{inv.id}</span>
        </span>
      </div>
    </article>
  );
}

function Section({ title, note, rows }: { title: string; note?: string; rows: Investor[] }) {
  if (!rows.length) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-soft">
        {title} <span className="font-normal">({rows.length})</span>
      </h2>
      {note ? <p className="mb-3 text-xs text-ink-soft">{note}</p> : null}
      <div className="space-y-3">
        {rows.map((r) => <Card key={r.id} inv={r} />)}
      </div>
    </section>
  );
}

export default async function InvestorsPage() {
  await requireAdmin();

  const org = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, "chatrealty"))
    .limit(1);

  if (!org[0]) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold">Vera — investors</h1>
        <p className="mt-2 text-sm text-red-600">
          The ChatRealty organization row is missing. Run{" "}
          <code>node scripts/db/2026-09-02-investors.sql</code> via <code>scripts/db/apply-sql.mjs</code>.
        </p>
      </div>
    );
  }
  const orgId = org[0].id;

  const [rows, veraRow] = await Promise.all([
    db
      .select()
      .from(investors)
      .where(eq(investors.orgId, orgId))
      .orderBy(asc(investors.tier), desc(investors.updatedAt))
      .limit(300),
    db.select({ paused: agents.paused }).from(agents).where(eq(agents.id, "angel-scout")).limit(1),
  ]);

  const paused = veraRow[0]?.paused ?? false;
  const qualified = rows.filter((r) => r.status === "qualified");
  const inFlight = rows.filter((r) => IN_FLIGHT.includes(r.status));
  const closed = rows.filter((r) => r.status === "disqualified" || r.status === "passed");
  const t1 = qualified.filter((r) => r.tier === "T1").length;

  return (
    <div className="p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Vera 🔎 — investor pipeline</h1>
          <p className="mt-1 text-sm text-ink-soft">
            The <strong>ChatRealty</strong> raise — a different company from ThinkBigJoe, sharing this
            board and nothing else. Vera researches and sources; Edward drafts from her bios; Venus
            approves; you send. Nothing here can contact anyone on its own.
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            {qualified.length} ready for Edward ({t1} T1) · {inFlight.length} in flight · {closed.length} closed
          </p>
        </div>
        <form action={setVeraPaused.bind(null, !paused)}>
          <button
            type="submit"
            className={`rounded border px-3 py-1.5 text-sm font-semibold ${
              paused ? "border-green-600 text-green-700" : "border-line text-ink-soft hover:text-ink"
            }`}
          >
            {paused ? "▶ Resume Vera" : "⏸ Pause Vera"}
          </button>
        </form>
      </header>

      {paused ? (
        <p className="mb-6 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Vera is paused. <code>add_investor</code> refuses while this is set, so she stands down
          mid-run rather than at the next cron.
        </p>
      ) : null}

      {!rows.length ? (
        <p className="rounded border border-line bg-surface p-4 text-sm text-ink-soft">
          Nothing recorded yet. Vera writes here on her research runs — she caps herself at ten
          fully verified investors per run, by design.
        </p>
      ) : null}

      <Section
        title="Ready for Edward"
        note="Qualified, sourced, and carrying a why-fit line. These are what list_investors_for_outreach hands him."
        rows={qualified}
      />
      <Section title="In flight" rows={inFlight} />
      <Section
        title="Closed"
        note="Kept on purpose — the reason is what stops Vera re-researching the same person next month."
        rows={closed}
      />
    </div>
  );
}
