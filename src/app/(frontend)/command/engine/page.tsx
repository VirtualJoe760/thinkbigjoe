import type { Metadata } from "next";
import { desc, sql } from "drizzle-orm";

import { db, activityLog, designReports } from "@/db";
import { requireAdmin } from "@/lib/require-admin";
import { getForgeDigest } from "@/lib/forge-stats";
import { cardClass } from "@/components/ui";
import { ClearBuildCache } from "./clear-cache";
import { EngineControls } from "./engine-controls";
import { ActivityChart } from "./activity-chart";
import { TemplateDesigner } from "./template-designer";
import { TemplateManager } from "./template-manager";
import { DesignReports, type DesignReport } from "./design-reports";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Engine room",
  robots: { index: false, follow: false },
};

const FORGE_ICONS: Record<string, string> = {
  forge_site_built: "✅",
  forge_site_build_failed: "❌",
  forge_template_built: "🎨",
  edit_applied: "✏️",
  edit_failed: "⚠️",
  forge_requeued: "🔁",
  forge_rebuild_requested: "🎲",
  forge_revision_requested: "🛠️",
  forge_engine_toggled: "🔌",
  forge_cache_cleared: "🧹",
  forge_site_deleted: "🗑️",
  forge_preview_generated: "🖼️",
  forge_prospect_added: "➕",
  forge_contact_enriched: "✨",
  forge_outreach_drafted: "✍️",
  forge_outreach_sent: "📤",
  outreach_sent: "📤",
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

// Pull a live-site URL out of an activity row's metadata (forge_site_built etc.).
function liveUrlOf(metadata: unknown): string | null {
  const m = metadata as { detail?: { liveUrl?: unknown } } | null;
  const u = m?.detail?.liveUrl;
  return typeof u === "string" && u.startsWith("http") ? u : null;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className={cardClass({ radius: "xl", tone: "surface", padding: "none", className: "px-4 py-3" })}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-ink">{value}</p>
      {sub && <p className="text-[11px] text-ink-soft">{sub}</p>}
    </div>
  );
}

export default async function EnginePage() {
  await requireAdmin();

  const digest = await getForgeDigest();
  const { config, buildQueue, editQueue, throughput, budget } = digest;

  // Preview-engine progress — how much of the contactable prospect pool has a preview.
  const pvRes = await db.execute(sql`SELECT
      count(*) FILTER (WHERE preview IS NOT NULL)::int AS total,
      count(*) FILTER (WHERE preview_generated_at >= date_trunc('day', now()))::int AS today,
      count(*) FILTER (WHERE preview IS NULL AND claimed_by_user_id IS NULL AND status='discovered'
        AND (nullif(phone,'') IS NOT NULL OR nullif(email,'') IS NOT NULL
             OR nullif(instagram_url,'') IS NOT NULL OR nullif(facebook_url,'') IS NOT NULL))::int AS remaining
    FROM forge_sites`);
  const pvRow = ((Array.isArray(pvRes) ? pvRes : (pvRes as { rows?: unknown[] }).rows ?? [])[0] ?? {}) as Record<string, unknown>;
  const pvTotal = Number(pvRow.total ?? 0);
  const pvToday = Number(pvRow.today ?? 0);
  const pvRemaining = Number(pvRow.remaining ?? 0);
  const pvPct = pvTotal + pvRemaining > 0 ? Math.round((pvTotal / (pvTotal + pvRemaining)) * 100) : 100;

  const activity = await db
    .select()
    .from(activityLog)
    .where(sql`event_type like 'forge%' or event_type in ('edit_applied','edit_failed','outreach_sent')`)
    .orderBy(desc(activityLog.createdAt))
    .limit(60);

  // Brand Lead design-research reports — the accumulating "what great looks like" per vertical.
  const reportRows = await db
    .select()
    .from(designReports)
    .orderBy(desc(designReports.createdAt))
    .limit(12);
  const reports: DesignReport[] = reportRows.map((r) => ({
    id: r.id,
    vertical: r.vertical,
    archetype: r.archetype,
    title: r.title,
    summary: r.summary,
    findings: (r.findings as Record<string, unknown> | null) ?? null,
    sources: (r.sources as { label?: string; url?: string }[] | null) ?? null,
    languageId: r.languageId,
    status: r.status,
    createdAt: r.createdAt,
  }));
  const proposedCount = reports.filter((r) => r.status === "proposed").length;

  // The forge's template library (`templates` table = source of truth for enabled; the
  // forge poll mirrors it into registry.json). Disabled first, so anything awaiting review
  // surfaces at the top of the approval gallery — with its preview + design characteristics.
  const tplRes = await db.execute(sql`
    SELECT id, dir, name, best_for, enabled, archived, preview_path,
           design->>'mood' AS mood, design->'composition' AS composition
    FROM templates ORDER BY archived ASC, enabled ASC, name ASC`);
  const tplRows = (Array.isArray(tplRes) ? tplRes : (tplRes as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[];
  const allTemplates = tplRows.map((r) => ({
    id: String(r.id),
    dir: String(r.dir),
    name: String(r.name),
    bestFor: (r.best_for as string | null) ?? null,
    enabled: Boolean(r.enabled),
    archived: Boolean(r.archived),
    previewPath: (r.preview_path as string | null) ?? null,
    mood: (r.mood as string | null) ?? null,
    composition: Array.isArray(r.composition) ? (r.composition as string[]) : null,
  }));
  const templates = allTemplates.filter((t) => !t.archived);
  const retiredTemplates = allTemplates.filter((t) => t.archived);
  const templateStats = {
    research: proposedCount, // design_reports still proposed
    awaiting: templates.filter((t) => !t.enabled).length, // built, disabled → needs review
    live: templates.filter((t) => t.enabled).length, // enabled → in rotation
  };

  // Budget gauge color + tone
  const pct = budget.pct;
  const barColor = pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-green-500";
  const gaugeNote =
    pct >= 90
      ? "Over 90% of the weekly run-budget used — new builds are throttled to protect your quota."
      : pct >= 75
        ? "Over 75% of the weekly run-budget used — approaching the cap."
        : "Comfortably within the weekly run-budget.";

  // Build-queue ETA cursor
  const building = buildQueue.items.filter((q) => q.status === "building");
  let cursor = building.length ? Math.max(1, config.avgBuildMinutes - (building[0].elapsedMin ?? 0)) : 0;

  return (
    <div className="px-6 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-extrabold tracking-tight">Engine room</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Run and monitor the forge — spend, activity, queues, and controls in one place. Builds run one at a time.
          Customer edits and new sites keep queuing safely even while the forge is off.
        </p>

        {/* Spend gauge */}
        <section className={cardClass({ className: "mt-6" })}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold tracking-tight">Weekly spend</h2>
            <span className="text-sm text-ink-soft">
              <span className="font-semibold text-ink tabular-nums">{budget.weekRunsUsed}</span> / {budget.weeklyRunBudget} runs
              <span className="ml-2 text-xs">({budget.remaining} left)</span>
            </span>
          </div>
          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-line">
            <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <p className={`mt-2 text-xs ${pct >= 75 ? "font-medium text-amber-700" : "text-ink-soft"}`}>
            {pct}% used · {gaugeNote}
          </p>
          <p className="mt-1 text-[11px] text-ink-soft">
            A “run” = one build, edit, or template — the forge runs on your Claude Max subscription (weekly quota), so this
            tracks quota draw, not a dollar bill.
          </p>
        </section>

        {/* Throughput */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Built 24h" value={throughput.built24h} sub={`${throughput.built7d} in 7d`} />
          <StatCard label="Previews 24h" value={throughput.previews24h} sub={`${throughput.previews7d} in 7d`} />
          <StatCard label="Edits 24h" value={throughput.edits24h} sub={`${throughput.edits7d} in 7d`} />
          <StatCard label="Outreach 24h" value={throughput.outreachSent24h} sub={`${throughput.outreachSent7d} in 7d`} />
        </div>

        {/* Preview engine — the sell-first pre-sale pages (one Gemini call each; the claim triggers the build) */}
        <section className={cardClass({ className: "mt-4" })}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold tracking-tight">Preview engine</h2>
            <span className="text-sm text-ink-soft">
              <span className="font-semibold text-ink tabular-nums">{pvTotal}</span> made · {pvPct}% of contactable prospects
            </span>
          </div>
          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.min(100, pvPct)}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <StatCard label="Total previews" value={pvTotal} sub="all prospects" />
            <StatCard label="Made today" value={pvToday} />
            <StatCard label="Remaining" value={pvRemaining} sub="eligible to generate" />
          </div>
          <p className="mt-3 text-[11px] text-ink-soft">
            Each preview is one Gemini call (~$0.0002) — no build, no deploy. The forge build only fires when a prospect
            claims their preview.
          </p>
        </section>

        {/* Template designer — brand-lead proposes designs; build them here (human-gated) */}
        <div className="mt-4">
          <TemplateDesigner />
        </div>

        {/* Template library — visual review + approve (enable/disable) the templates the forge uses */}
        <div className="mt-4">
          <TemplateManager templates={templates} retired={retiredTemplates} stats={templateStats} />
        </div>

        {/* Design research — the Brand Lead's accumulating reports per vertical, each verifiable by its cited sources */}
        <section className={cardClass({ className: "mt-4" })}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold tracking-tight">Design research</h2>
            <span className="text-sm text-ink-soft">
              {reports.length === 0 ? (
                "nothing filed yet"
              ) : (
                <>
                  <span className="font-semibold text-ink tabular-nums">{reports.length}</span> report{reports.length === 1 ? "" : "s"}
                  {proposedCount > 0 && <span className="ml-2 text-amber-700">· {proposedCount} to verify</span>}
                </>
              )}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-ink-soft">
            Twice a day the Brand Lead studies a vertical&apos;s best-in-class sites and files what it learned. Each report
            cites the sites it studied — verify the ones whose direction is right, and that steers the next run and the
            templates the forge builds.
          </p>
          <DesignReports reports={reports} />
        </section>

        {/* Activity chart */}
        <section className={cardClass({ className: "mt-4" })}>
          <h2 className="mb-2 text-base font-bold tracking-tight">Activity</h2>
          <ActivityChart data={digest.series} />
        </section>

        {/* Controls */}
        <div className="mt-4">
          <EngineControls config={config} />
        </div>

        {/* Build queue */}
        <section className={cardClass({ className: "mt-4" })}>
          <div className="flex items-center justify-between text-sm">
            <h2 className="text-base font-bold tracking-tight">Build queue</h2>
            <span className="text-ink-soft">{buildQueue.total} in line</span>
          </div>
          {buildQueue.total === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">Queue is empty — approve a site to add it.</p>
          ) : (
            <ol className="mt-3 flex flex-col gap-2">
              {buildQueue.items.map((q, i) => {
                const rowBuilding = q.status === "building";
                let eta: string;
                if (rowBuilding) {
                  const el = q.elapsedMin ?? 0;
                  eta = `building · ${el}m elapsed · ~${Math.max(0, config.avgBuildMinutes - el)}m left`;
                } else {
                  cursor += config.avgBuildMinutes;
                  eta = config.masterEnabled && config.buildsEnabled ? `~${cursor}m to start` : "waiting — paused";
                }
                return (
                  <li
                    key={q.id}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${rowBuilding ? "border-blue-300 bg-blue-50" : "border-line bg-surface"}`}
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${rowBuilding ? "bg-blue-600 text-white" : "bg-ink text-white"}`}>
                      {rowBuilding ? "▶" : i + 1 - building.length}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{q.businessName}</span>
                    <span className={`shrink-0 text-xs font-medium ${rowBuilding ? "text-blue-700" : "text-ink-soft"}`}>{eta}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* Edit queue */}
        <section className={cardClass({ className: "mt-4" })}>
          <div className="flex items-center justify-between text-sm">
            <h2 className="text-base font-bold tracking-tight">Customer edit queue</h2>
            <span className="text-ink-soft">{editQueue.total} waiting</span>
          </div>
          {editQueue.total === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              No edits waiting. Portal edits are always accepted — they apply on the next tick when the forge is on.
            </p>
          ) : (
            <ol className="mt-3 flex flex-col gap-2">
              {editQueue.items.map((e) => (
                <li key={e.id} className={cardClass({ radius: "xl", tone: "surface", padding: "none", className: "flex items-center gap-3 px-4 py-3" })}>
                  <span className="text-base">✏️</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{e.businessName}</p>
                    <p className="text-[11px] text-ink-soft">waiting {e.waitingMin}m</p>
                  </div>
                  {e.liveUrl && (
                    <a href={e.liveUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs font-medium text-brand hover:underline">
                      view site ↗
                    </a>
                  )}
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${e.status === "applying" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>
                    {e.status}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Maintenance */}
        <h2 className="mt-8 text-sm font-semibold uppercase tracking-widest text-ink-soft">Maintenance</h2>
        <div className={cardClass({ padding: "sm", className: "mt-3" })}>
          <ClearBuildCache />
          <p className="mt-2 text-xs text-ink-soft">
            Re-queues any build stuck over 25 minutes (a crashed or hung run) so the forge picks it up fresh on the next tick.
          </p>
        </div>

        {/* Activity feed */}
        <h2 className="mt-8 text-sm font-semibold uppercase tracking-widest text-ink-soft">Forge activity</h2>
        {activity.length === 0 ? (
          <div className={cardClass({ padding: "xl", className: "mt-3 text-center text-ink-soft" })}>
            No forge activity yet.
          </div>
        ) : (
          <div className={cardClass({ padding: "none", className: "mt-3 divide-y divide-line" })}>
            {activity.map((e) => {
              const live = liveUrlOf(e.metadata);
              return (
                <div key={e.id} className="flex items-start gap-3 px-5 py-3.5">
                  <span className="mt-0.5 shrink-0 text-lg leading-none">{FORGE_ICONS[e.eventType] ?? "⚙️"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">{e.summary}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-ink-soft">{e.eventType.replace(/_/g, " ")}</span>
                      {live && (
                        <a href={live} target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-brand hover:underline">
                          view site ↗
                        </a>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-xs text-ink-soft">{relTime(e.createdAt)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
