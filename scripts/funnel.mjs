#!/usr/bin/env node
/**
 * Read-only snapshot of the acquisition funnel: discovered → preview → LEAD
 * (marketing_approved_at) → outreach (email / voicemail / sms) → claimed.
 *
 * Run:  node scripts/funnel.mjs
 *
 * Exists because the approval gate is the usual bottleneck and there's no psql on
 * this machine — this is the one command that tells you where leads are stuck.
 * Writes nothing. See .claude/skills/lead-pipeline/SKILL.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import pg from "pg";

function loadEnv(f) {
  const o = {};
  try {
    for (const l of readFileSync(f, "utf8").split("\n")) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) o[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {
    /* */
  }
  return o;
}

const env = loadEnv(join(homedir(), "code/thinkbigjoe/.env.local"));
const DATABASE_URL = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("funnel: missing DATABASE_URL in thinkbigjoe/.env.local");
  process.exit(1);
}

// Strip `sslmode` from the URL and set ssl explicitly — pg warns loudly about its
// deprecated sslmode aliases otherwise (same fix as src/lib/auth.ts).
function connString(raw) {
  try {
    const u = new URL(raw);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return raw;
  }
}

const pool = new pg.Pool({
  connectionString: connString(DATABASE_URL),
  ssl: { rejectUnauthorized: false },
  max: 2,
});

const rows = async (sql) => (await pool.query(sql)).rows;

try {
  const [f] = await rows(`
    SELECT
      count(*) FILTER (WHERE status = 'discovered')                                AS discovered,
      count(*) FILTER (WHERE preview IS NOT NULL)                                  AS has_preview,
      count(*) FILTER (WHERE preview IS NOT NULL
                         AND marketing_approved_at IS NULL
                         AND status NOT IN ('denied','deleted'))                   AS awaiting_approval,
      count(*) FILTER (WHERE marketing_approved_at IS NOT NULL)                    AS leads,
      count(*) FILTER (WHERE claimed_by_user_id IS NOT NULL)                       AS claimed
    FROM forge_sites`);

  const [r] = await rows(`
    SELECT
      count(*) FILTER (WHERE email IS NOT NULL)                                    AS emailable,
      count(*) FILTER (WHERE phone IS NOT NULL)                                    AS phone_reachable,
      count(*) FILTER (WHERE email IS NULL AND phone IS NULL)                      AS no_contact
    FROM forge_sites
    WHERE marketing_approved_at IS NOT NULL
      AND claimed_by_user_id IS NULL
      AND coalesce(outreach_status, 'none') IN ('none', '')`);

  const engines = await rows(`
    SELECT 'outreach daily_goal'  AS setting, daily_goal::text        AS value, enabled FROM outreach_engine WHERE id = 1
    UNION ALL
    SELECT 'preview daily_budget', daily_budget::text,                  enabled FROM preview_engine  WHERE id = 1
    UNION ALL
    SELECT 'lead monthly_budget_usd', monthly_budget_usd::text,         enabled FROM lead_engine     WHERE id = 1`);

  const today = await rows(`
    SELECT event_type, count(*)::int AS n
    FROM activity_log
    WHERE created_at > now() - interval '24 hours'
      AND event_type IN ('forge_marketing_approved','forge_outreach_sent','sms_outreach_sent','voicemail_dropped')
    GROUP BY 1 ORDER BY 1`);

  console.log("\nFUNNEL");
  console.table([f]);
  console.log("UNTOUCHED LEADS — reachable by channel");
  console.table([r]);
  console.log("ENGINES");
  console.table(engines);
  console.log("LAST 24H");
  console.table(today.length ? today : [{ event_type: "(nothing)", n: 0 }]);

  if (Number(f.awaiting_approval) > 0) {
    console.log(`→ ${f.awaiting_approval} previews are waiting on the human approval gate (/command/prospects → Review).`);
  }
} finally {
  await pool.end();
}
