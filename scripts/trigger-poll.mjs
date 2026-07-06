#!/usr/bin/env node
// trigger-poll.mjs — bridges the web dashboard's "run now" buttons to the Mac (launchd).
//
// The Vercel app can't reach this machine, so its on-demand buttons drop a row in
// job_requests. This poller (every ~90s) claims pending rows and runs the matching work:
//   • find   → node scripts/lead-engine.mjs   (Apify Maps discovery)
//   • enrich → openclaw cron run <id>          (the FREE browser agent: contacts + call-prep)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const pexec = promisify(exec);
const log = (...a) => console.log(new Date().toISOString(), ...a);
function loadEnv(f) {
  const o = {};
  try {
    for (const l of readFileSync(f, "utf8").split("\n")) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) o[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch { /* */ }
  return o;
}
const ROOT = join(homedir(), "code/thinkbigjoe");
const env = loadEnv(join(ROOT, ".env.local"));
const DB = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
const ENRICH_CRON_ID = "eb7d66fe-8347-452e-bde7-53df7455f886"; // TBJ Forge Contact Enrichment

async function run(kind) {
  if (kind === "find") {
    const { stdout } = await pexec(`node scripts/lead-engine.mjs`, { cwd: ROOT, timeout: 9 * 60 * 1000, maxBuffer: 4 << 20 });
    return (stdout.trim().split("\n").pop() || "lead-engine ran").slice(0, 300);
  }
  if (kind === "enrich") {
    const { stdout } = await pexec(`openclaw cron run ${ENRICH_CRON_ID}`, { cwd: ROOT, timeout: 60 * 1000, maxBuffer: 4 << 20 });
    return (stdout.trim().split("\n").pop() || "enrichment cron triggered").slice(0, 300);
  }
  throw new Error(`unknown kind ${kind}`);
}

(async () => {
  if (!DB) { log("missing DATABASE_URL — aborting"); process.exit(1); }
  const c = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // Claim the oldest pending request atomically (skip if already claimed by a prior run).
  const claim = await c.query(
    `UPDATE job_requests SET status='running', started_at=now()
      WHERE id = (SELECT id FROM job_requests WHERE status='pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, kind`,
  );
  if (!claim.rows.length) { await c.end(); return; } // nothing queued
  const { id, kind } = claim.rows[0];
  log(`claimed job #${id} (${kind})`);

  try {
    const note = await run(kind);
    await c.query(`UPDATE job_requests SET status='done', finished_at=now(), note=$2 WHERE id=$1`, [id, note]);
    log(`job #${id} done — ${note}`);
  } catch (e) {
    const msg = (e?.message || String(e)).slice(0, 300);
    await c.query(`UPDATE job_requests SET status='error', finished_at=now(), note=$2 WHERE id=$1`, [id, msg]);
    log(`job #${id} ERROR — ${msg}`);
  }
  await c.end();
})().catch((e) => { log("ERROR", e?.message || e); process.exit(1); });
