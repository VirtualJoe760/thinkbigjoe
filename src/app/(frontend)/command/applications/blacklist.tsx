import { asc } from "drizzle-orm";

import { db, employerBlacklist } from "@/db";
import { blacklistEmployer, unblacklistEmployer } from "./actions";

/**
 * "Won't work for" — the employers Whitney must never surface.
 *
 * Enforced in the MCP server (record_found_job refuses a match), not merely in her prompt, so
 * Joe never declines the same company twice. Adding one also clears anything from them still
 * sitting on the review board.
 *
 * Matching is on a normalized name, so a single "Zillow" entry also blocks "Zillow Group",
 * "Zillow, Inc." and "Zillow Group Technologies LLC".
 */
export async function EmployerBlacklist() {
  const rows = await db
    .select({
      id: employerBlacklist.id,
      company: employerBlacklist.company,
      reason: employerBlacklist.reason,
    })
    .from(employerBlacklist)
    .orderBy(asc(employerBlacklist.company));

  return (
    <section className="mt-7 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
          Won&apos;t work for ({rows.length})
        </h2>
        <span className="text-[11px] text-ink-soft">
          Whitney can&apos;t surface these — blocked in the tool, not just her instructions.
        </span>
      </div>

      <form action={blacklistEmployer} className="mt-3 flex flex-wrap items-start gap-2">
        <input
          name="company"
          required
          placeholder="Company name"
          className="min-w-[10rem] flex-1 rounded-lg border border-line bg-background px-3 py-2 text-xs text-ink outline-none focus:border-brand"
        />
        <input
          name="reason"
          placeholder="Optional — why"
          className="min-w-[10rem] flex-1 rounded-lg border border-line bg-background px-3 py-2 text-xs text-ink outline-none focus:border-brand"
        />
        <button className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90">
          Block
        </button>
      </form>

      {rows.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          {rows.map((r) => (
            <span
              key={r.id}
              className="inline-flex items-center gap-2 rounded-full bg-background px-3 py-1 text-[11px] text-ink"
              title={r.reason ?? undefined}
            >
              <span className="font-semibold">{r.company}</span>
              <form action={unblacklistEmployer.bind(null, r.id)}>
                <button
                  className="text-ink-soft transition-colors hover:text-red-600"
                  aria-label={`Unblock ${r.company}`}
                >
                  ✕
                </button>
              </form>
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-ink-soft">
        One entry covers the variants —{" "}
        <span className="font-medium text-ink">Zillow</span>{" "}
        also blocks &ldquo;Zillow Group, Inc.&rdquo;. Adding a company also clears anything from them
        still awaiting your review.
      </p>
    </section>
  );
}
