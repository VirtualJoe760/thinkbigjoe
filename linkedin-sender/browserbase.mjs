/**
 * Browserbase browser provider — the ONLY part that differs from the old local sender.
 *
 * Gives the rest of the code a Playwright context (over CDP) backed by a cloud Chromium
 * that (a) carries your LinkedIn login via a persistent Context, (b) exits from a
 * residential proxy geo-matched to where you normally sign in, and (c) runs in the cloud
 * so nothing pops up on your machine. sendConnection/sendMessage in linkedin.mjs are
 * unchanged — they just receive this context instead of a local one.
 */
import "./env.mjs";
import { chromium } from "playwright-core";
import Browserbase from "@browserbasehq/sdk";

const API_KEY = process.env.BROWSERBASE_API_KEY;
const PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;
const CONTEXT_ID = process.env.BROWSERBASE_CONTEXT_ID; // LinkedIn-authenticated context (from seed-auth)
const PROXY_ON = process.env.BROWSERBASE_PROXY !== "0"; // residential proxy on by default

export const bb = API_KEY ? new Browserbase({ apiKey: API_KEY }) : null;

// Residential proxy pinned to a geo so LinkedIn sees a consistent, plausible location.
export function proxyConfig() {
  if (!PROXY_ON) return false;
  const geolocation = {
    country: process.env.BROWSERBASE_PROXY_COUNTRY || "US",
    ...(process.env.BROWSERBASE_PROXY_STATE ? { state: process.env.BROWSERBASE_PROXY_STATE } : {}),
    ...(process.env.BROWSERBASE_PROXY_CITY ? { city: process.env.BROWSERBASE_PROXY_CITY } : {}),
  };
  return [{ type: "browserbase", geolocation }];
}

/**
 * Run `fn(context)` against a fresh Browserbase session, then tear it down.
 * Throws clear errors if config is missing so the runner can report them.
 */
export async function withBrowser(fn) {
  if (!bb) throw new Error("BROWSERBASE_API_KEY missing (add to .env.local)");
  if (!PROJECT_ID) throw new Error("BROWSERBASE_PROJECT_ID missing (add to .env.local)");
  if (!CONTEXT_ID) throw new Error("BROWSERBASE_CONTEXT_ID missing — run `node linkedin-sender/seed-auth.mjs` and log into LinkedIn once");

  const session = await bb.sessions.create({
    projectId: PROJECT_ID,
    proxies: proxyConfig(),
    keepAlive: false,
    browserSettings: {
      context: { id: CONTEXT_ID, persist: true },
      solveCaptchas: true,
      fingerprint: { devices: ["desktop"], operatingSystems: ["windows"] },
    },
  });

  const browser = await chromium.connectOverCDP(session.connectUrl);
  try {
    const ctx = browser.contexts()[0];
    return await fn(ctx, { sessionId: session.id });
  } finally {
    await browser.close().catch(() => {}); // releases the session
  }
}
