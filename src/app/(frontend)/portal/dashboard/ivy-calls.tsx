import { desc, eq } from "drizzle-orm";

import { calls, db } from "@/db";
import { IVY_PHONE_PRETTY } from "@/lib/contact";

/**
 * ADMIN-ONLY. Ivy's own call history — TBJ's receptionist line.
 *
 * Reads the `calls` table (site 1395, TBJ internal): since 2026-07-25 Ivy's agent posts to
 * /api/voice/webhook like any tenant line, so her calls PERSIST — transcript, summary, and a
 * Blob-hosted recording that outlives Retell's 10-minute link. History before that date was
 * backfilled transcript-only (scripts/backfill-ivy-calls.mjs).
 *
 * Gated at the call site (isAdminEmail) — never rendered for a customer.
 */
const TBJ_SITE_ID = 1395;

export async function IvyCalls({ limit = 15 }: { limit?: number }) {
  const rows = await db
    .select({
      id: calls.id,
      fromNumber: calls.fromNumber,
      startedAt: calls.startedAt,
      durationSec: calls.durationSec,
      transcript: calls.transcript,
      summary: calls.summary,
      recordingUrl: calls.recordingUrl,
      disposition: calls.disposition,
    })
    .from(calls)
    .where(eq(calls.siteId, TBJ_SITE_ID))
    .orderBy(desc(calls.startedAt))
    .limit(limit);

  return (
    <section className="mt-10 rounded-2xl border border-brand/30 bg-brand-tint/40 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-brand">
          Ivy — your own line {IVY_PHONE_PRETTY}
        </h2>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">Admin · persisted</span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">No calls recorded yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((c) => {
            const when = c.startedAt
              ? new Date(c.startedAt).toLocaleString("en-US", {
                  timeZone: "America/Phoenix",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "—";
            const mins = c.durationSec != null ? `${Math.floor(c.durationSec / 60)}m ${c.durationSec % 60}s` : "";
            return (
              <li key={c.id} className="rounded-xl border border-line bg-surface px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">
                      {c.fromNumber || "Unknown caller"}
                      {c.disposition === "voicemail" && (
                        <span className="ml-2 rounded-full bg-line px-2 py-0.5 text-[10px] uppercase text-ink-soft">
                          voicemail
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-soft">
                      {c.summary || "No summary — open the transcript."}
                    </p>
                    {c.recordingUrl ? (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <audio controls preload="none" src={c.recordingUrl} className="mt-2 h-9 w-full max-w-md" />
                    ) : null}
                    {c.transcript ? (
                      <details className="mt-2 text-sm">
                        <summary className="cursor-pointer font-medium text-brand">Read transcript</summary>
                        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-background px-3 py-2 font-sans text-xs leading-relaxed text-ink-soft">
                          {c.transcript}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-ink-soft">
                    <span>{when}</span>
                    {mins && <span className="tabular-nums">{mins}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
