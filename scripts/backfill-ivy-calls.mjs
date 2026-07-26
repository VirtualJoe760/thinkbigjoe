#!/usr/bin/env node
// backfill-ivy-calls.mjs — one-time import of Ivy's historical calls from Retell into the `calls`
// table (site 1395, TBJ internal). Until 2026-07-25 Ivy's agent had NO webhook_url, so her calls
// were never persisted — the admin read them live from Retell and they aged out of review.
// Recordings for old calls are long expired (~10-min links), so this is transcript/summary-only;
// new calls get audio via the webhook's Blob re-hosting.
//
//   node scripts/backfill-ivy-calls.mjs [limit]     (default 100)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const env = {};
for (const line of readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const IVY_AGENT = "agent_fc091c7bd9f23c9760ed6fa559";
const SITE_ID = 1395; // TBJ internal
const LIMIT = Math.min(1000, Number(process.argv[2]) || 100);

const res = await fetch("https://api.retellai.com/v2/list-calls", {
  method: "POST",
  headers: { Authorization: `Bearer ${env.RETELL_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ filter_criteria: { agent_id: [IVY_AGENT] }, limit: LIMIT, sort_order: "descending" }),
});
if (!res.ok) {
  console.error("list-calls failed:", res.status, (await res.text()).slice(0, 200));
  process.exit(1);
}
const data = await res.json();
const list = Array.isArray(data) ? data : (data.calls ?? []);
console.log(`Fetched ${list.length} Retell calls for Ivy.`);

const client = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
let inserted = 0;
try {
  for (const c of list) {
    if (!c.call_id) continue;
    const a = c.call_analysis ?? {};
    const r = await client.query(
      `INSERT INTO calls (site_id, retell_call_id, from_number, to_number, started_at, ended_at,
                          duration_sec, transcript, summary, recording_url, disposition)
       VALUES ($1,$2,$3,$4, to_timestamp($5/1000.0), to_timestamp($6/1000.0), $7,$8,$9,$10,$11)
       ON CONFLICT (retell_call_id) DO NOTHING`,
      [
        SITE_ID,
        c.call_id,
        c.from_number || null,
        c.to_number || null,
        typeof c.start_timestamp === "number" ? c.start_timestamp : null,
        typeof c.end_timestamp === "number" ? c.end_timestamp : null,
        typeof c.duration_ms === "number" ? Math.round(c.duration_ms / 1000) : null,
        typeof c.transcript === "string" && c.transcript.trim() ? c.transcript : null,
        a.call_summary || null,
        null, // recordings expired — webhook hosts audio for new calls
        a.in_voicemail === true ? "voicemail" : null,
      ],
    );
    inserted += r.rowCount;
  }
  console.log(`Inserted ${inserted} new rows into calls (site ${SITE_ID}); ${list.length - inserted} already present.`);
} finally {
  await client.end();
}
