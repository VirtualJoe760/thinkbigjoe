#!/usr/bin/env node
// trigger-poll.mjs — bridges the web dashboard's "run now" buttons to the Mac (launchd).
//
// The Vercel app can't reach this machine, so its on-demand buttons drop a row in
// job_requests. This poller (every ~90s) claims pending rows and runs the matching work:
//   • find            → node scripts/lead-engine.mjs   (Apify Maps discovery)
//   • enrich          → openclaw cron run <id>          (the FREE browser agent: contacts + call-prep)
//   • design_template → forge-template.sh <next-unbuilt-language>  (the forge template designer)
//   • fix_template    → forge-template.sh <dir>   (rebuild an existing template from its brief; note=dir)
import { readFileSync, openSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { exec, spawn } from "node:child_process";
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

async function run(kind, target) {
  if (kind === "find") {
    const { stdout } = await pexec(`node scripts/lead-engine.mjs`, { cwd: ROOT, timeout: 9 * 60 * 1000, maxBuffer: 4 << 20 });
    return (stdout.trim().split("\n").pop() || "lead-engine ran").slice(0, 300);
  }
  if (kind === "enrich") {
    const { stdout } = await pexec(`openclaw cron run ${ENRICH_CRON_ID}`, { cwd: ROOT, timeout: 60 * 1000, maxBuffer: 4 << 20 });
    return (stdout.trim().split("\n").pop() || "enrichment cron triggered").slice(0, 300);
  }
  if (kind === "design_template") {
    // brand-lead authors design languages into the forge's design-languages.json; this builds the
    // next one that hasn't been made into a template yet. The forge designer is a long (~30 min)
    // --max-turns 160 run, so we SPAWN IT DETACHED and return immediately (its own forge lock
    // guarantees one designer/build at a time). The new template registers enabled:false for review.
    const FORGE = join(homedir(), "code/webdev-templates");
    let langs = [], registry = [];
    try { langs = JSON.parse(readFileSync(join(FORGE, "factory/design-languages.json"), "utf8")).languages || []; } catch { /* */ }
    try { registry = JSON.parse(readFileSync(join(FORGE, "templates/registry.json"), "utf8")).templates || []; } catch { /* */ }
    const built = new Set(registry.map((t) => t.id));
    const next = langs.find((l) => l && l.id && !built.has(l.id));
    if (!next) return "No unbuilt design languages queued — brand-lead adds them to design-languages.json.";
    const logf = `/tmp/forge-template-${next.id}.log`;
    const out = openSync(logf, "a");
    const child = spawn("bash", ["factory/forge-template.sh", next.id], {
      cwd: FORGE, detached: true, stdio: ["ignore", out, out],
    });
    child.unref();
    return `Template designer started for "${next.name || next.id}" (${next.id}) — runs in the background (~30 min); review the preview when it registers. log: ${logf}`;
  }
  if (kind === "fix_template") {
    // Re-prompt the forge to rebuild an EXISTING template from its DESIGN-BRIEF.md. `target` is
    // the template dir (job_requests.note). Same detached, one-at-a-time designer run.
    const FORGE = join(homedir(), "code/webdev-templates");
    const dir = String(target || "").trim();
    if (!dir || !existsSync(join(FORGE, "templates", dir))) return `fix_template: no such template dir "${dir}"`;
    const logf = `/tmp/forge-template-${dir}.log`;
    const out = openSync(logf, "a");
    const child = spawn("bash", ["factory/forge-template.sh", dir], {
      cwd: FORGE, detached: true, stdio: ["ignore", out, out],
    });
    child.unref();
    return `Rebuild started for template "${dir}" — runs in the background (~30 min); review when it re-registers. log: ${logf}`;
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
      RETURNING id, kind, note`,
  );
  if (!claim.rows.length) { await c.end(); return; } // nothing queued
  const { id, kind, note: target } = claim.rows[0];
  log(`claimed job #${id} (${kind}${target ? ` → ${target}` : ""})`);

  try {
    const note = await run(kind, target);
    await c.query(`UPDATE job_requests SET status='done', finished_at=now(), note=$2 WHERE id=$1`, [id, note]);
    log(`job #${id} done — ${note}`);
  } catch (e) {
    const msg = (e?.message || String(e)).slice(0, 300);
    await c.query(`UPDATE job_requests SET status='error', finished_at=now(), note=$2 WHERE id=$1`, [id, msg]);
    log(`job #${id} ERROR — ${msg}`);
  }
  await c.end();
})().catch((e) => { log("ERROR", e?.message || e); process.exit(1); });
