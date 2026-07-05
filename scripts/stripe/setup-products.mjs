#!/usr/bin/env node
// Create ThinkBigJoe's Stripe products + prices (idempotent via lookup_key).
// Reads STRIPE_SECRET_KEY from .env.local. Prints the price IDs to paste into env.
//
//   node scripts/stripe/setup-products.mjs
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
if (!sk.startsWith("sk_test_")) { console.error("refusing to run against a non-test key:", sk.slice(0, 8)); process.exit(1); }
const stripe = new Stripe(sk);

// tier → { product name, description, unit_amount (cents), recurring? , lookup_key, envVar }
const PRICES = [
  { name: "ThinkBigJoe Website Build", desc: "One-time custom website build.", amount: 30000, recurring: null, lookup: "tbj_build_onetime", envVar: "STRIPE_PRICE_BUILD" },
  { name: "ThinkBigJoe Website + Hosting", desc: "Website hosting, updates & maintenance.", amount: 9900, recurring: "month", lookup: "tbj_website_monthly", envVar: "STRIPE_PRICE_WEBSITE" },
  { name: "ThinkBigJoe Website + Voice", desc: "Website + AI voice receptionist.", amount: 29900, recurring: "month", lookup: "tbj_voice_monthly", envVar: "STRIPE_PRICE_VOICE" },
  { name: "ThinkBigJoe Complete", desc: "Website + voice + AI sales system.", amount: 99900, recurring: "month", lookup: "tbj_complete_monthly", envVar: "STRIPE_PRICE_COMPLETE" },
];

async function ensurePrice(p) {
  // Reuse an existing price with this lookup_key if present (prices are immutable).
  const found = await stripe.prices.list({ lookup_keys: [p.lookup], limit: 1, active: true });
  if (found.data[0]) return found.data[0];

  // Find or create the product by name.
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
  console.log(`account: ${acct.id} (${acct.settings?.dashboard?.display_name || "?"}) — test mode\n`);

  const out = [];
  for (const p of PRICES) {
    const price = await ensurePrice(p);
    console.log(`  ${p.envVar}=${price.id}   (${p.name} · $${(p.amount / 100).toFixed(0)}${p.recurring ? "/mo" : " one-time"})`);
    out.push(`${p.envVar}=${price.id}`);
  }
  console.log("\n--- add these to .env.local (and later Vercel) ---");
  console.log(out.join("\n"));
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
