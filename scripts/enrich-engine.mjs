#!/usr/bin/env node
// enrich-engine.mjs — contact enrichment for leads missing email/socials (launchd).
//
// Most forge leads are NO-WEBSITE local businesses, so there's no site to scrape an
// email from. But Google KNOWS these businesses: a search for "<name> <city>" reliably
// surfaces their Facebook page + Yelp, and the Facebook page usually lists a real email
// + a Messenger DM channel. So the pipeline is:
//   1. Google-search each lead → find its Facebook / Instagram / Yelp URLs.
//   2. Scrape the found Facebook pages → email, phone, Messenger, any hidden website.
//   3. Gap-fill forge_sites (never overwrite a value that's already there).
// Budget-aware: stops when Apify monthly usage hits the lead_engine budget cap.
//
//   node scripts/enrich-engine.mjs [limit]     (default 60 leads / run)
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
const env = loadEnv(join(homedir(), "code/thinkbigjoe/.env.local"));
const TOKEN = env.APIFY_API_KEY;
const DB = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
const LIMIT = Math.max(1, parseInt(process.argv[2] || "60", 10) || 60);
const clean = (u) => (u || "").split(/[?#]/)[0].replace(/\/$/, "");

async function apifyUsage() {
  try {
    const j = await (await fetch(`https://api.apify.com/v2/users/me/limits?token=${TOKEN}`)).json();
    return j?.data?.current?.monthlyUsageUsd ?? null;
  } catch {
    return null;
  }
}
async function googleSearch(terms) {
  const r = await fetch(`https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${TOKEN}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queries: terms.join("\n"), resultsPerPage: 10, maxPagesPerQuery: 1, countryCode: "us" }),
    signal: AbortSignal.timeout(240000),
  });
  if (!r.ok) return { error: `${r.status}` };
  return { items: await r.json() };
}
async function facebookPages(urls) {
  if (!urls.length) return { items: [] };
  const r = await fetch(`https://api.apify.com/v2/acts/apify~facebook-pages-scraper/run-sync-get-dataset-items?token=${TOKEN}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startUrls: urls.map((u) => ({ url: u })) }),
    signal: AbortSignal.timeout(240000),
  });
  if (!r.ok) return { error: `${r.status}` };
  return { items: await r.json() };
}
const firstMatch = (results, re) => (results.map((r) => r.url).find((u) => re.test(u || "")) || null);
const isRealFbPage = (u) => u && /facebook\.com\/[^/]+\/?$/.test(clean(u)) && !/\/(groups|events|posts|photo|watch)\b/.test(u);

(async () => {
  if (!TOKEN || !DB) { log("missing APIFY_API_KEY or DATABASE_URL — aborting"); process.exit(1); }
  const c = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const cfg = (await c.query("SELECT monthly_budget_usd FROM lead_engine WHERE id=1")).rows[0];
  const budget = Number(cfg?.monthly_budget_usd ?? 25);
  const usage0 = await apifyUsage();
  if (usage0 != null && usage0 >= budget) {
    log(`Apify budget spent ($${usage0.toFixed(2)}/$${budget}) — enrichment paused until it resets or the cap is raised.`);
    await c.end();
    return;
  }

  // Worth enriching: has a phone (a real business), still missing an email OR a Facebook.
  // Built/approved first (closest to outreach), then discovered — newest first.
  const { rows: leads } = await c.query(
    `SELECT id, business_name, city, email, facebook_url, instagram_url, existing_website_url, contact_notes
       FROM forge_sites
      WHERE phone IS NOT NULL AND phone <> ''
        AND ( (email IS NULL OR email='') OR (facebook_url IS NULL OR facebook_url='') )
        AND contact_enriched_at IS NULL
      ORDER BY (status IN ('built','approved')) DESC, created_at DESC
      LIMIT $1`,
    [LIMIT],
  );
  if (!leads.length) { log("nothing to enrich (all caught up)."); await c.end(); return; }
  log(`enriching ${leads.length} leads · usage $${usage0} / $${budget}`);

  // Process in small chunks so each Apify call stays fast (Google search is ~6s/query).
  const CHUNK = 10;
  const found = [];
  for (let i = 0; i < leads.length; i += CHUNK) {
    const batch = leads.slice(i, i + CHUNK);
    const terms = batch.map((l) => `${l.business_name} ${l.city || ""}`.trim());
    // 1. Google-search this chunk; map result pages back by query term.
    const { items: pages, error: gErr } = await googleSearch(terms);
    if (gErr) { log(`Google search error ${gErr} at chunk ${i} — stopping.`); break; }
    const byTerm = new Map();
    for (const p of pages || []) byTerm.set((p.searchQuery?.term || "").trim(), p.organicResults || []);
    for (let j = 0; j < batch.length; j++) {
      const results = byTerm.get(terms[j]) || [];
      const fb = firstMatch(results, /facebook\.com/);
      found.push({
        lead: batch[j],
        fbUrl: isRealFbPage(fb) ? clean(fb) : null,
        igUrl: firstMatch(results, /instagram\.com/),
        yelpUrl: firstMatch(results, /yelp\.com\/biz/),
      });
    }
    log(`  google chunk ${Math.floor(i / CHUNK) + 1}: ${batch.length} searched`);
  }

  // 2. Scrape all found Facebook pages in one batch for email/messenger.
  const fbUrls = [...new Set(found.map((f) => f.fbUrl).filter(Boolean))];
  const fbByUrl = new Map();
  for (let i = 0; i < fbUrls.length; i += 25) {
    const { items: fbPages, error: fErr } = await facebookPages(fbUrls.slice(i, i + 25));
    if (fErr) { log(`Facebook scrape error ${fErr} — continuing with socials only.`); break; }
    for (const p of fbPages || []) {
      const key = clean(p.pageUrl || p.url || p.facebookUrl || "");
      if (key) fbByUrl.set(key, p);
    }
  }

  // 3. Gap-fill each lead (existing non-empty values always win).
  let emails = 0, socials = 0, touched = 0;
  for (const f of found) {
    const l = f.lead;
    const fb = f.fbUrl ? fbByUrl.get(f.fbUrl) : null;
    const email = l.email || fb?.email || null;
    const facebook = l.facebook_url || f.fbUrl || null;
    const instagram = l.instagram_url || f.igUrl || null;
    const notes = [];
    if (f.yelpUrl) notes.push(`Yelp: ${f.yelpUrl}`);
    if (fb?.messenger) notes.push(`Messenger: ${fb.messenger}`);
    if (fb?.website) notes.push(`Site on FB: ${fb.website}`);
    if (fb?.phone && !l.email) notes.push(`FB phone: ${fb.phone}`);
    const noteStr = [l.contact_notes, notes.join(" · ")].filter(Boolean).join(" · ") || null;
    if (!email && !facebook && !instagram && !notes.length) continue; // nothing found

    await c.query(
      `UPDATE forge_sites
          SET email = COALESCE(NULLIF(email,''), $2),
              facebook_url = COALESCE(NULLIF(facebook_url,''), $3),
              instagram_url = COALESCE(NULLIF(instagram_url,''), $4),
              contact_notes = $5,
              contact_enriched_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [l.id, email, facebook, instagram, noteStr],
    );
    touched++;
    if (!l.email && email) emails++;
    if ((!l.facebook_url && facebook) || (!l.instagram_url && instagram)) socials++;
  }

  const usage1 = (await apifyUsage()) ?? usage0 ?? 0;
  const summary = `Enriched ${touched}/${leads.length} leads · +${emails} emails · +${socials} socials · spend $${Number(usage1).toFixed(2)}/$${budget}`;
  await c.query(
    "INSERT INTO activity_log (actor,event_type,summary,metadata) VALUES ('lead_engine','forge_contact_enriched',$1,$2::jsonb)",
    [summary, JSON.stringify({ auto: true, touched, emails, socials, spend: usage1 })],
  );
  log(summary);
  await c.end();
})().catch((e) => { log("ERROR", e?.message || e); process.exit(1); });
