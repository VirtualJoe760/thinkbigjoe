import { IVY_AGENT_ID, IVY_PHONE_PRETTY } from "@/lib/contact";
import { listAgentCalls } from "@/lib/retell-calls";

/**
 * ADMIN-ONLY. Ivy's own call history — TBJ's receptionist line — pulled live from Retell.
 *
 * Ivy's calls don't persist to our `calls` table (see src/lib/retell-calls.ts), so the admin
 * reviews them straight from Retell: who called, how long, Retell's summary, and the full
 * transcript of what was said. The dashboard's value tiles above stay about the CUSTOMER's
 * receptionist; this is a distinct "your own line" section, so the two never blur.
 *
 * Gated at the call site (isAdminEmail) — never rendered for a customer.
 */
export async function IvyCalls({ limit = 15 }: { limit?: number }) {
  const calls = await listAgentCalls(IVY_AGENT_ID, limit);

  return (
    <section className="mt-10 rounded-2xl border border-brand/30 bg-brand-tint/40 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-brand">
          Ivy — your own line {IVY_PHONE_PRETTY}
        </h2>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">Admin · live from Retell</span>
      </div>

      {calls.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">
          No calls returned from Retell right now. (Empty either means a genuinely quiet stretch, or
          Retell was briefly unreachable — reload to retry.)
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {calls.map((c) => {
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
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {c.fromNumber || "Unknown caller"}
                      {c.inVoicemail && (
                        <span className="ml-2 rounded-full bg-line px-2 py-0.5 text-[10px] uppercase text-ink-soft">
                          voicemail
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-soft">
                      {c.summary || "No summary — open the transcript."}
                    </p>
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
                    {c.sentiment && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          c.sentiment === "Positive"
                            ? "bg-emerald-50 text-emerald-700"
                            : c.sentiment === "Negative"
                              ? "bg-red-50 text-red-700"
                              : "bg-line text-ink-soft"
                        }`}
                      >
                        {c.sentiment}
                      </span>
                    )}
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
