#!/usr/bin/env node
// ---------------------------------------------------------------------------
// drop-legacy-tables — one-off migration that drops orphaned tables left over
// from two completed migrations:
//   • Payload CMS → Drizzle + better-auth  (payload_*, media, pages, users,
//     users_sessions — the app reads better_auth."user", not these)
//   • cowork jobs → Venus/OpenClaw         (cowork_jobs)
//
// All confirmed orphaned (no app-code references) and near-empty (≤7 rows of
// migration cruft). Verified: no live table has a FK into any of them, so
// CASCADE only drops the tables + their own constraints, never live rows.
//
// Run:  DATABASE_URL=... node scripts/drop-legacy-tables.mjs
// Then: npm run db:pull   (regenerates a clean src/db/schema.ts)
// ---------------------------------------------------------------------------
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("✗ DATABASE_URL not set");
  process.exit(1);
}

const TABLES = [
  "cowork_jobs",
  "payload_locked_documents_rels",
  "payload_locked_documents",
  "payload_preferences_rels",
  "payload_preferences",
  "payload_kv",
  "payload_migrations",
  "media",
  "pages",
  "users_sessions",
  "users",
];

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
try {
  for (const t of TABLES) {
    await pool.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    console.log(`✓ dropped ${t}`);
  }
  console.log("\nDone. Run `npm run db:pull` to regenerate schema.ts.");
} catch (err) {
  console.error("✗ migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
