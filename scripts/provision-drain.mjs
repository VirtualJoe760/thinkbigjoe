#!/usr/bin/env node
// provision-drain.mjs — the AUTO half of auto-provision-voice-on-payment.
//
// Deterministic infra (no LLM). Runs on Joe's Mac via launchd (com.thinkbigjoe.provisiondrain,
// StartInterval 300s). This is the one place the "money spend automatic" switch is ENFORCED:
//
//   1. reads auto_provision (id=1). If enabled=false → NO-OP. Money spend stays manual: the queued
//      customers wait for a human to run `provision-line --site N --apply`. (They were already
//      pinged on Telegram at payment time.) This is the default.
//   2. if enabled, counts numbers bought this week (voice_lines created in the last 7 days) and
//      pauses at weekly_line_budget — over cap PAUSES draining, never DROPS the queue (rows stay
//      'queued' and drain on a later tick once under budget). Warns at 75/90/100% like forge.
//   3. for each queued site, under budget, it SHELLS OUT to the untouched, battle-tested
//      scripts/retell/provision-line.mjs --apply. Nothing about the money-spending path changes —
//      "the change is WHAT calls it, not what it does" (docs/AUTOMATION_PIPELINE.md). provision-line's
//      own idempotency gate (active-line short-circuit + orphan adoption) is the real double-buy
//      backstop; the cap here is the runaway backstop on top of it.
//
// Flags:
//   --dry     preview only — runs provision-line WITHOUT --apply (no spend), leaves the queue as-is.
//   --limit N cap sites processed this tick (default = remaining budget).
//
// Reads DATABASE_URL_UNPOOLED + TELEGRAM_* from thinkbigjoe/.env.local. Purely additive to the DB.
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

const REPO = path.join(process.env.HOME, "code/thinkbigjoe");
const ENVF = path.join(REPO, ".env.local");
const readEnv = (k) => {
  const m = readFileSync(ENVF, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};

const DB = readEnv("DATABASE_URL_UNPOOLED") || readEnv("DATABASE_URL");
const TG_TOKEN = readEnv("TELEGRAM_BOT_TOKEN");
const TG_CHAT = readEnv("TELEGRAM_CHAT_ID");
if (!DB) { console.error("missing DATABASE_URL(_UNPOOLED) in .env.local"); process.exit(1); }

const DRY = process.argv.includes("--dry");
const LIMIT_ARG = (() => {
  const a = process.argv.find((x) => x.startsWith("--limit="));
  if (a) return Math.max(1, Number(a.split("=")[1]) || 0);
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Math.max(1, Number(process.argv[i + 1]) || 0) : null;
})();

const STALE_PROVISIONING_MIN = 15; // a row stuck 'provisioning' this long is from a crashed tick — reclaim it
const WAITING_BACKOFF_MIN = 20; // a config-incomplete row steps aside this long so it can't starve ready ones
const WARN_BANDS = [100, 90, 75]; // highest first

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function tg(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML" }),
    });
  } catch { /* best-effort */ }
}

/** ISO-week key (e.g. "2026-W29"), so warnings re-arm each week as spend ages out of the window. */
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const pool = new pg.Pool({ connectionString: DB, ssl: { rejectUnauthorized: false } });

/** Run provision-line for one site. Returns { outcome, detail }. outcome ∈ provisioned|waiting|failed. */
function runProvisionLine(siteId) {
  const args = ["scripts/retell/provision-line.mjs", "--site", String(siteId)];
  if (!DRY) args.push("--apply");
  const res = spawnSync("node", args, { cwd: REPO, encoding: "utf8", timeout: 120_000 });
  const out = `${res.stdout || ""}\n${res.stderr || ""}`;
  if (res.status === 0) return { outcome: "provisioned", detail: out.slice(-600) };
  // Exit 1 has two very different meanings — classify so a customer waiting on setup isn't marked failed.
  if (/NOT provisionable/i.test(out)) return { outcome: "waiting", detail: "config incomplete — waiting on receptionist setup" };
  if (/CROSS-SITE COLLISION/i.test(out)) return { outcome: "failed", detail: `CROSS-SITE COLLISION: ${out.slice(-400)}` };
  return { outcome: "failed", detail: (res.error ? `${res.error.message}\n` : "") + out.slice(-400) };
}

async function main() {
  const client = await pool.connect();
  try {
    const { rows: cfgRows } = await client.query(
      "SELECT enabled, weekly_line_budget, last_warn_pct, last_warn_week FROM auto_provision WHERE id = 1",
    );
    const cfg = cfgRows[0] || { enabled: false, weekly_line_budget: 10, last_warn_pct: 0, last_warn_week: null };

    const { rows: qCount } = await client.query("SELECT count(*)::int AS n FROM voice_provision_queue WHERE status = 'queued'");
    const queuedTotal = qCount[0]?.n ?? 0;

    if (!cfg.enabled) {
      log(`auto-provision OFF (money spend manual). ${queuedTotal} site(s) queued — provision manually with provision-line --apply.`);
      return;
    }

    // Reclaim rows stuck mid-provision from a crashed tick. provision-line is idempotent, so retrying is safe.
    const { rowCount: reclaimed } = await client.query(
      `UPDATE voice_provision_queue SET status='queued', updated_at=now()
         WHERE status='provisioning' AND updated_at < now() - ($1 || ' minutes')::interval`,
      [String(STALE_PROVISIONING_MIN)],
    );
    if (reclaimed) log(`reclaimed ${reclaimed} stale 'provisioning' row(s)`);

    // Spend this week = CUSTOMER numbers bought = voice_lines created in the rolling 7-day window,
    // excluding internal lines (TBJ's own Ivy line — never a provisioner purchase).
    const { rows: lineRows } = await client.query(
      `SELECT count(*)::int AS n FROM voice_lines vl JOIN forge_sites f ON f.id = vl.site_id
         WHERE vl.created_at > now() - interval '7 days' AND f.is_internal = false`,
    );
    let linesThisWeek = lineRows[0]?.n ?? 0;
    const budget = cfg.weekly_line_budget;
    let remaining = Math.max(0, budget - linesThisWeek);
    const pct = budget > 0 ? Math.round((linesThisWeek / budget) * 100) : 0;

    // Warn bands, de-duped by (last_warn_pct within the week). Re-arm when the ISO week rolls over.
    const week = isoWeek();
    let lastWarnPct = cfg.last_warn_week === week ? cfg.last_warn_pct : 0;
    const band = WARN_BANDS.find((b) => pct >= b) ?? 0;
    if (band > lastWarnPct) {
      await tg(`⚠️ <b>Auto-provision at ${pct}%</b>\n${linesThisWeek}/${budget} lines bought this week.${band >= 100 ? " Cap reached — new provisions PAUSED until it resets or you raise the cap." : ""}`);
      await client.query("UPDATE auto_provision SET last_warn_pct=$1, last_warn_week=$2, updated_at=now() WHERE id=1", [band, week]);
      lastWarnPct = band;
    } else if (cfg.last_warn_week !== week) {
      // New week and below all bands → clear the stale marker so next overrun warns.
      await client.query("UPDATE auto_provision SET last_warn_pct=0, last_warn_week=$1, updated_at=now() WHERE id=1", [week]);
    }

    if (remaining <= 0) {
      log(`over cap: ${linesThisWeek}/${budget} lines this week — pausing. ${queuedTotal} site(s) stay queued.`);
      return;
    }

    const perTick = LIMIT_ARG ? Math.min(remaining, LIMIT_ARG) : remaining;
    // BACK-OFF so config-incomplete sites can't starve ready ones. A 'waiting' row keeps its
    // status='queued' but carries a last_error and a fresh updated_at; excluding rows touched in the
    // last WAITING_BACKOFF_MIN pushes them to the back of the line, so a newly-ready paid customer is
    // never blocked behind an owner who hasn't finished setup. Fresh rows (last_error IS NULL) are
    // always eligible; waiting rows simply retry every ~20 min.
    const { rows: queued } = await client.query(
      `SELECT site_id FROM voice_provision_queue
         WHERE status='queued'
           AND (last_error IS NULL OR updated_at < now() - ($2 || ' minutes')::interval)
         ORDER BY queued_at ASC LIMIT $1`,
      [perTick, String(WAITING_BACKOFF_MIN)],
    );
    if (queued.length === 0) { log(`nothing eligible this tick (${queuedTotal} queued, some may be backing off; budget ${remaining} left this week).`); return; }

    log(`${DRY ? "[dry] " : ""}draining ${queued.length} site(s); budget ${remaining} of ${budget} left this week.`);

    let provisioned = 0, waiting = 0, failed = 0;
    for (const { site_id: siteId } of queued) {
      if (remaining <= 0) { log("budget hit mid-drain — pausing, rest stay queued."); break; }

      // Atomic claim so two overlapping ticks can't grab the same row. provision-line is the real
      // double-buy guard, but this keeps the queue state clean.
      const claim = await client.query(
        "UPDATE voice_provision_queue SET status='provisioning', attempts=attempts+1, updated_at=now() WHERE site_id=$1 AND status='queued' RETURNING site_id",
        [siteId],
      );
      if (claim.rowCount === 0) continue; // someone else took it

      const { outcome, detail } = runProvisionLine(siteId);

      if (DRY) {
        // Preview only: undo the claim, mutate nothing.
        await client.query("UPDATE voice_provision_queue SET status='queued', updated_at=now() WHERE site_id=$1", [siteId]);
        log(`[dry] site ${siteId}: would ${outcome === "provisioned" ? "PROVISION" : outcome.toUpperCase()} — ${detail.split("\n").slice(-1)[0]}`);
        continue;
      }

      if (outcome === "provisioned") {
        await client.query("UPDATE voice_provision_queue SET status='done', last_error=NULL, updated_at=now() WHERE site_id=$1", [siteId]);
        provisioned++; remaining--; linesThisWeek++;
        log(`✓ site ${siteId} provisioned (${linesThisWeek}/${budget} this week)`);
        await tg(`✅ <b>Auto-provisioned a line</b>\nsite #${siteId} — receptionist is going live. ${remaining} of the weekly cap left.`);
      } else if (outcome === "waiting") {
        await client.query("UPDATE voice_provision_queue SET status='queued', last_error=$2, updated_at=now() WHERE site_id=$1", [siteId, detail]);
        waiting++;
        log(`… site ${siteId} waiting on receptionist setup — stays queued`);
      } else {
        await client.query("UPDATE voice_provision_queue SET status='failed', last_error=$2, updated_at=now() WHERE site_id=$1", [siteId, detail]);
        failed++;
        log(`✗ site ${siteId} FAILED — ${detail.split("\n").slice(-1)[0]}`);
        await tg(`🛑 <b>Auto-provision failed</b>\nsite #${siteId}. Needs a human. <code>${detail.split("\n").slice(-1)[0].slice(0, 200)}</code>`);
      }
    }

    log(`${DRY ? "[dry] " : ""}done — ${provisioned} provisioned, ${waiting} waiting-on-config, ${failed} failed.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(async (e) => {
  log("FATAL:", e.message);
  await tg(`🛑 <b>provision-drain crashed</b>\n<code>${(e.message || "").slice(0, 200)}</code>`).catch(() => {});
  process.exit(1);
});
