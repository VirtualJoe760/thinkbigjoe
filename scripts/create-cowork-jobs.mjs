// One-off: create the cowork_jobs table in Neon.
// Run: node scripts/create-cowork-jobs.mjs
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const pick = (k) => {
  const m = env.match(new RegExp(`^${k}="?([^"\\n]+)"?`, "m"));
  return m ? m[1] : "";
};
const conn = pick("DATABASE_URL") || pick("DATABASE_POSTGRES_URL") || pick("DATABASE_URL_UNPOOLED");
if (!conn) throw new Error("No DATABASE_URL in .env.local");

const sql = neon(conn);

await sql`
  CREATE TABLE IF NOT EXISTS cowork_jobs (
    id            serial PRIMARY KEY,
    source        varchar DEFAULT 'telegram' NOT NULL,
    raw_command   varchar NOT NULL,
    intent        varchar DEFAULT 'unknown' NOT NULL,
    vertical      varchar,
    location      varchar,
    target_count  integer,
    status        varchar DEFAULT 'queued' NOT NULL,
    result_summary varchar,
    created_at    timestamptz(3) DEFAULT now() NOT NULL,
    updated_at    timestamptz(3) DEFAULT now() NOT NULL
  )
`;
await sql`CREATE INDEX IF NOT EXISTS cowork_jobs_status_idx ON cowork_jobs (status)`;
await sql`CREATE INDEX IF NOT EXISTS cowork_jobs_created_at_idx ON cowork_jobs (created_at)`;

const rows = await sql`SELECT count(*)::int AS n FROM cowork_jobs`;
console.log("cowork_jobs ready. rows:", rows[0].n);
