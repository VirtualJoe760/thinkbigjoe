#!/usr/bin/env node
// agent-bridge.mjs — the Mac-side bridge between the web dashboard and the OpenClaw gateway.
//
// The app (Vercel) can't reach 127.0.0.1:18789, so dashboard chat queues rows in agent_messages;
// this poller (launchd: com.thinkbigjoe.agentbridge, every minute) delivers each queued message
// with `openclaw agent --agent <id> -m <text> --json` and writes the reply back as a from_agent
// row. One message at a time, oldest first — agent turns can take a while, so the launchd job
// overlapping itself is guarded by a pidfile.
//
//   node scripts/agent-bridge.mjs [--once]
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const PIDFILE = "/tmp/tbj-agent-bridge.pid";
const OPENCLAW = "/usr/local/bin/openclaw";
const TURN_TIMEOUT_MS = 5 * 60 * 1000; // an agent turn can legitimately think for a while

const env = {};
for (const line of readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

// Pidfile guard — a stuck prior run must not stack turns.
if (existsSync(PIDFILE)) {
  const old = Number(readFileSync(PIDFILE, "utf8"));
  try {
    process.kill(old, 0); // still alive → bail
    process.exit(0);
  } catch {
    /* stale pidfile — take over */
  }
}
writeFileSync(PIDFILE, String(process.pid));

function runAgent(agentId, message) {
  return new Promise((resolve) => {
    execFile(
      OPENCLAW,
      ["agent", "--agent", agentId, "-m", message, "--json"],
      { timeout: TURN_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return resolve({ ok: false, text: `bridge error: ${err.message}` });
        try {
          const j = JSON.parse(stdout);
          // Verified shape (2026-07-25): { status:"ok", result:{ payloads:[{text}] } }.
          const payloads = j?.result?.payloads ?? j?.payloads ?? [];
          const text =
            payloads.map((p) => p?.text).filter(Boolean).join("\n\n") ||
            j?.reply || j?.text || j?.message || null;
          resolve({ ok: j?.status === "ok" || Boolean(text), text: text || "(agent returned no text)" });
        } catch {
          resolve({ ok: Boolean(stdout.trim()), text: stdout.trim().slice(0, 8000) || "(no output)" });
        }
      },
    );
  });
}

const client = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows } = await client.query(
    `SELECT id, agent_id, body FROM agent_messages
     WHERE direction = 'to_agent' AND status = 'queued'
     ORDER BY created_at ASC LIMIT 5`,
  );
  for (const msg of rows) {
    console.log(`→ ${msg.agent_id}: ${msg.body.slice(0, 60)}`);
    const res = await runAgent(msg.agent_id, msg.body);
    await client.query(
      `INSERT INTO agent_messages (agent_id, direction, body, status, reply_to)
       VALUES ($1, 'from_agent', $2, 'received', $3)`,
      [msg.agent_id, res.text, msg.id],
    );
    await client.query(`UPDATE agent_messages SET status = $2, updated_at = now() WHERE id = $1`, [
      msg.id,
      res.ok ? "answered" : "failed",
    ]);
    console.log(`← ${msg.agent_id}: ${res.ok ? "answered" : "FAILED"} (${res.text.length} chars)`);
  }
  if (!rows.length) console.log("no queued messages");
} finally {
  await client.end();
  try { unlinkSync(PIDFILE); } catch { /* ignore */ }
}
