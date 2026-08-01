#!/usr/bin/env node
// sync-openclaw-agents.mjs — mirror the LIVE OpenClaw roster (~/.openclaw/openclaw.json) into the
// `agents` table, under the TBJ organization. The DB copy is what the portal/command agent
// dashboards render; OpenClaw stays the runtime source of truth. Rows that vanish from the live
// roster are ARCHIVED (never deleted) so their activity history stays joinable.
//
//   node scripts/sync-openclaw-agents.mjs
//
// Run on the Mac (needs ~/.openclaw). Re-run any time the roster or models change.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

function loadEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && out[m[1]] === undefined) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* fall through */
  }
  return out;
}

// Human-readable role lines for the dashboard — the personality files are the real definition.
const ROLES = {
  main: "Venus — master orchestrator",
  prospector: "Finds local businesses that need a website",
  outreach: "Starts conversations + books demos (email drafts, autonomous SMS)",
  "marketing-manager": "Runs the marketing team, digests activity for Joe",
  researcher: "Deep research on prospects + markets",
  "brand-lead": "Design research + brand direction for the forge",
  whitney: "Finds jobs for Joe + applies once he approves (creates accounts, verifies by email, tailors)",
};

const env = loadEnv(path.join(REPO, ".env.local"));
const DB = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || process.env.DATABASE_URL;
if (!DB) {
  console.error("No DATABASE_URL in .env.local");
  process.exit(1);
}

const cfgPath = path.join(homedir(), ".openclaw", "openclaw.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const defaults = cfg?.agents?.defaults?.model?.primary || null;
const list = cfg?.agents?.list || [];
if (!list.length) {
  console.error("No agents.list in openclaw.json");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows: orgRows } = await client.query(`SELECT id FROM organizations WHERE slug = 'thinkbigjoe' LIMIT 1`);
  if (!orgRows.length) throw new Error("TBJ organization row missing — run the organizations migration first.");
  const orgId = orgRows[0].id;

  const liveIds = [];
  for (const a of list) {
    const id = a.id || a.name;
    if (!id) continue;
    liveIds.push(id);
    const name = id === "main" ? "Venus" : a.name || id;
    const model = a.model || defaults;
    const role = ROLES[id] || "OpenClaw agent";
    await client.query(
      `INSERT INTO agents (id, name, role, org_id, model, workspace, enabled, status, archived, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, 'running', false, now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, role = EXCLUDED.role, org_id = EXCLUDED.org_id,
         model = EXCLUDED.model, workspace = EXCLUDED.workspace, archived = false, updated_at = now()`,
      [id, name, role, orgId, model, a.workspace || null],
    );
    console.log(`✓ ${id}  (${model || "default"})`);
  }

  const { rowCount } = await client.query(
    `UPDATE agents SET archived = true, enabled = false, status = 'off', updated_at = now()
     WHERE NOT (id = ANY($1)) AND archived = false`,
    [liveIds],
  );
  console.log(`\nSynced ${liveIds.length} live agents → org #${orgId}; archived ${rowCount} stale row(s).`);
} finally {
  await client.end();
}
