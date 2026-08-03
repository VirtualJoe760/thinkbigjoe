import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";

import { agents, db, organizations } from "@/db";
import { AgentChat } from "./agent-chat";

/**
 * ADMIN-ONLY. The real OpenClaw roster, org-scoped — who works for this organization, on what
 * model, and what they've been doing (activity_log). Mirrored from ~/.openclaw/openclaw.json by
 * scripts/sync-openclaw-agents.mjs. Chat goes through the agent-bridge (see agent-chat.tsx).
 * A future customer org (their own agent crew) renders through this same component with their
 * org id — that's the whole point of the org layer.
 */
export async function OrgRoster({ orgSlug = "thinkbigjoe" }: { orgSlug?: string }) {
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, orgSlug)).limit(1);
  if (!org) return null;

  const roster = await db
    .select()
    .from(agents)
    .where(sql`${agents.orgId} = ${org.id} AND ${agents.archived} = false`)
    .orderBy(asc(agents.id));

  // One recent-activity line per agent — matched on the actor or the agent's name in the summary.
  const activity = (
    await db.execute(sql`
      SELECT DISTINCT ON (agent) agent, summary, created_at FROM (
        SELECT CASE
                 WHEN actor = 'venus' THEN 'main'
                 WHEN actor = 'agent' THEN 'outreach'
                 ELSE actor
               END AS agent, summary, created_at
        FROM activity_log
        WHERE created_at > now() - interval '7 days'
      ) t ORDER BY agent, created_at DESC`)
  ).rows as Array<{ agent: string; summary: string; created_at: string }>;
  const lastByAgent = new Map(activity.map((a) => [a.agent, a]));

  // Agents that have their own work dashboard, reachable from here.
  const DASHBOARDS: Record<string, string> = { whitney: "/command/applications" };

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
          {org.name} agent org · account {org.accountNumber || "—"}
        </h2>
        <Link href="/command/agents" className="text-xs font-semibold text-brand hover:underline">
          SMS test console →
        </Link>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {roster.map((a) => {
          const act = lastByAgent.get(a.id);
          const isVenus = a.id === "main";
          return (
            <div key={a.id} className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold tracking-tight">
                    {a.name}
                    {isVenus && <span className="ml-2 rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-bold uppercase text-brand">orchestrator</span>}
                  </h3>
                  <p className="mt-0.5 text-sm text-ink-soft">{a.role}</p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    a.enabled ? "bg-green-100 text-green-800" : "bg-line text-ink-soft"
                  }`}
                >
                  {a.enabled ? "running" : "off"}
                </span>
              </div>
              <p className="mt-2 font-mono text-[11px] text-ink-soft">{a.model || "default model"}</p>
              {act && (
                <p className="mt-2 line-clamp-2 text-xs text-ink-soft">
                  <span className="font-semibold text-ink">Last: </span>
                  {act.summary}
                </p>
              )}
              {DASHBOARDS[a.id] && (
                <Link
                  href={DASHBOARDS[a.id]}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                >
                  Open {a.name}&apos;s dashboard →
                </Link>
              )}
              <AgentChat agentId={a.id} agentName={a.name} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
