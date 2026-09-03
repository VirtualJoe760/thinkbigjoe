#!/usr/bin/env node
// money-desk-sync.mjs — mirrors Max + Ryan's desk from Joe's Mac into Neon.
//
// WHY THIS EXISTS: the two agents coordinate through a JSON file
// (~/.openclaw/shared/max-ryan/desk.json). That file is the source of truth ON PURPOSE — the claim
// lock, the 3-round cap and the 7-day ASAP bar are enforced inside desk.mjs, which is what makes
// "they never work the same idea at once" a guarantee instead of a hope. But /command/money runs on
// Vercel, which cannot read a file on this Mac. Same wall agent-bridge.mjs hit.
//
// So this is a ONE-WAY MIRROR: file → database. Nothing in the app writes back. If it did, the
// write would be silently clobbered on the next pass AND would desync the lock the agents depend
// on, which is a far worse failure than a stale board.
//
// It is a dumb full re-read every pass, which means it MUST be idempotent — hence dedupe_key on
// every row. Cheap: the desk is a few KB and reports are ~9KB each, read only when new.
//
//   node scripts/money-desk-sync.mjs [--once] [--verbose]
//
// launchd: com.thinkbigjoe.moneydesksync, every 5 minutes. Log: /tmp/tbj-money-desk-sync.log

import { readFileSync, existsSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const DESK_DIR = path.join(process.env.HOME || "/Users/macdaddyjoe", ".openclaw/shared/max-ryan");
const DESK = path.join(DESK_DIR, "desk.json");
const PIDFILE = "/tmp/tbj-money-desk-sync.pid";
const VERBOSE = process.argv.includes("--verbose");

const log = (...a) => console.log(new Date().toISOString(), ...a);
const vlog = (...a) => VERBOSE && log(...a);

// --- pidfile guard: a slow pass must not stack -------------------------------
if (existsSync(PIDFILE)) {
  const old = Number(readFileSync(PIDFILE, "utf8"));
  try {
    process.kill(old, 0);
    vlog("previous run still alive, bailing");
    process.exit(0);
  } catch {
    /* stale pidfile — take over */
  }
}
writeFileSync(PIDFILE, String(process.pid));
const cleanup = () => { try { unlinkSync(PIDFILE); } catch {} };
process.on("exit", cleanup);
process.on("SIGTERM", () => process.exit(0));

// --- env ---------------------------------------------------------------------
const env = {};
for (const line of readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

if (!existsSync(DESK)) {
  log(`no desk at ${DESK} — nothing to sync (are Max and Ryan set up?)`);
  process.exit(0);
}

let desk;
try {
  desk = JSON.parse(readFileSync(DESK, "utf8"));
} catch (e) {
  // desk.mjs writes atomically (tmp + rename), so this should be unreachable. If it fires,
  // something hand-edited the file — say so loudly rather than wiping the mirror.
  log(`REFUSING TO SYNC: desk.json is not valid JSON (${e.message}). Left the database untouched.`);
  process.exit(1);
}

const hash = (s) => createHash("sha1").update(String(s)).digest("hex").slice(0, 16);

const client = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  // --- 1. state (single row) -------------------------------------------------
  await client.query(
    `INSERT INTO money_desk_state (id, turn, claims, graveyard, desk_updated_at, synced_at)
     VALUES (1, $1, $2::jsonb, $3::jsonb, $4, now())
     ON CONFLICT (id) DO UPDATE SET
       turn = EXCLUDED.turn, claims = EXCLUDED.claims, graveyard = EXCLUDED.graveyard,
       desk_updated_at = EXCLUDED.desk_updated_at, synced_at = now()`,
    [desk.turn ?? null, JSON.stringify(desk.claims ?? {}), JSON.stringify(desk.graveyard ?? []), desk.updated_at ?? null],
  );

  // --- 2. the conversation ---------------------------------------------------
  // Keyed on content, not array index: the thread is append-only but indices shift when a stale
  // claim auto-releases and the desk pushes a system note.
  let newMsgs = 0;
  for (const m of desk.thread ?? []) {
    const key = `${m.at}|${m.from}|${hash(m.body)}`;
    const r = await client.query(
      `INSERT INTO money_desk_messages (at, from_agent, to_agent, kind, body, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [m.at, m.from, m.to, m.kind, m.body, key],
    );
    newMsgs += r.rowCount;
  }

  // --- 3. verdicts (+ their reports) -----------------------------------------
  // Upsert rather than insert-ignore: a conclusion is written first and only later gains its
  // report_path when the agent calls `desk.mjs reported`.
  let newVerdicts = 0;
  let reportsPulled = 0;
  for (const c of desk.conclusions ?? []) {
    const key = `${c.at}|${hash(c.topic)}`;

    // Pull the report HTML only when we don't already have it — these are ~9KB each.
    let html = null;
    if (c.report_path) {
      const p = c.report_path.replace(/^~/, process.env.HOME || "/Users/macdaddyjoe");
      if (existsSync(p)) {
        const { rows } = await client.query(
          `SELECT report_html IS NOT NULL AS has_html FROM money_desk_verdicts WHERE dedupe_key = $1`,
          [key],
        );
        if (!rows[0]?.has_html) {
          html = readFileSync(p, "utf8");
          reportsPulled++;
          vlog(`pulled report ${path.basename(p)} (${(statSync(p).size / 1024).toFixed(1)}kb)`);
        }
      } else {
        log(`⚠ verdict "${c.topic}" points at a missing report: ${p}`);
      }
    }

    const r = await client.query(
      `INSERT INTO money_desk_verdicts
         (topic, owner, verdict, what_to_do, how, practicality, time_to_first_dollar_days,
          cost_to_start_usd, who_pays, evidence, dissent, override_reason, decided_at,
          reported_to_venus, report_path, report_html, dedupe_key)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (dedupe_key) DO UPDATE SET
         verdict = EXCLUDED.verdict,
         dissent = EXCLUDED.dissent,
         reported_to_venus = EXCLUDED.reported_to_venus,
         report_path = EXCLUDED.report_path,
         -- never null out HTML we already pulled
         report_html = COALESCE(EXCLUDED.report_html, money_desk_verdicts.report_html)`,
      [
        c.topic, c.owner ?? "?", c.verdict, c.what_to_do ?? null,
        JSON.stringify(c.how ?? []), c.practicality ?? null,
        c.time_to_first_dollar_days ?? null, c.cost_to_start_usd ?? null,
        c.who_pays ?? null, JSON.stringify(c.evidence ?? []),
        c.dissent ?? null, c.override_reason ?? null, c.at,
        Boolean(c.reported_to_venus), c.report_path ?? null, html, key,
      ],
    );
    newVerdicts += r.rowCount;
  }

  log(`synced — ${desk.thread?.length ?? 0} msgs (${newMsgs} new), ${desk.conclusions?.length ?? 0} verdicts (${newVerdicts} written, ${reportsPulled} reports pulled)`);
} catch (e) {
  log(`sync failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
