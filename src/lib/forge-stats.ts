import { sql } from "drizzle-orm";

import { db } from "@/db";

/**
 * The forge digest — one computed snapshot of "where are we at" that feeds the
 * Engine cockpit (`/command/engine`), the Overview summary, and the `forge_digest`
 * MCP tool (via /api/forge/digest). Single source of truth so all three agree.
 *
 * Spend note: forge builds/edits/templates run on the Claude Max SUBSCRIPTION
 * (flat weekly rate-limit, not per-token billing), so "spend" is tracked as
 * RUNS — a build, an edit application, or a template design each = one run that
 * draws down the weekly quota. `weekly_run_budget` is the cap Joe sets; failed
 * runs still count because they still burned quota.
 */

// A forge "run" (one quota draw) = any of: forge_site_built, forge_site_build_failed,
// edit_applied, edit_failed, forge_template_built (failures still burn quota).
// "Outreach sent" spans two legacy event names: outreach_sent + forge_outreach_sent.
// These sets are inlined as literal IN-lists in the SQL below (drizzle can't bind a
// JS array to `= ANY(...)` — it expands to ANY($1,$2) which Postgres rejects).

export type QueueItem = { id: number; businessName: string; status: string; elapsedMin: number | null };
export type EditItem = {
  id: number;
  businessName: string;
  slug: string | null;
  liveUrl: string | null;
  status: string;
  waitingMin: number;
};
export type ActivityPoint = { date: string; builds: number; edits: number; outreach: number };

export type ForgeDigest = {
  config: {
    masterEnabled: boolean;
    buildsEnabled: boolean;
    editsEnabled: boolean;
    idleTemplatesEnabled: boolean;
    weeklyRunBudget: number;
    templatesPerDay: number;
    avgBuildMinutes: number;
  };
  buildQueue: { total: number; building: number; approved: number; items: QueueItem[] };
  editQueue: { total: number; items: EditItem[] };
  throughput: {
    built24h: number;
    built7d: number;
    edits24h: number;
    edits7d: number;
    templates7d: number;
    outreachSent24h: number;
    outreachSent7d: number;
    outreachDrafted7d: number;
    previews24h: number;
    previews7d: number;
  };
  budget: { weekRunsUsed: number; weeklyRunBudget: number; pct: number; remaining: number };
  series: ActivityPoint[];
  generatedAt: string;
};

// neon-http db.execute returns either an array or {rows}; normalize.
function rowsOf(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}
const n = (v: unknown): number => (v == null ? 0 : Number(v));

export async function getForgeDigest(): Promise<ForgeDigest> {
  const [cfgRes, countsRes, buildQRes, editQRes, seriesRes] = await Promise.all([
    db.execute(sql`SELECT enabled, builds_enabled, edits_enabled, idle_templates_enabled,
        weekly_run_budget, templates_per_day, avg_build_minutes
      FROM forge_engine WHERE id = 1`),
    db.execute(sql`SELECT
        count(*) FILTER (WHERE event_type = 'forge_site_built' AND created_at > now()-interval '24 hours') AS built_24h,
        count(*) FILTER (WHERE event_type = 'forge_site_built' AND created_at > now()-interval '7 days') AS built_7d,
        count(*) FILTER (WHERE event_type = 'edit_applied' AND created_at > now()-interval '24 hours') AS edits_24h,
        count(*) FILTER (WHERE event_type = 'edit_applied' AND created_at > now()-interval '7 days') AS edits_7d,
        count(*) FILTER (WHERE event_type = 'forge_template_built' AND created_at > now()-interval '7 days') AS templates_7d,
        count(*) FILTER (WHERE event_type IN ('outreach_sent','forge_outreach_sent') AND created_at > now()-interval '24 hours') AS outreach_24h,
        count(*) FILTER (WHERE event_type IN ('outreach_sent','forge_outreach_sent') AND created_at > now()-interval '7 days') AS outreach_7d,
        count(*) FILTER (WHERE event_type = 'forge_outreach_drafted' AND created_at > now()-interval '7 days') AS drafted_7d,
        count(*) FILTER (WHERE event_type = 'forge_preview_generated' AND created_at > now()-interval '24 hours') AS previews_24h,
        count(*) FILTER (WHERE event_type = 'forge_preview_generated' AND created_at > now()-interval '7 days') AS previews_7d,
        count(*) FILTER (WHERE event_type IN ('forge_site_built','forge_site_build_failed','edit_applied','edit_failed','forge_template_built') AND created_at > now()-interval '7 days') AS week_runs
      FROM activity_log`),
    db.execute(sql`SELECT id, business_name,
        CASE WHEN status='building' THEN 'building' ELSE 'approved' END AS status,
        CASE WHEN status='building' THEN GREATEST(0, round(extract(epoch FROM now()-updated_at)/60))::int ELSE NULL END AS elapsed_min
      FROM forge_sites WHERE status IN ('building','approved')
      ORDER BY (status='building') DESC, created_at ASC`),
    db.execute(sql`SELECT e.id, f.business_name, f.slug, f.live_url, e.status,
        GREATEST(0, round(extract(epoch FROM now()-e.created_at)/60))::int AS waiting_min
      FROM edit_requests e JOIN forge_sites f ON f.id = e.site_id
      WHERE e.status IN ('requested','applying') ORDER BY e.created_at ASC`),
    db.execute(sql`SELECT to_char(g.d,'YYYY-MM-DD') AS date,
        count(a.*) FILTER (WHERE a.event_type = 'forge_site_built') AS builds,
        count(a.*) FILTER (WHERE a.event_type IN ('edit_applied','edit_failed')) AS edits,
        count(a.*) FILTER (WHERE a.event_type IN ('outreach_sent','forge_outreach_sent')) AS outreach
      FROM generate_series((current_date-13)::timestamp, current_date::timestamp, interval '1 day') g(d)
      LEFT JOIN activity_log a ON a.created_at::date = g.d::date
      GROUP BY g.d ORDER BY g.d`),
  ]);

  const cfg = rowsOf(cfgRes)[0] ?? {};
  const c = rowsOf(countsRes)[0] ?? {};
  const buildRows = rowsOf(buildQRes);
  const editRows = rowsOf(editQRes);
  const seriesRows = rowsOf(seriesRes);

  const building = buildRows.filter((r) => r.status === "building").length;
  const weeklyRunBudget = n(cfg.weekly_run_budget) || 40;
  const weekRunsUsed = n(c.week_runs);

  return {
    config: {
      masterEnabled: Boolean(cfg.enabled),
      buildsEnabled: cfg.builds_enabled == null ? true : Boolean(cfg.builds_enabled),
      editsEnabled: cfg.edits_enabled == null ? true : Boolean(cfg.edits_enabled),
      idleTemplatesEnabled: Boolean(cfg.idle_templates_enabled),
      weeklyRunBudget,
      templatesPerDay: n(cfg.templates_per_day) || 2,
      avgBuildMinutes: n(cfg.avg_build_minutes) || 12,
    },
    buildQueue: {
      total: buildRows.length,
      building,
      approved: buildRows.length - building,
      items: buildRows.map((r) => ({
        id: n(r.id),
        businessName: String(r.business_name ?? ""),
        status: String(r.status),
        elapsedMin: r.elapsed_min == null ? null : n(r.elapsed_min),
      })),
    },
    editQueue: {
      total: editRows.length,
      items: editRows.map((r) => ({
        id: n(r.id),
        businessName: String(r.business_name ?? ""),
        slug: r.slug == null ? null : String(r.slug),
        liveUrl: r.live_url == null ? null : String(r.live_url),
        status: String(r.status),
        waitingMin: n(r.waiting_min),
      })),
    },
    throughput: {
      built24h: n(c.built_24h),
      built7d: n(c.built_7d),
      edits24h: n(c.edits_24h),
      edits7d: n(c.edits_7d),
      templates7d: n(c.templates_7d),
      outreachSent24h: n(c.outreach_24h),
      outreachSent7d: n(c.outreach_7d),
      outreachDrafted7d: n(c.drafted_7d),
      previews24h: n(c.previews_24h),
      previews7d: n(c.previews_7d),
    },
    budget: {
      weekRunsUsed,
      weeklyRunBudget,
      pct: weeklyRunBudget > 0 ? Math.round((weekRunsUsed / weeklyRunBudget) * 100) : 0,
      remaining: Math.max(0, weeklyRunBudget - weekRunsUsed),
    },
    series: seriesRows.map((r) => ({
      date: String(r.date),
      builds: n(r.builds),
      edits: n(r.edits),
      outreach: n(r.outreach),
    })),
    generatedAt: new Date().toISOString(),
  };
}
