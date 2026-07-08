import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";

import { db, forgeEngine, forgeSites, editRequests, activityLog } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { ForgePanel, type ForgeEngineStats } from "../prospects/forge-panel";
import { ClearBuildCache } from "./clear-cache";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Engine room",
  robots: { index: false, follow: false },
};

const FORGE_ICONS: Record<string, string> = {
  forge_site_built: "✅",
  forge_site_build_failed: "❌",
  forge_requeued: "🔁",
  forge_rebuild_requested: "🎲",
  forge_revision_requested: "🛠️",
  forge_engine_toggled: "🔌",
  forge_cache_cleared: "🧹",
  forge_preview_generated: "🖼️",
  forge_prospect_added: "➕",
  forge_contact_enriched: "✨",
  forge_outreach_drafted: "✍️",
  forge_outreach_sent: "📤",
  forge_callprep: "📋",
};

function relTime(iso: string | Date | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso as string).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default async function EnginePage() {
  await requireAdmin();

  const forgeCfg = await db.select().from(forgeEngine).where(eq(forgeEngine.id, 1)).limit(1).then((r) => r[0]);
  let forgeStats: ForgeEngineStats | null = null;
  if (forgeCfg) {
    const qRows = await db
      .select({ id: forgeSites.id, businessName: forgeSites.businessName, status: forgeSites.status, updatedAt: forgeSites.updatedAt, createdAt: forgeSites.createdAt })
      .from(forgeSites)
      .where(sql`status in ('building','approved')`);
    const nowMs = Date.now();
    const ordered = [
      ...qRows.filter((r) => r.status === "building"),
      ...qRows.filter((r) => r.status === "approved").sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()),
    ];
    forgeStats = {
      enabled: forgeCfg.enabled,
      avgBuildMinutes: forgeCfg.avgBuildMinutes,
      queue: ordered.map((r) => ({
        id: r.id,
        businessName: r.businessName,
        status: r.status,
        elapsedMin: r.status === "building" && r.updatedAt ? Math.max(0, Math.round((nowMs - new Date(r.updatedAt).getTime()) / 60000)) : null,
      })),
    };
  }

  const pendingEdits = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(editRequests)
    .where(sql`status in ('requested','applying')`)
    .then((r) => r[0]?.count ?? 0);

  const activity = await db
    .select()
    .from(activityLog)
    .where(sql`event_type like 'forge%'`)
    .orderBy(desc(activityLog.createdAt))
    .limit(60);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Engine room</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Run the forge — flip it on/off, watch the build queue, and see everything it&apos;s shipped. Builds run one at a
          time. Customer edits and new sites keep queuing safely even while the forge is off, and build the moment you turn
          it back on.
        </p>

        {forgeStats && (
          <div className="mt-6">
            <ForgePanel stats={forgeStats} />
          </div>
        )}

        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-line bg-background px-5 py-3.5">
          <span className="text-lg leading-none">✏️</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">
              {pendingEdits === 0
                ? "No customer edits waiting"
                : `${pendingEdits} customer edit${pendingEdits === 1 ? "" : "s"} queued`}
            </p>
            <p className="text-[11px] text-ink-soft">
              Portal edits are always accepted and saved — they apply on the next tick when the forge is on, or wait here
              while it&apos;s off.
            </p>
          </div>
          {pendingEdits > 0 && (
            <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
              {forgeStats?.enabled ? "applying" : "waiting"}
            </span>
          )}
        </div>

        <h2 className="mt-8 text-sm font-semibold uppercase tracking-widest text-ink-soft">Maintenance</h2>
        <div className="mt-3 rounded-2xl border border-line bg-background p-4">
          <ClearBuildCache />
          <p className="mt-2 text-xs text-ink-soft">
            Re-queues any build stuck over 25 minutes (a crashed or hung run) so the forge picks it up fresh on the next tick.
          </p>
        </div>

        <h2 className="mt-8 text-sm font-semibold uppercase tracking-widest text-ink-soft">Forge activity</h2>
        {activity.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-line bg-background p-8 text-center text-ink-soft">
            No forge activity yet.
          </div>
        ) : (
          <div className="mt-3 divide-y divide-line rounded-2xl border border-line bg-background">
            {activity.map((e) => (
              <div key={e.id} className="flex items-start gap-3 px-5 py-3.5">
                <span className="mt-0.5 shrink-0 text-lg leading-none">{FORGE_ICONS[e.eventType] ?? "⚙️"}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{e.summary}</p>
                  <span className="text-[11px] text-ink-soft">{e.eventType.replace(/_/g, " ")}</span>
                </div>
                <span className="shrink-0 whitespace-nowrap text-xs text-ink-soft">{relTime(e.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
