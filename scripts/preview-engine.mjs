#!/usr/bin/env node
// preview-engine.mjs — batch-generate the cheap pre-sale "showroom" previews for
// contactable prospects that don't have one yet. Deterministic infra (like the forge
// poller), scheduled via launchd. Each preview is a Gemini copy call (~$0.001) + a claim
// code — NO forge build. Sending the preview link is still a separate (human/outreach) step.
//
//   */30 * * * *  cd ~/code/thinkbigjoe && node scripts/preview-engine.mjs >> /tmp/preview-engine.log 2>&1
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
const LIMIT = Number(process.env.PREVIEW_BATCH || env.PREVIEW_BATCH || 20);
if (!DB || !SECRET) {
  console.error("preview-engine: missing DATABASE_URL / CRON_SECRET in thinkbigjoe/.env.local");
  process.exit(1);
}

const c = new pg.Client({ connectionString: DB });
await c.connect();
// Warmest first (most reviews), only contactable, un-previewed, un-claimed, not yet built.
const { rows } = await c.query(
  `SELECT id, business_name FROM forge_sites
   WHERE preview IS NULL AND claimed_by_user_id IS NULL AND status = 'discovered'
     AND phone IS NOT NULL AND phone <> ''
   ORDER BY NULLIF(review_count,'')::int DESC NULLS LAST, created_at ASC
   LIMIT $1`,
  [LIMIT],
);
await c.end();

if (!rows.length) {
  log("no prospects need a preview — nothing to do");
  process.exit(0);
}
log(`generating previews for ${rows.length} prospect(s)`);

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
log(`done: ${ok} generated, ${fail} failed`);
