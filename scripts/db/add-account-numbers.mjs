#!/usr/bin/env node
// One-time (idempotent) migration: give every ThinkBigJoe account a human-friendly
// ACCOUNT NUMBER — a plain 6-digit id (100001, 100002, …) that a customer can read
// over the phone to the voice receptionist. Distinct from a site claim code
// (TBJ-XXXX-XXXX): the claim code belongs to a built site, the account number to a person.
//
// What it does (all IF-NOT-EXISTS / NULL-guarded so re-running is safe):
//   1. sequence better_auth.account_number_seq (starts at 100001)
//   2. better_auth."user".account_number text UNIQUE, DEFAULT nextval(seq) — so EVERY
//      new signup auto-gets one (better-auth's INSERT omits it → the default fills it).
//   3. backfill existing accounts oldest-first, then setval the sequence past the max.
//
//   node scripts/db/add-account-numbers.mjs
import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const g = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};
const cs = g("DATABASE_URL_UNPOOLED") || g("DATABASE_URL");
if (!cs) { console.error("missing DATABASE_URL_UNPOOLED / DATABASE_URL in .env.local"); process.exit(1); }

const c = new pg.Client({ connectionString: cs });
await c.connect();
try {
  await c.query(`CREATE SEQUENCE IF NOT EXISTS better_auth.account_number_seq START WITH 100001`);
  await c.query(`ALTER TABLE better_auth."user" ADD COLUMN IF NOT EXISTS account_number text`);
  await c.query(`ALTER TABLE better_auth."user" ALTER COLUMN account_number SET DEFAULT nextval('better_auth.account_number_seq')::text`);

  // Backfill any account still missing one, oldest-first so account #s track signup order.
  const missing = (await c.query(`SELECT id FROM better_auth."user" WHERE account_number IS NULL ORDER BY "createdAt" ASC`)).rows;
  for (const r of missing) {
    await c.query(`UPDATE better_auth."user" SET account_number = nextval('better_auth.account_number_seq')::text WHERE id = $1`, [r.id]);
  }

  // Unique index (partial isn't needed — every row has one now).
  await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS user_account_number_key ON better_auth."user" (account_number)`);

  const rows = (await c.query(`SELECT account_number, email FROM better_auth."user" ORDER BY account_number::bigint`)).rows;
  console.log(`✓ account numbers assigned (${rows.length} account(s)):`);
  for (const r of rows) console.log(`  #${r.account_number}  ${r.email}`);
  console.log(`✓ new signups auto-assign the next number via the column default.`);
} finally {
  await c.end();
}
