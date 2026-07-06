#!/usr/bin/env node
// lead-engine.mjs — budget + goal-aware lead generator (scheduled via launchd).
//
// Keeps the forge_sites queue flowing toward the monthly LEAD GOAL, spending up to
// the monthly APIFY BUDGET. When Apify is unavailable (budget or free credit out) it
// no-ops gracefully — the agent's browser-scraping crons cover the rest of the goal.
// Config + progress live in the `lead_engine` table; the UI reads them.
//
// Run on a schedule, e.g. every 3h:
//   0 */3 * * *  cd ~/code/thinkbigjoe && node scripts/lead-engine.mjs >> /tmp/lead-engine.log 2>&1
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import pg from "pg";

const log = (...a) => console.log(new Date().toISOString(), ...a);
function loadEnv(f) {
  const o = {};
  try {
    for (const l of readFileSync(f, "utf8").split("\n")) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) o[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch { /* */ }
  return o;
}
const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const env = loadEnv(join(homedir(), "code/thinkbigjoe/.env.local"));
const TOKEN = env.APIFY_API_KEY;
const DB = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;

// A big rotating pool of trade × metro combos (~35×35 = 1225) — cycled via combo_offset
// so runs don't re-scrape the same searches (which would cost credit for 0 new leads).
const TRADES = ["plumber", "roofer", "electrician", "landscaper", "hvac contractor", "handyman", "pest control", "garage door repair", "concrete contractor", "fence contractor", "tree service", "pool service", "painter", "appliance repair", "locksmith", "cleaning service", "movers", "drywall contractor", "pressure washing", "window cleaning", "gutter cleaning", "junk removal", "carpet cleaning", "chimney sweep", "septic service", "deck builder", "auto detailing", "mobile mechanic", "welding service", "window tinting", "masonry contractor", "paving contractor", "irrigation repair", "flooring contractor", "epoxy flooring"];
const METROS = ["Denver, CO", "Dallas, TX", "Atlanta, GA", "Charlotte, NC", "Columbus, OH", "Nashville, TN", "Tampa, FL", "Kansas City, MO", "Indianapolis, IN", "San Antonio, TX", "Portland, OR", "Las Vegas, NV", "Sacramento, CA", "Boise, ID", "Salt Lake City, UT", "Pittsburgh, PA", "Tucson, AZ", "Fresno, CA", "Jacksonville, FL", "Oklahoma City, OK", "Raleigh, NC", "Minneapolis, MN", "Cincinnati, OH", "Louisville, KY", "Richmond, VA", "Grand Rapids, MI", "Omaha, NE", "Memphis, TN", "Birmingham, AL", "Houston, TX", "San Diego, CA", "Phoenix, AZ", "Austin, TX", "Miami, FL", "Seattle, WA"];
const COMBOS = TRADES.flatMap((t) => METROS.map((m) => [t, m]));

async function apifyUsage() {
  try {
    const j = await (await fetch(`https://api.apify.com/v2/users/me/limits?token=${TOKEN}`)).json();
    return j?.data?.current?.monthlyUsageUsd ?? null;
  } catch {
    return null;
  }
}
async function maps(q, loc, max = 40) {
  const r = await fetch(`https://api.apify.com/v2/acts/compass~crawler-google-places/run-sync-get-dataset-items?token=${TOKEN}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ searchStringsArray: [q], locationQuery: loc, maxCrawledPlacesPerSearch: max, language: "en", skipClosedPlaces: true }),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) return { error: `${r.status}` };
  return { items: await r.json() };
}

(async () => {
  if (!TOKEN || !DB) { log("missing APIFY_API_KEY or DATABASE_URL — aborting"); process.exit(1); }
  const c = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const cfg = (await c.query("SELECT * FROM lead_engine WHERE id=1")).rows[0];
  if (!cfg || !cfg.enabled) { log("lead engine disabled — nothing to do"); await c.end(); return; }
  const goal = cfg.monthly_lead_goal;
  const budget = Number(cfg.monthly_budget_usd);

  const now = new Date();
  const ym = now.toISOString().slice(0, 7);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const dailyTarget = Math.ceil(goal / daysInMonth);

  const leadsMonth = Number((await c.query("SELECT count(*) n FROM forge_sites WHERE created_at >= $1", [monthStart])).rows[0].n);
  const leadsToday = Number((await c.query("SELECT count(*) n FROM forge_sites WHERE created_at >= $1", [dayStart])).rows[0].n);
  const spend = await apifyUsage();
  log(`month ${leadsMonth}/${goal} · today ${leadsToday}/${dailyTarget} · Apify spend $${spend} / $${budget}`);

  const finish = async (summary) => {
    await c.query("UPDATE lead_engine SET spend_month=$1, spend_usd=$2, last_run_at=now(), last_run_summary=$3, updated_at=now() WHERE id=1", [ym, spend ?? cfg.spend_usd ?? 0, summary]);
    await c.query("INSERT INTO activity_log (actor,event_type,summary,metadata) VALUES ('lead_engine','lead_engine_run',$1,$2::jsonb)", [summary, JSON.stringify({ auto: true, leadsMonth, goal, spend })]);
    log(summary);
    await c.end();
  };

  if (leadsMonth >= goal) return finish(`Monthly goal met — ${leadsMonth}/${goal} leads. Resting until next month.`);
  if (spend != null && spend >= budget) return finish(`Apify budget spent ($${spend.toFixed(2)}/$${budget}); browser scraping covers the rest of the goal.`);
  if (leadsToday >= dailyTarget) return finish(`Today's pace met — ${leadsToday}/${dailyTarget} leads. Waiting for tomorrow.`);

  // Scrape toward today's target within budget.
  const existing = new Set((await c.query("SELECT slug FROM forge_sites")).rows.map((r) => r.slug));
  const black = new Set((await c.query("SELECT norm_key FROM forge_blacklist")).rows.map((r) => r.norm_key));
  let offset = cfg.combo_offset || 0, queued = 0, searches = 0, note = "";

  while (leadsToday + queued < dailyTarget && searches < 12) {
    const s = await apifyUsage();
    if (s != null && s >= budget) { note = "budget reached mid-run"; break; }
    const [q, loc] = COMBOS[offset % COMBOS.length];
    offset++;
    const { items, error } = await maps(q, loc, 40);
    if (error) { note = `Apify error ${error} — credit/budget exhausted; browser scraping takes over`; break; }
    for (const b of items || []) {
      if (b.website) continue;
      const sl = slug(b.title);
      if (!sl || existing.has(sl)) continue;
      if (black.has(`${sl}|${slug(b.city || "")}`)) continue;
      const mu = b.url || (b.placeId ? `https://www.google.com/maps/place/?q=place_id:${b.placeId}` : null);
      try {
        await c.query(
          `INSERT INTO forge_sites (slug,business_name,niche,city,service_area,phone,google_rating,review_count,google_maps_url,fit_reason,source,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'lead_engine','discovered') ON CONFLICT (slug) DO NOTHING`,
          [sl, b.title, b.categoryName || q, b.city || null, [b.city, b.state].filter(Boolean).join(", ") || null, b.phone || null, b.totalScore ? String(b.totalScore) : null, b.reviewsCount != null ? String(b.reviewsCount) : null, mu, `No website — ${b.categoryName || q}${b.reviewsCount ? `, ${b.reviewsCount} reviews` : ""}`],
        );
        existing.add(sl);
        queued++;
      } catch { /* dup/err — skip */ }
    }
    searches++;
  }

  const finalSpend = (await apifyUsage()) ?? spend ?? 0;
  const summary = `+${queued} leads from ${searches} Apify searches · month ${leadsMonth + queued}/${goal} · today ${leadsToday + queued}/${dailyTarget} · spend $${Number(finalSpend).toFixed(2)}/$${budget}${note ? ` · ${note}` : ""}`;
  await c.query("UPDATE lead_engine SET combo_offset=$1, spend_month=$2, spend_usd=$3, last_run_at=now(), last_run_summary=$4, updated_at=now() WHERE id=1", [offset, ym, finalSpend, summary]);
  await c.query("INSERT INTO activity_log (actor,event_type,summary,metadata) VALUES ('lead_engine','lead_engine_run',$1,$2::jsonb)", [summary, JSON.stringify({ auto: true, queued, searches, spend: finalSpend })]);
  log(summary);
  await c.end();
})().catch((e) => { log("ERROR", e?.message || e); process.exit(1); });
