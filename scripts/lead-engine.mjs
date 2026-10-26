#!/usr/bin/env node
// lead-engine.mjs — budget + goal-aware lead generator (scheduled via launchd).
//
// Keeps the forge_sites queue flowing toward the monthly LEAD GOAL, spending up to
// the monthly APIFY BUDGET. When Apify is unavailable (budget or free credit out) it
// no-ops gracefully — the agent's browser-scraping crons cover the rest of the goal.
// Config + progress live in the `lead_engine` table; the UI reads them.
//
// Scheduled by com.thinkbigjoe.leadengine at 3:00 / 4:00 / 5:00am — inside the 2:30–6am
// NIGHT WINDOW, because this is the biggest Apify spender and no paid scraping should run
// during Joe's working day. Only 3 runs a night (it used to run every 3h, 8×/day), so
// MAX_SEARCHES is sized for one run to reach the whole daily target on its own; the later
// runs are catch-up if the first came up short. Budget checks still gate every search, so
// a bigger cap cannot overspend.
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

// Per-run search ceiling. Sized so ONE run can cover the whole daily target (only 3 runs a
// night now, vs 8 spread over the day). The loop still exits the moment the target is met,
// and re-checks Apify spend against the budget before every search — this is a ceiling, not
// a quota, so raising it costs nothing on a normal night.
const MAX_SEARCHES = Math.max(1, parseInt(process.argv[2] || "24", 10) || 24);

// TARGET MARKET (2026-10-26): the Coachella Valley only, building/renovation trades only.
// Joe's call — the nationwide sweep (35 trades × 35 metros) produced ~4,300 leads and zero
// paying customers; that pool was archived to schema archive_2026_10. A local market Joe can
// actually visit beats a national list. Change TRADES / CITIES here to retarget.
// The pool is walked ONCE via combo_offset; when it's exhausted the engine stops instead of
// looping (re-scraping the same search costs credit for zero new leads). Reset
// lead_engine.combo_offset to 0 to sweep again.
// 2026-10-26 (later): GC, plumbing, HVAC, roofing, home remodel — no-website businesses only.
const TRADES = ["general contractor", "plumber", "hvac contractor", "air conditioning repair", "roofing contractor", "home remodeling contractor", "kitchen remodeler", "bathroom remodeler"];
const CITIES = ["Palm Springs, CA", "Cathedral City, CA", "Rancho Mirage, CA", "Palm Desert, CA", "Indian Wells, CA", "La Quinta, CA", "Indio, CA", "Coachella, CA", "Desert Hot Springs, CA", "Thousand Palms, CA", "Bermuda Dunes, CA", "Thermal, CA"];
// Only keep results whose address is actually in the valley — Maps happily returns
// Riverside / San Bernardino businesses for a "near Palm Springs" search.
const CV_CITY = /\b(palm springs|cathedral city|rancho mirage|palm desert|indian wells|la quinta|indio|coachella|desert hot springs|thousand palms|bermuda dunes|thermal|mecca|sky valley|north palm springs)\b/i;
// Joe wants NO-website businesses only. Apify's own `website: "withoutWebsite"` filter does
// this server-side (an add-on, ~$0.001/place) so we don't pay to scrape places we'd discard;
// the in-code check below is a backstop.
const NO_WEBSITE_ONLY = true;
const METROS = CITIES;
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
    // scrapeContacts only works for places WITH a website (it crawls the site), so it's off when
    // we only want no-website places — it would be paid for and return nothing.
    body: JSON.stringify({ searchStringsArray: [q], locationQuery: loc, maxCrawledPlacesPerSearch: max, language: "en", skipClosedPlaces: true, scrapeContacts: !NO_WEBSITE_ONLY, ...(NO_WEBSITE_ONLY ? { website: "withoutWebsite" } : {}) }),
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

  while (leadsToday + queued < dailyTarget && searches < MAX_SEARCHES) {
    if (offset >= COMBOS.length) { note = `search pool exhausted (${COMBOS.length} trade×city searches done) — reset combo_offset to sweep again`; break; }
    const s = await apifyUsage();
    if (s != null && s >= budget) { note = "budget reached mid-run"; break; }
    const [q, loc] = COMBOS[offset];
    offset++;
    const { items, error } = await maps(q, loc, 120);
    if (error) { note = `Apify error ${error} — credit/budget exhausted; browser scraping takes over`; break; }
    for (const b of items || []) {
      if (NO_WEBSITE_ONLY && b.website) continue;
      if (!CV_CITY.test(`${b.city || ""} ${b.address || ""}`)) continue;
      const sl = slug(b.title);
      if (!sl || existing.has(sl)) continue;
      if (black.has(`${sl}|${slug(b.city || "")}`)) continue;
      const mu = b.url || (b.placeId ? `https://www.google.com/maps/place/?q=place_id:${b.placeId}` : null);
      // scrapeContacts fills these for businesses that have a website (arrays).
      const email = (b.emails || [])[0] || null;
      const insta = (b.instagrams || [])[0] || null;
      const fbook = (b.facebooks || [])[0] || null;
      const photo = b.imageUrl || (b.imageUrls || [])[0] || null;
      try {
        await c.query(
          `INSERT INTO forge_sites (slug,business_name,niche,city,service_area,address,phone,email,instagram_url,facebook_url,photo_url,google_rating,review_count,google_maps_url,fit_reason,existing_website_url,source,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'lead_engine','discovered') ON CONFLICT (slug) DO NOTHING`,
          [sl, b.title, b.categoryName || q, b.city || null, [b.city, b.state].filter(Boolean).join(", ") || null, b.address || null, b.phone || null, email, insta, fbook, photo, b.totalScore ? String(b.totalScore) : null, b.reviewsCount != null ? String(b.reviewsCount) : null, mu, `${b.website ? "Has website" : "No website"} — ${b.categoryName || q}, Coachella Valley${b.reviewsCount ? `, ${b.reviewsCount} reviews` : ""}`, b.website || null],
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
