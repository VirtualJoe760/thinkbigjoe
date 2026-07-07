#!/usr/bin/env node
// preview-engine.mjs — generate the cheap pre-sale "showroom" previews in paced daily WAVES.
// Deterministic infra (like the forge poller / lead engine), scheduled via launchd. Each preview
// is one Gemini copy call (~$0.0002) + a claim code — NO forge build, NO deploy. Generation is
// nearly free; the wave budget exists to keep previews FRESH (14-day expiry) and to pace them to
// how many the outreach agent + Joe can actually reach, not to save money.
//
// Config lives in the `preview_engine` table (id=1): daily_budget (wave size), enabled.
// Run on a schedule, e.g. daily:  com.thinkbigjoe.previewengine  (see the .plist)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import pg from "pg";

const log = (...a) => console.log(new Date().toISOString(), ...a);
function loadEnv(f) {
  const o = {};
  try {
    for (const l of readFileSync(f, "utf8").split("\n")) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) o[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {
    /* */
  }
  return o;
}

const env = loadEnv(join(homedir(), "code/thinkbigjoe/.env.local"));
const DB = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
const APP = process.env.FORGE_APP_URL || env.FORGE_APP_URL || "https://thinkbigjoe.com";
const SECRET = env.CRON_SECRET;
// Optional manual override to cap a run smaller than the config budget (e.g. a quick test).
const CAP = Number(process.env.PREVIEW_BATCH || 0) || null;
if (!DB || !SECRET) {
  console.error("preview-engine: missing DATABASE_URL / CRON_SECRET in thinkbigjoe/.env.local");
  process.exit(1);
}

const c = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
await c.connect();

const cfg = (await c.query("SELECT * FROM preview_engine WHERE id = 1")).rows[0];
if (!cfg || !cfg.enabled) {
  log("preview engine disabled (preview_engine.enabled=false) — nothing to do");
  await c.end();
  process.exit(0);
}

const now = new Date();
const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
const dailyBudget = Number(cfg.daily_budget) || 30;
const generatedToday = Number(
  (await c.query("SELECT count(*) n FROM forge_sites WHERE preview_generated_at >= $1", [dayStart])).rows[0].n,
);

const finish = async (summary) => {
  await c.query("UPDATE preview_engine SET last_run_at = now(), last_run_summary = $1, updated_at = now() WHERE id = 1", [summary]);
  await c.query(
    "INSERT INTO activity_log (actor, event_type, summary, metadata) VALUES ('preview_engine','preview_engine_run',$1,$2::jsonb)",
    [summary, JSON.stringify({ auto: true, generatedToday, dailyBudget })],
  );
  log(summary);
  await c.end();
};

let wave = dailyBudget - generatedToday;
if (CAP) wave = Math.min(wave, CAP);
if (wave <= 0) {
  await finish(`Today's wave already met — ${generatedToday}/${dailyBudget} previews. Resting until tomorrow.`);
  process.exit(0);
}

// Warmest first (most reviews), contactable, un-previewed, un-claimed, not yet built.
const { rows } = await c.query(
  `SELECT id, business_name FROM forge_sites
   WHERE preview IS NULL AND claimed_by_user_id IS NULL AND status = 'discovered'
     AND (nullif(phone,'') IS NOT NULL OR nullif(email,'') IS NOT NULL
          OR nullif(instagram_url,'') IS NOT NULL OR nullif(facebook_url,'') IS NOT NULL)
   ORDER BY (marketing_approved_at IS NOT NULL) DESC, NULLIF(review_count,'')::int DESC NULLS LAST, created_at ASC
   LIMIT $1`,
  [wave],
);

if (!rows.length) {
  await finish(`No un-previewed prospects left to generate (wave budget ${wave} unused).`);
  process.exit(0);
}
log(`wave: generating ${rows.length} preview(s) (budget ${dailyBudget}, ${generatedToday} already today)`);

let ok = 0;
let fail = 0;
for (const r of rows) {
  try {
    const res = await fetch(`${APP}/api/forge/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ siteId: r.id }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok) {
      ok++;
      log(`  ✓ ${r.business_name} — code ${j.claimCode}${j.usedGemini ? "" : " (fallback copy)"}`);
    } else {
      fail++;
      log(`  ✗ ${r.business_name} — ${j.error || res.status}`);
    }
  } catch (e) {
    fail++;
    log(`  ✗ ${r.business_name} — ${e.message}`);
  }
}

await finish(`Generated ${ok} preview(s)${fail ? `, ${fail} failed` : ""} · ${generatedToday + ok}/${dailyBudget} today.`);
