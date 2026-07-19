#!/usr/bin/env node
// Create the 2026-07 tier catalogue in Stripe — answer / respond / recover + the $250 setup fee.
// (See docs/BUSINESS_PLAN.md. Supersedes setup-products.mjs, which created the retired
// website/voice/complete bundles. Those prices are NOT touched or deactivated here — existing
// subscriptions still bill against them and src/lib/plans.ts still resolves them as legacy.)
//
// DRY RUN BY DEFAULT. Nothing is written to Stripe unless you pass --apply:
//
//   node scripts/stripe/setup-products-tiers.mjs            # prints the plan, writes nothing
//   node scripts/stripe/setup-products-tiers.mjs --apply    # actually creates (test key only)
//   node scripts/stripe/setup-products-tiers.mjs --apply --live   # live key, requires --live too
//
// Idempotent: every price is looked up by lookup_key first, and products are matched by their
// tbj_tier metadata before falling back to name search — so a rerun after a partial failure
// resumes rather than duplicating.
import { readFileSync } from "node:fs";
import Stripe from "stripe";

const APPLY = process.argv.includes("--apply");
const ALLOW_LIVE = process.argv.includes("--live");

function env(key) {
  for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(new RegExp(`^${key}=(.*)$`));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

// The catalogue. Amounts in cents. Annual = 10 × monthly (two months free) to match
// annualSavings() in src/lib/plans.ts — keep the two in sync or the portal quotes a price
// Stripe won't charge.
const PRODUCTS = [
  {
    tier: "setup",
    name: "ThinkBigJoe Setup",
    desc: "One-time setup: number provisioning, agent configuration, portal + website.",
    prices: [{ amount: 25000, recurring: null, lookup: "tbj_setup_onetime", envVar: "STRIPE_PRICE_SETUP" }],
  },
  {
    tier: "answer",
    name: "ThinkBigJoe Answer",
    desc: "AI voice receptionist that answers, qualifies and books — plus your portal and website.",
    prices: [
      { amount: 49700, recurring: "month", lookup: "tbj_answer_monthly", envVar: "STRIPE_PRICE_ANSWER" },
      { amount: 497000, recurring: "year", lookup: "tbj_answer_annual", envVar: "STRIPE_PRICE_ANSWER_ANNUAL" },
    ],
  },
  {
    tier: "respond",
    name: "ThinkBigJoe Respond",
    desc: "Everything in Answer, plus text handling and unsold estimate follow-up.",
    prices: [
      { amount: 79700, recurring: "month", lookup: "tbj_respond_monthly", envVar: "STRIPE_PRICE_RESPOND" },
      { amount: 797000, recurring: "year", lookup: "tbj_respond_annual", envVar: "STRIPE_PRICE_RESPOND_ANNUAL" },
    ],
  },
  {
    tier: "recover",
    name: "ThinkBigJoe Recover",
    desc: "Everything in Respond, plus seasonal reminders, reactivation and review requests.",
    prices: [
      { amount: 119700, recurring: "month", lookup: "tbj_recover_monthly", envVar: "STRIPE_PRICE_RECOVER" },
      { amount: 1197000, recurring: "year", lookup: "tbj_recover_annual", envVar: "STRIPE_PRICE_RECOVER_ANNUAL" },
    ],
  },
];

const money = (c) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
const per = (r) => (r === "month" ? "/mo" : r === "year" ? "/yr" : " one-time");

function printPlan() {
  console.log("DRY RUN — no Stripe calls will be made. Re-run with --apply to create.\n");
  const out = [];
  for (const p of PRODUCTS) {
    console.log(`  product: ${p.name}   [metadata tbj_tier=${p.tier}]`);
    for (const pr of p.prices) {
      console.log(`    price ${pr.lookup.padEnd(22)} ${money(pr.amount)}${per(pr.recurring)}  → ${pr.envVar}`);
      out.push(`${pr.envVar}=price_…`);
    }
  }
  console.log("\n--- env vars this would produce ---");
  console.log(out.join("\n"));
  console.log(
    "\nAlso required (not created here — a coupon, and it already exists):" +
      "\n  coupon `website-first-month-99` stays as-is but must ONLY be applied to legacy" +
      "\n  website-bundled plans. See firstMonthCouponFor() in src/lib/plans.ts.",
  );
}

// Match on metadata first: product names are editable in the dashboard, tbj_tier is ours.
async function ensureProduct(stripe, p) {
  const byMeta = await stripe.products.search({ query: `metadata['tbj_tier']:'${p.tier}'`, limit: 1 });
  if (byMeta.data[0]) return byMeta.data[0];
  const byName = await stripe.products.search({ query: `name:'${p.name}'`, limit: 1 });
  if (byName.data[0]) {
    // Backfill the marker so the next run takes the cheap path and can survive a rename.
    return stripe.products.update(byName.data[0].id, { metadata: { tbj_tier: p.tier } });
  }
  return stripe.products.create({ name: p.name, description: p.desc, metadata: { tbj_tier: p.tier } });
}

// Prices are immutable in Stripe, so "ensure" means reuse-or-create — never update.
async function ensurePrice(stripe, productId, pr) {
  const found = await stripe.prices.list({ lookup_keys: [pr.lookup], limit: 1, active: true });
  if (found.data[0]) return { price: found.data[0], created: false };
  const price = await stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: pr.amount,
    ...(pr.recurring ? { recurring: { interval: pr.recurring } } : {}),
    lookup_key: pr.lookup,
    transfer_lookup_key: true,
  });
  return { price, created: true };
}

async function apply() {
  const sk = env("STRIPE_SECRET_KEY");
  if (!sk) { console.error("missing STRIPE_SECRET_KEY in .env.local"); process.exit(1); }
  // Creating live products costs nothing, but it puts sellable prices in front of customers —
  // make that a deliberate second flag rather than a mode you fall into.
  if (!sk.startsWith("sk_test_") && !ALLOW_LIVE) {
    console.error(`refusing to run against a non-test key (${sk.slice(0, 8)}…) without --live`);
    process.exit(1);
  }
  const stripe = new Stripe(sk);

  const acct = await stripe.accounts.retrieve();
  console.log(`account: ${acct.id} (${acct.settings?.dashboard?.display_name || "?"}) — ${sk.startsWith("sk_test_") ? "test" : "LIVE"} mode\n`);

  const out = [];
  for (const p of PRODUCTS) {
    const product = await ensureProduct(stripe, p);
    for (const pr of p.prices) {
      const { price, created } = await ensurePrice(stripe, product.id, pr);
      console.log(`  ${created ? "created" : "reused "}  ${pr.envVar}=${price.id}   (${p.name} · ${money(pr.amount)}${per(pr.recurring)})`);
      out.push(`${pr.envVar}=${price.id}`);
    }
  }
  console.log("\n--- add these to .env.local (and later Vercel) ---");
  console.log(out.join("\n"));
  console.log("\nLeave the legacy STRIPE_PRICE_WEBSITE/VOICE/COMPLETE vars in place — planKeyForPrice() needs them to resolve existing subscriptions.");
}

if (APPLY) {
  apply().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
} else {
  printPlan();
}
