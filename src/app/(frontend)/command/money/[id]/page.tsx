import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db, moneyDeskVerdicts } from "@/db";
import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Quick Money — report",
  robots: { index: false, follow: false },
};

/**
 * One money-desk report, as written by the `claude -p` session the agent shells out to.
 *
 * The HTML is **machine-generated and rendered in a locked-down iframe** — `sandbox=""` with no
 * allow-* tokens, which keeps the inline CSS (that's what makes the report readable) while blocking
 * scripts, forms, popups, top-level navigation and same-origin access entirely. This is admin-only
 * page in an admin-only area, but the content is still model output landing in a privileged app;
 * rendering it inline with dangerouslySetInnerHTML would make any prompt-injected markup in a
 * scraped source page into a foothold here. The sandbox costs nothing and removes the class.
 *
 * This route is the ONLY place report_html is selected — it is ~9KB a row and the board's list
 * query deliberately omits it (see the egress note on the parent page).
 */
export default async function MoneyReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const n = Number(id);
  if (!Number.isInteger(n)) notFound();

  const [v] = await db.select().from(moneyDeskVerdicts).where(eq(moneyDeskVerdicts.id, n)).limit(1);
  if (!v) notFound();

  const owner = v.owner === "max" ? { emoji: "💸", name: "Max" } : { emoji: "🔍", name: "Ryan" };
  const other = v.owner === "max" ? "Ryan" : "Max";
  const noDissent = !v.dissent || /^\(none recorded/i.test(v.dissent);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/command/money" className="text-sm text-ink-soft underline decoration-dotted hover:text-brand">
        ← Quick Money
      </Link>

      <header className="mt-3 mb-4">
        <h1 className="text-xl font-semibold text-ink">{v.topic}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {owner.emoji} {owner.name} ·{" "}
          {new Date(v.decidedAt).toLocaleString("en-US", { timeZone: "America/Phoenix", dateStyle: "medium", timeStyle: "short" })}
          {v.timeToFirstDollarDays !== null ? ` · $ in ${v.timeToFirstDollarDays}d` : ""}
          {v.practicality ? ` · practicality ${v.practicality}/5` : ""}
        </p>
      </header>

      {/* Kept outside the iframe on purpose: the report is the agent's own account of the play, and
          the objection is the thing that survived it. It should not be something you have to scroll
          a nested document to find. */}
      <div className={`mb-4 rounded border-l-4 px-3 py-2 ${noDissent ? "border-red-400 bg-red-50" : "border-amber-400 bg-amber-50"}`}>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          {noDissent ? "⚠ Nobody argued with this" : `${other}'s unresolved objection`}
        </p>
        <p className="mt-0.5 text-sm text-ink">
          {noDissent
            ? "No dissent was recorded. These two are built to attack each other's ideas, so an unopposed verdict means the check didn't happen — treat it as unreviewed, not as agreed."
            : v.dissent}
        </p>
      </div>

      {v.reportHtml ? (
        <iframe
          // sandbox="" = every restriction on. Inline CSS still applies; scripts do not run.
          sandbox=""
          srcDoc={v.reportHtml}
          title={`Report — ${v.topic}`}
          className="h-[80vh] w-full rounded-lg border border-line bg-white"
        />
      ) : (
        <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
          No report stored for this verdict.
          {v.reportPath ? (
            <>
              {" "}
              The desk points at <code className="rounded bg-white px-1 text-xs">{v.reportPath}</code>, so either the sync
              hasn&apos;t picked it up yet or the file is gone from Joe&apos;s Mac.
            </>
          ) : (
            <> Only a converged <strong>pursue</strong> gets one written — parked and killed topics don&apos;t.</>
          )}
        </p>
      )}

      {v.reportPath ? (
        <p className="mt-2 text-xs text-ink-soft">
          Source file on Joe&apos;s Mac: <code className="rounded bg-surface px-1">{v.reportPath}</code>
        </p>
      ) : null}
    </div>
  );
}
