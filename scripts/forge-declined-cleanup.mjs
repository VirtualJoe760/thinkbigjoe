#!/usr/bin/env node
/**
 * Declined-lead site teardown. When a lead is marked Declined (said "not interested" or replied
 * STOP) and never claims, we keep them as a DECLINED CONTACT — so we never accidentally re-outreach
 * them — but tear down the free website we built for them after a few days (default 3). This:
 *   1. Deletes the deployed Vercel project (tbj-<slug>.vercel.app).
 *   2. Marks the record site_deleted_at + clears live_url so the /s/<slug> preview 404s too.
 *   3. LEAVES the contact in place (lead_stage='declined') so it stays suppressed from outreach.
 *
 * Runs on Joe's Mac via launchd (it needs the local Vercel token, which the app env doesn't have).
 * Flags: --dry (report only, no deletes) · --days=N (override the grace window).
 *
 * Usage: node scripts/forge-declined-cleanup.mjs [--dry] [--days=3]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

function loadEnv(...files) {
  const env = {};
  for (const f of files) {
    try {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch { /* file may not exist */ }
  }
  return env;
}
const env = loadEnv(path.join(REPO, "env.local"), path.join(process.env.HOME || "", "code/nanocrew/.env.local"));

const DRY = process.argv.includes("--dry");
const daysArg = process.argv.find((a) => a.startsWith("--days="));
const DAYS = Math.max(1, Number(daysArg?.split("=")[1] || env.DECLINED_KEEP_DAYS || 3));
const DB = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
const VERCEL_TOKEN = env.VERCEL_TOKEN || env.VERCEL_API_TOKEN;
if (!DB) { console.error("No DATABASE_URL."); process.exit(1); }
if (!VERCEL_TOKEN && !DRY) { console.error("No VERCEL_TOKEN — can't delete projects."); process.exit(1); }
const sql = neon(DB);

/** Project name = the subdomain of the tbj-*.vercel.app live URL. */
function projectFromLiveUrl(liveUrl) {
  const m = String(liveUrl || "").match(/https?:\/\/([^./]+)\.vercel\.app/i);
  return m ? m[1] : null;
}

async function deleteVercelProject(name) {
  const r = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
  });
  if (r.ok || r.status === 404) return { ok: true, gone: r.status === 404 };
  const body = await r.text().catch(() => "");
  return { ok: false, error: `HTTP ${r.status} ${body.slice(0, 120)}` };
}

const eligible = await sql`
  SELECT id, business_name, slug, live_url
  FROM forge_sites
  WHERE (lead_stage = 'declined' OR outreach_status = 'opted_out')
    AND claimed_by_user_id IS NULL
    AND status <> 'deleted'
    AND site_deleted_at IS NULL
    AND live_url IS NOT NULL AND live_url <> ''
    AND COALESCE(declined_at, updated_at) < now() - (${String(DAYS)} || ' days')::interval
  ORDER BY COALESCE(declined_at, updated_at) ASC`;

console.log(`[declined-cleanup] ${DRY ? "DRY — " : ""}${eligible.length} declined site(s) past ${DAYS} days to tear down.`);
let torn = 0;
for (const s of eligible) {
  const project = projectFromLiveUrl(s.live_url);
  console.log(`  #${s.id} ${s.business_name} → project ${project || "(unknown)"}`);
  if (DRY) continue;

  if (project) {
    const del = await deleteVercelProject(project);
    if (!del.ok) { console.error(`    ✗ Vercel delete failed: ${del.error}`); continue; }
    console.log(`    ✓ Vercel project ${del.gone ? "already gone" : "deleted"}`);
  }
  // Keep the contact as declined; just retire the site.
  await sql`UPDATE forge_sites SET site_deleted_at = now(), live_url = NULL, updated_at = now() WHERE id = ${s.id}`;
  await sql`INSERT INTO activity_log (actor, event_type, summary, metadata)
    VALUES ('cron', 'declined_site_deleted', ${`🗑️ Tore down ${s.business_name}'s site (declined ${DAYS}+ days, unclaimed) — kept as a declined contact`},
            ${JSON.stringify({ detail: { siteId: s.id, note: "Site deleted after decline; contact kept, suppressed from outreach." } })}::jsonb)`;
  torn++;
}
console.log(`[declined-cleanup] done — ${DRY ? 0 : torn} site(s) torn down, contacts kept as declined.`);
