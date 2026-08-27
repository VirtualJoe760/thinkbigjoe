/**
 * migrate-email-outbox.mjs
 * Creates email_outbox — Edward's send-approval queue. Edward (inbox agent) queues
 * sends here via email_request_send; Venus approves/rejects; approved rows are sent
 * over Zoho SMTP (immediately by the approve tool, or by the outbox drain when
 * scheduled with send_at). Shown on /command/inbox.
 * Usage: node scripts/migrate-email-outbox.mjs
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = {};
try {
  for (const line of readFileSync(resolve(__dirname, "../.env.local"), "utf-8").split("\n")) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
} catch { /* fall through to process.env */ }

const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error("No DATABASE_URL found."); process.exit(1); }

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS email_outbox (
      id            SERIAL PRIMARY KEY,
      to_addr       TEXT NOT NULL,
      cc_addr       TEXT,
      subject       TEXT NOT NULL,
      body          TEXT NOT NULL,
      in_reply_to   TEXT,                       -- Message-ID of the thread being replied to
      context       TEXT,                       -- Edward's one-line "why this should send"
      send_at       TIMESTAMPTZ,                -- null = send on approval; future = scheduled
      status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | sent | rejected | failed
      requested_by  TEXT NOT NULL DEFAULT 'edward',
      decided_by    TEXT,
      decided_at    TIMESTAMPTZ,
      decision_note TEXT,
      sent_at       TIMESTAMPTZ,
      error         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS email_outbox_status_idx ON email_outbox (status, send_at)`);
  console.log("✅ email_outbox ready");
} finally {
  client.release();
  await pool.end();
}
