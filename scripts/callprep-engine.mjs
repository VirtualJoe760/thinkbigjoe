#!/usr/bin/env node
// callprep-engine.mjs — build "what to say on the call" intelligence per lead (launchd).
//
// For each lead, gathers the context Joe wants before dialing:
//   • Google rating + a few real review QUOTES (so he can open with a genuine compliment)
//   • Social reach — Facebook followers/likes, Instagram followers
//   • A short TALKING-POINTS script: a strength to praise → the gap (no website) → how
//     TBJ's plan gets them more sales + organizes their lead flow.
// Batches each Apify scraper across many leads per call. Budget-aware.
//
//   node scripts/callprep-engine.mjs [limit]     (default 40 leads / run)
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
const LIMIT = Math.max(1, parseInt(process.argv[2] || "40", 10) || 40);
const clean = (u) => (u || "").split(/[?#]/)[0].replace(/\/$/, "");
const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9]/g, "")) || null);
// Loose match key: lowercase alphanumerics only, drop common company suffixes.
const nk = (s) => (s || "").toLowerCase().replace(/\b(llc|inc|corp|co|ltd)\b/g, "").replace(/[^a-z0-9]/g, "");

async function apifyUsage() {
  try {
    const j = await (await fetch(`https://api.apify.com/v2/users/me/limits?token=${TOKEN}`)).json();
    return j?.data?.current?.monthlyUsageUsd ?? null;
  } catch { return null; }
}
async function actor(slug, input, ms = 240000) {
  const r = await fetch(`https://api.apify.com/v2/acts/${slug}/run-sync-get-dataset-items?token=${TOKEN}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input), signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) return { error: `${r.status}` };
  return { items: await r.json() };
}

// Build the talking-points script from the real data we gathered.
function buildCallPrep({ name, niche, city, rating, reviewCount, quotes, fb, ig }) {
  const L = [];
  const trade = (niche || "business").toLowerCase();
  // 1) A genuine compliment — lead with their reputation + a real quote.
  if (rating && reviewCount) {
    L.push(`Open warm: "${rating}★ from ${reviewCount} reviews${city ? ` in ${city}` : ""} — clearly people love working with you."`);
  } else {
    L.push(`Open warm: compliment their reputation / how long they've served ${city || "the area"}.`);
  }
  const pos = (quotes || []).find((q) => (q.stars || 0) >= 4 && (q.text || "").length > 25);
  if (pos) {
    const snip = pos.text.length > 120 ? pos.text.slice(0, 117) + "…" : pos.text;
    L.push(`Reference a review — ${pos.name || "a customer"} wrote: "${snip}" Mention you saw it.`);
  }
  // 2) Social reach — only worth mentioning when it's an actual audience (>=300).
  const reach = [];
  if ((ig?.followers || 0) >= 300) reach.push(`${ig.followers.toLocaleString()} on Instagram`);
  if ((fb?.followers || 0) >= 300) reach.push(`${fb.followers.toLocaleString()} Facebook followers`);
  if (reach.length) L.push(`Note their reach: ${reach.join(" · ")} — they've built an audience but have nowhere to send it.`);
  // 3) The gap + the pitch.
  L.push(`The gap: no website — when someone searches "${name}" they can't find or book you, so those ready-to-buy leads go to a competitor who does have a site.`);
  L.push(`The pitch: TBJ builds you a pro site that turns your ${rating ? `${rating}★ ` : ""}reputation into booked jobs — click-to-call, online booking, and a simple dashboard so every lead is captured and organized in one place instead of lost in texts/DMs.`);
  L.push(`Close: offer to text them the live site we already built — "take a look, and if you like it we can have you up in a couple days."`);
  return L.join("\n");
}

(async () => {
  if (!TOKEN || !DB) { log("missing APIFY_API_KEY or DATABASE_URL — aborting"); process.exit(1); }
  const c = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const cfg = (await c.query("SELECT monthly_budget_usd FROM lead_engine WHERE id=1")).rows[0];
  const budget = Number(cfg?.monthly_budget_usd ?? 25);
  const usage0 = await apifyUsage();
  if (usage0 != null && usage0 >= budget) {
    log(`Apify budget spent ($${usage0.toFixed(2)}/$${budget}) — call-prep paused until it resets or the cap is raised.`);
    await c.end();
    return;
  }

  // Prep leads that don't have it yet — built/approved first, then most-reviewed.
  const { rows: leads } = await c.query(
    `SELECT id, business_name, niche, city, google_rating, review_count, google_maps_url, facebook_url, instagram_url
       FROM forge_sites
      WHERE call_prep_at IS NULL
      ORDER BY NULLIF(review_count,'')::int DESC NULLS LAST, (status IN ('built','approved')) DESC
      LIMIT $1`,
    [LIMIT],
  );
  if (!leads.length) { log("nothing to prep (all caught up)."); await c.end(); return; }
  log(`prepping ${leads.length} leads · usage $${usage0} / $${budget}`);

  // 1. Reviews (+ fresh rating) via Maps — batch by maps URL, in chunks. Keyed by
  //    normalized business NAME (the scraper's returned URL differs from the stored one).
  const mapLeads = leads.filter((l) => l.google_maps_url);
  const reviewsByName = new Map();
  for (let i = 0; i < mapLeads.length; i += 10) {
    const { items, error } = await actor("compass~crawler-google-places", {
      startUrls: mapLeads.slice(i, i + 10).map((l) => ({ url: l.google_maps_url })),
      maxReviews: 5, reviewsSort: "newest", language: "en",
    });
    if (error) { log(`Maps reviews error ${error} — continuing.`); break; }
    for (const p of items || []) {
      if (!p.title) continue;
      reviewsByName.set(nk(p.title), {
        rating: p.totalScore ?? null,
        reviewCount: p.reviewsCount ?? null,
        photo: p.imageUrl || (p.imageUrls || [])[0] || null,
        quotes: (p.reviews || []).filter((r) => r.text).slice(0, 4).map((r) => ({ stars: r.stars, name: r.name, text: r.text })),
      });
    }
    log(`  reviews chunk ${Math.floor(i / 10) + 1}: ${Math.min(10, mapLeads.length - i)} places`);
  }
  // Resolve each lead's reviews by exact or prefix name match.
  const reviewsFor = (name) => {
    const k = nk(name);
    if (reviewsByName.has(k)) return reviewsByName.get(k);
    for (const [rk, v] of reviewsByName) if (rk && (rk.startsWith(k) || k.startsWith(rk))) return v;
    return null;
  };

  // 2. Facebook followers/likes — batch.
  const fbUrls = [...new Set(leads.filter((l) => l.facebook_url).map((l) => clean(l.facebook_url)))];
  const fbByUrl = new Map();
  for (let i = 0; i < fbUrls.length; i += 25) {
    const { items, error } = await actor("apify~facebook-pages-scraper", { startUrls: fbUrls.slice(i, i + 25).map((u) => ({ url: u })) });
    if (error) { log(`FB error ${error} — continuing.`); break; }
    for (const p of items || []) {
      const key = clean(p.pageUrl || p.url || p.facebookUrl || "");
      if (key) fbByUrl.set(key, { followers: num(p.followers), likes: num(p.likes) });
    }
  }

  // 3. Instagram followers — batch by handle (only leads that have an IG url).
  const igHandles = leads
    .filter((l) => l.instagram_url)
    .map((l) => (clean(l.instagram_url).match(/instagram\.com\/([^/?]+)/) || [])[1])
    .filter(Boolean);
  const igByHandle = new Map();
  if (igHandles.length) {
    const { items, error } = await actor("apify~instagram-scraper", { directUrls: igHandles.map((h) => `https://www.instagram.com/${h}/`), resultsType: "details", resultsLimit: 1 });
    if (error) log(`IG error ${error} — continuing.`);
    for (const p of items || []) if (p.username) igByHandle.set(p.username.toLowerCase(), { followers: num(p.followersCount) });
  }

  // 4. Assemble + write.
  let prepped = 0, withQuotes = 0;
  for (const l of leads) {
    const rv = l.google_maps_url ? reviewsFor(l.business_name) : null;
    const fb = l.facebook_url ? fbByUrl.get(clean(l.facebook_url)) : null;
    const igHandle = l.instagram_url ? (clean(l.instagram_url).match(/instagram\.com\/([^/?]+)/) || [])[1] : null;
    const ig = igHandle ? igByHandle.get(igHandle.toLowerCase()) : null;

    const rating = rv?.rating ?? (l.google_rating ? Number(l.google_rating) : null);
    const reviewCount = rv?.reviewCount ?? (l.review_count ? Number(l.review_count) : null);
    const quotes = rv?.quotes || [];
    const social = {};
    if (fb && (fb.followers || fb.likes)) social.facebook = fb;
    if (ig && ig.followers) social.instagram = ig;

    const callPrep = buildCallPrep({ name: l.business_name, niche: l.niche, city: l.city, rating, reviewCount, quotes, fb: social.facebook, ig: social.instagram });

    await c.query(
      `UPDATE forge_sites
          SET review_quotes = $2::jsonb,
              social_stats = $3::jsonb,
              call_prep = $4,
              google_rating = COALESCE($5, google_rating),
              review_count = COALESCE($6, review_count),
              photo_url = COALESCE(NULLIF(photo_url,''), $7),
              call_prep_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [l.id, JSON.stringify(quotes), JSON.stringify(social), callPrep, rating != null ? String(rating) : null, reviewCount != null ? String(reviewCount) : null, rv?.photo || null],
    );
    prepped++;
    if (quotes.length) withQuotes++;
  }

  const usage1 = (await apifyUsage()) ?? usage0 ?? 0;
  const summary = `Call-prepped ${prepped}/${leads.length} leads · ${withQuotes} with review quotes · spend $${Number(usage1).toFixed(2)}/$${budget}`;
  await c.query(
    "INSERT INTO activity_log (actor,event_type,summary,metadata) VALUES ('lead_engine','forge_callprep',$1,$2::jsonb)",
    [summary, JSON.stringify({ auto: true, prepped, withQuotes, spend: usage1 })],
  );
  log(summary);
  await c.end();
})().catch((e) => { log("ERROR", e?.message || e); process.exit(1); });
