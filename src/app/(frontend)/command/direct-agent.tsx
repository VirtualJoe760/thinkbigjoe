import { and, asc, eq, inArray } from "drizzle-orm";

import { agentDirectives, db } from "@/db";
import { directAgent, cancelDirective } from "./applications/actions";

/**
 * "Tell <agent> to…" — Joe's manual override, reusable on any agent's dashboard.
 *
 * Why this exists: the daily budget cap stops an agent burning quota on autonomous busywork.
 * It must never stop JOE. A directive is worked before the agent's own loop and lifts that
 * agent's cap until it's done, so "go after Compass" or "draft a reply to this" always gets
 * through no matter how much of the day's budget is gone.
 *
 * Agent-agnostic: pass any agent id and it works, including one created after this file.
 */
export async function DirectAgent({
  agent,
  label,
  placeholder,
}: {
  agent: string;
  label: string;
  placeholder: string;
}) {
  const open = await db
    .select({
      id: agentDirectives.id,
      request: agentDirectives.request,
      context: agentDirectives.context,
      status: agentDirectives.status,
      createdAt: agentDirectives.createdAt,
    })
    .from(agentDirectives)
    .where(and(eq(agentDirectives.agent, agent), inArray(agentDirectives.status, ["open", "working"])))
    .orderBy(asc(agentDirectives.createdAt));

  return (
    <section className="mt-7 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Tell {label} to…</h2>
        <span className="text-[11px] text-ink-soft">
          Jumps the queue and{" "}
          <span className="font-medium text-ink">ignores {label}&apos;s daily cap</span>{" "}
          until it&apos;s done.
        </span>
      </div>

      <form action={directAgent.bind(null, agent)} className="mt-3">
        <textarea
          name="request"
          rows={2}
          required
          placeholder={placeholder}
          className="w-full rounded-lg border border-line bg-background px-3 py-2 text-xs text-ink outline-none focus:border-brand"
        />
        <input
          name="context"
          placeholder="Optional — a link, a company, an email subject"
          className="mt-2 w-full rounded-lg border border-line bg-background px-3 py-2 text-xs text-ink outline-none focus:border-brand"
        />
        <button className="mt-2 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90">
          Send instruction
        </button>
      </form>

      {open.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-line pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            Waiting on {label} ({open.length})
          </p>
          {open.map((d) => (
            <div key={d.id} className="flex items-start gap-2 rounded-lg bg-background px-3 py-2">
              <span
                className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  d.status === "working" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"
                }`}
              >
                {d.status === "working" ? "on it" : "queued"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-ink">{d.request}</p>
                {d.context && <p className="mt-0.5 truncate text-[11px] text-ink-soft">{d.context}</p>}
              </div>
              <form action={cancelDirective.bind(null, d.id)}>
                <button className="shrink-0 text-[11px] font-semibold text-ink-soft transition-colors hover:text-red-600">
                  Cancel
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
