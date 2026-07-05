#!/usr/bin/env node
// Activate TBJ Stripe TEST mode on Vercel prod: create the webhook endpoint and
// push all Stripe env vars, then redeploy. Secrets flow Stripe→Vercel without
// ever being printed. Reads Stripe keys from thinkbigjoe/.env.local and the
// Vercel token from nanocrew/.env.local.
import { readFileSync } from "node:fs";
import Stripe from "stripe";

const PID = "prj_yhuVSXdJGnI1AJ3uzvvsOfSO4Mfa";
const REPO_ID = 1265774643;
const WEBHOOK_URL = "https://thinkbigjoe.com/api/stripe/webhook";
const TARGETS = ["production", "preview"];

function envFrom(path, key) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(new RegExp(`^${key}=(.*)$`));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}
const LOCAL = "/Users/macdaddyjoe/code/thinkbigjoe/.env.local";
const NANO = "/Users/macdaddyjoe/code/nanocrew/.env.local";

const SK = envFrom(LOCAL, "STRIPE_SECRET_KEY");
const VTOKEN = envFrom(NANO, "VERCEL_TOKEN");
if (!SK?.startsWith("sk_test_")) { console.error("STRIPE_SECRET_KEY must be a test key"); process.exit(1); }
if (!VTOKEN) { console.error("no VERCEL_TOKEN"); process.exit(1); }

const stripe = new Stripe(SK);
const vercel = (path, opts = {}) =>
  fetch(`https://api.vercel.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${VTOKEN}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });

async function main() {
  const acct = await stripe.accounts.retrieve();
  if (acct.id !== "acct_1ThIBH6XORVVFHO4") {
    console.error(`WRONG ACCOUNT: ${acct.id} — expected ThinkBigJoe acct_1ThIBH6XORVVFHO4`); process.exit(1);
  }
  console.log(`✓ Stripe account ${acct.id} (${acct.settings?.dashboard?.display_name}) — test mode`);

  // 1) Webhook endpoint: delete any existing for this URL, then create fresh (secret only returned on create).
  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  for (const e of existing.data) {
    if (e.url === WEBHOOK_URL) { await stripe.webhookEndpoints.del(e.id); console.log(`  removed old webhook ${e.id}`); }
  }
  const wh = await stripe.webhookEndpoints.create({
    url: WEBHOOK_URL,
    description: "ThinkBigJoe portal — checkout + subscription fulfillment",
    enabled_events: [
      "checkout.session.completed",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.paid",
      "invoice.payment_failed",
    ],
  });
  console.log(`✓ webhook endpoint ${wh.id} → ${WEBHOOK_URL}`);

  // 2) Env vars to set (secrets + config).
  const vars = {
    STRIPE_SECRET_KEY: SK,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: envFrom(LOCAL, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"),
    STRIPE_WEBHOOK_SECRET: wh.secret,
    STRIPE_PRICE_BUILD: envFrom(LOCAL, "STRIPE_PRICE_BUILD"),
    STRIPE_PRICE_WEBSITE: envFrom(LOCAL, "STRIPE_PRICE_WEBSITE"),
    STRIPE_PRICE_VOICE: envFrom(LOCAL, "STRIPE_PRICE_VOICE"),
    STRIPE_PRICE_COMPLETE: envFrom(LOCAL, "STRIPE_PRICE_COMPLETE"),
  };

  // Delete existing entries for these keys (avoids sensitive/type conflicts), then create fresh.
  const list = await (await vercel(`/v9/projects/${PID}/env`)).json();
  for (const e of list.envs || []) {
    if (e.key in vars) { await vercel(`/v9/projects/${PID}/env/${e.id}`, { method: "DELETE" }); }
  }
  for (const [key, value] of Object.entries(vars)) {
    if (!value) { console.error(`  MISSING value for ${key}`); continue; }
    const res = await vercel(`/v10/projects/${PID}/env`, {
      method: "POST",
      body: JSON.stringify({ key, value, type: "encrypted", target: TARGETS }),
    });
    console.log(`  set ${key}: ${res.ok ? "ok" : "FAILED " + (await res.text()).slice(0, 120)}`);
  }

  // 3) Redeploy production so the new env takes effect.
  const dep = await (await vercel(`/v13/deployments`, {
    method: "POST",
    body: JSON.stringify({
      name: "thinkbigjoe-cyio",
      project: PID,
      target: "production",
      gitSource: { type: "github", repoId: REPO_ID, ref: "main" },
    }),
  })).json();
  console.log(`✓ redeploy triggered: ${dep.id || dep.uid || JSON.stringify(dep).slice(0, 120)}`);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
