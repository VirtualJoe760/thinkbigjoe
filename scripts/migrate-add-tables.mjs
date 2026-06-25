/**
 * migrate-add-tables.mjs
 * Creates activity_log and follow_ups tables in Neon.
 * Usage: node scripts/migrate-add-tables.mjs
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../env.local");

const env = {};
try {
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
} catch {
  // fall through to process.env
}

const url =
  env.DATABASE_URL_UNPOOLED ||
  env.DATABASE_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL;

if (!url) {
  console.error("No DATABASE_URL found in env.local or environment.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id           SERIAL PRIMARY KEY,
        actor        VARCHAR NOT NULL DEFAULT 'venus',
        event_type   VARCHAR NOT NULL,
        summary      TEXT    NOT NULL,
        metadata     JSONB,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS activity_log_created_at_idx
        ON activity_log (created_at DESC);
    `);
    console.log("✓ activity_log");

    await client.query(`
      CREATE TABLE IF NOT EXISTS follow_ups (
        id             SERIAL PRIMARY KEY,
        prospect_id    INTEGER NOT NULL REFERENCES prospects(id),
        touch_number   INTEGER NOT NULL DEFAULT 1,
        scheduled_for  TIMESTAMPTZ NOT NULL,
        status         VARCHAR NOT NULL DEFAULT 'pending',
        body           TEXT,
        sent_at        TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS follow_ups_scheduled_for_idx
        ON follow_ups (scheduled_for ASC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS follow_ups_prospect_id_idx
        ON follow_ups (prospect_id);
    `);
    console.log("✓ follow_ups");

    await client.query("COMMIT");
    console.log("\nMigration complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
