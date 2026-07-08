#!/usr/bin/env node
// LIVE variant of setup-products — creates ThinkBigJoe's products + prices in LIVE mode
// (idempotent via lookup_key). REQUIRES an sk_live_ key so it can't run against test by
// accident. Reads STRIPE_SECRET_KEY from .env.local. Prints the live price IDs.
//
//   node scripts/stripe/setup-products-live.mjs
import { readFileSync } from "node:fs";
import Stripe from "stripe";

function env(key) {
  for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(new RegExp(`^${key}=(.*)$`));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}
const sk = env("STRIPE_SECRET_KEY");
if (!sk) { console.error("missing STRIPE_SECRET_KEY in .env.local"); process.exit(1); }
if (!sk.startsWith("sk_live_")) { console.error("this is the LIVE setup — STRIPE_SECRET_KEY must be an sk_live_ key (got:", sk.slice(0, 8) + "…)"); process.exit(1); }
const stripe = new Stripe(sk);

// Same products/prices as the test setup — must match plans.ts.
const PRICES = [
  { name: "ThinkBigJoe Website Build", desc: "One-time custom website build.", amount: 30000, recurring: null, lookup: "tbj_build_onetime", envVar: "STRIPE_PRICE_BUILD" },
  { name: "ThinkBigJoe Website + Hosting", desc: "Website hosting, updates & maintenance.", amount: 9900, recurring: "month", lookup: "tbj_website_monthly", envVar: "STRIPE_PRICE_WEBSITE" },
  { name: "ThinkBigJoe Website + Voice", desc: "Website + AI voice receptionist.", amount: 29900, recurring: "month", lookup: "tbj_voice_monthly", envVar: "STRIPE_PRICE_VOICE" },
  { name: "ThinkBigJoe Complete", desc: "Website + voice + AI sales system.", amount: 99900, recurring: "month", lookup: "tbj_complete_monthly", envVar: "STRIPE_PRICE_COMPLETE" },
];

async function ensurePrice(p) {
  const found = await stripe.prices.list({ lookup_keys: [p.lookup], limit: 1, active: true });
  if (found.data[0]) return found.data[0];
  const products = await stripe.products.search({ query: `name:"${p.name}"`, limit: 1 });
  const product = products.data[0] || (await stripe.products.create({ name: p.name, description: p.desc }));
  return stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: p.amount,
    ...(p.recurring ? { recurring: { interval: p.recurring } } : {}),
    lookup_key: p.lookup,
    transfer_lookup_key: true,
  });
}

async function main() {
  const acct = await stripe.accounts.retrieve();
  console.log(`account: ${acct.id} (${acct.settings?.dashboard?.display_name || "?"}) — LIVE mode\n`);
  const out = [];
  for (const p of PRICES) {
    const price = await ensurePrice(p);
    console.log(`  ${p.envVar}=${price.id}   (${p.name} · $${(p.amount / 100).toFixed(0)}${p.recurring ? "/mo" : " one-time"})`);
    out.push(`${p.envVar}=${price.id}`);
  }
  console.log("\n--- LIVE price IDs (Claude will push these to Vercel) ---");
  console.log(out.join("\n"));
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
