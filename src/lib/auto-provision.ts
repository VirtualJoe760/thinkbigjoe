/**
 * Auto-provision guardrail — the read path for the "money spend automatic" switch.
 *
 * Mirrors src/lib/forge-stats.ts#getForgeDigest by DESIGN: one global config row (auto_provision,
 * id=1) plus spend DERIVED at read time, never a stored counter. "Spend" here = phone numbers
 * bought, counted as voice_lines created in a rolling 7-day window — so the counter "resets"
 * implicitly as old lines age out of the window, exactly like forge's weekRunsUsed. There is no
 * reset job and there must not be one.
 *
 * THE INVARIANT this enables (see docs/AUTOMATION_PIPELINE.md): the Stripe webhook ENQUEUES
 * switch-agnostically (it never reads this), and only the drainer (scripts/provision-drain.mjs)
 * reads `enabled` + the cap and NO-OPS when off or over budget — so pausing never drops the queue.
 */
import { eq, sql } from "drizzle-orm";

import { db, autoProvision } from "@/db";

/** Warn at these percentages of the weekly line budget. Mirrors forge's MINUTES/run warn bands. */
export const PROVISION_WARN_THRESHOLDS = [75, 90, 100] as const;

export type AutoProvisionStatus = {
  /** Master switch. false = money spend is MANUAL (queue-for-human); true = auto-provision on payment. */
  enabled: boolean;
  /** Cap on phone numbers bought per rolling 7 days. */
  weeklyLineBudget: number;
  /** Opt-in: also auto-approve the site build on payment (forge_engine still gates the build spend). */
  autoBuildEnabled: boolean;
  /** Derived spend: voice_lines created in the last 7 days (≈ numbers bought this week). */
  linesThisWeek: number;
  /** 0–100+, linesThisWeek / weeklyLineBudget. */
  pct: number;
  /** max(0, budget − linesThisWeek). */
  remaining: number;
  /** True once linesThisWeek ≥ budget — the drainer pauses here (never drops the queue). */
  overCap: boolean;
  /** Sites waiting on a line right now (status='queued', includes config-incomplete retries). */
  queued: number;
  /** Sites whose last provisioning attempt hit a real error and need a human. */
  failed: number;
  updatedAt: string | null;
};

const DEFAULTS = { enabled: false, weeklyLineBudget: 10, autoBuildEnabled: false } as const;

export async function getAutoProvisionStatus(): Promise<AutoProvisionStatus> {
  const [cfg] = await db.select().from(autoProvision).where(eq(autoProvision.id, 1)).limit(1);

  const enabled = cfg?.enabled ?? DEFAULTS.enabled;
  const weeklyLineBudget = cfg?.weeklyLineBudget ?? DEFAULTS.weeklyLineBudget;
  const autoBuildEnabled = cfg?.autoBuildEnabled ?? DEFAULTS.autoBuildEnabled;

  // One round trip for all three counts — Neon egress is metered, and none of these scan a big table.
  const res = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM voice_lines WHERE created_at > now() - interval '7 days') AS lines_week,
      (SELECT count(*) FROM voice_provision_queue WHERE status = 'queued') AS queued,
      (SELECT count(*) FROM voice_provision_queue WHERE status = 'failed') AS failed`);
  const row = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? [])[0] as
    | Record<string, unknown>
    | undefined;
  const num = (v: unknown) => (v == null ? 0 : Number(v));

  const linesThisWeek = num(row?.lines_week);
  const pct = weeklyLineBudget > 0 ? Math.round((linesThisWeek / weeklyLineBudget) * 100) : 0;

  return {
    enabled,
    weeklyLineBudget,
    autoBuildEnabled,
    linesThisWeek,
    pct,
    remaining: Math.max(0, weeklyLineBudget - linesThisWeek),
    overCap: linesThisWeek >= weeklyLineBudget,
    queued: num(row?.queued),
    failed: num(row?.failed),
    updatedAt: cfg?.updatedAt ?? null,
  };
}
