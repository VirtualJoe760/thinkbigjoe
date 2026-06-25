#!/usr/bin/env node
/**
 * Adds the conversations table — full message threads per prospect (both
 * inbound replies from them and outbound messages from Joe/Venus).
 * Also stores the outbound messages Venus sends so the AI can use full
 * context when drafting the next reply.
 */
import { readFileSync } from "fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(new URL("../env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => l.split(/=(.*)/).slice(0, 2)),
);

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL_UNPOOLED,
  ssl: { rejectUnauthorized: false },
});

const client = await pool.connect();
try {
  await client.query("BEGIN");

  await client.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          SERIAL PRIMARY KEY,
      prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      direction   VARCHAR(8) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      body        TEXT NOT NULL,
      platform    VARCHAR(32) NOT NULL DEFAULT 'linkedin',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS conversations_prospect_id_idx
      ON conversations (prospect_id);
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS conversations_created_at_idx
      ON conversations (created_at);
  `);

  await client.query("COMMIT");
  console.log("✅ conversations table created");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("❌ migration failed:", err.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
