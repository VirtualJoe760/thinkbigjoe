#!/usr/bin/env node
/**
 * ONE-TIME LinkedIn login for the cloud sender.
 *
 * Creates (or reuses) a Browserbase Context, opens a live-view browser session, and prints
 * a URL. Open that URL, log into LinkedIn normally (handle any 2FA), confirm you land on the
 * feed, then press Ctrl+C here. Because the session uses the Context with persist:true, your
 * login (cookies/session) is saved INTO the Context and reused by every future run — no
 * re-login, and no OS file-picker / popups on your machine.
 *
 * Run: node linkedin-sender/seed-auth.mjs
 * If it prints a new BROWSERBASE_CONTEXT_ID, copy it into .env.local before sending.
 */
import "./env.mjs";
import Browserbase from "@browserbasehq/sdk";

const API_KEY = process.env.BROWSERBASE_API_KEY;
const PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;
if (!API_KEY || !PROJECT_ID) {
  console.error("Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in .env.local first.");
  process.exit(1);
}
const bb = new Browserbase({ apiKey: API_KEY });

function proxyConfig() {
  if (process.env.BROWSERBASE_PROXY === "0") return false;
  return [{ type: "browserbase", geolocation: {
    country: process.env.BROWSERBASE_PROXY_COUNTRY || "US",
    ...(process.env.BROWSERBASE_PROXY_STATE ? { state: process.env.BROWSERBASE_PROXY_STATE } : {}),
    ...(process.env.BROWSERBASE_PROXY_CITY ? { city: process.env.BROWSERBASE_PROXY_CITY } : {}),
  } }];
}

let contextId = process.env.BROWSERBASE_CONTEXT_ID;
if (!contextId) {
  const c = await bb.contexts.create({ projectId: PROJECT_ID });
  contextId = c.id;
  console.log("\n>>> Created a new Context. Add this to .env.local:\n");
  console.log(`BROWSERBASE_CONTEXT_ID=${contextId}\n`);
}

const session = await bb.sessions.create({
  projectId: PROJECT_ID,
  proxies: proxyConfig(),
  keepAlive: true, // stays open while you log in
  browserSettings: { context: { id: contextId, persist: true }, solveCaptchas: true },
});

let liveUrl = `https://www.browserbase.com/sessions/${session.id}`;
try {
  const dbg = await bb.sessions.debug(session.id);
  liveUrl = dbg.debuggerFullscreenUrl || dbg.debuggerUrl || liveUrl;
} catch { /* fall back to the dashboard session URL */ }

console.log("================ LOG INTO LINKEDIN ================");
console.log("1) Open this live-view URL in your browser:\n");
console.log("   " + liveUrl + "\n");
console.log("2) Go to linkedin.com and sign in (handle 2FA). Land on the feed.");
console.log("3) Then press Ctrl+C here. Your login is saved into the Context.");
console.log("   Context in use: " + contextId);
console.log("===================================================");

// Keep the process (and the keepAlive session) alive until Joe is done.
await new Promise(() => {});
