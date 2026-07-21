/**
 * apply-sql.mjs — run a .sql migration file against Neon, in a transaction.
 *
 *   node scripts/db/apply-sql.mjs scripts/db/2026-07-20-auto-provision.sql
 *
 * Reads DATABASE_URL_UNPOOLED || DATABASE_URL from .env.local (the unpooled url is preferred for a
 * short-lived DDL script — the pooler adds a failure mode we don't need here). Purely additive
 * migrations only: this wraps the file in BEGIN/COMMIT and ROLLBACKs on any error, but it does NOT
 * guard against a destructive statement — that's on the author of the .sql file.
 *
 * After a successful apply, run `npm run db:pull` to regenerate src/db/schema.ts (DB is the source
 * of truth for schema — never hand-edit schema.ts).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");

function loadEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && out[m[1]] === undefined) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* fall through to process.env */
  }
  return out;
}

const env = loadEnv(path.join(REPO, ".env.local"));
const url =
  env.DATABASE_URL_UNPOOLED || env.DATABASE_URL ||
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!url) {
  console.error("FAILED: no DATABASE_URL(_UNPOOLED) in .env.local or environment.");
  process.exit(1);
}

const rel = process.argv[2];
if (!rel) {
  console.error("Usage: node scripts/db/apply-sql.mjs <path-to.sql>");
  process.exit(1);
}
const sqlPath = path.resolve(REPO, rel);
const sql = readFileSync(sqlPath, "utf8");

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql); // simple-query protocol: multiple ;-separated statements in one call
    await client.query("COMMIT");
    console.log(`✓ applied ${rel}`);
    console.log("Next: npm run db:pull  (regenerate src/db/schema.ts)");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`FAILED applying ${rel}:`, err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
