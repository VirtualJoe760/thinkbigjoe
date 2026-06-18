/**
 * Playwright LinkedIn driver for the unattended sender (Windows, residential).
 *
 * Uses a PERSISTENT Chrome profile (your real installed Chrome via channel:"chrome")
 * so your logged-in LinkedIn session lives in ./chrome-profile and is reused every
 * run — no extension, no Claude. Headful + a real profile = most human-like.
 *
 * SAFETY: set DRY_RUN=1 to locate every control and stop BEFORE clicking Send —
 * use this to verify selectors against the current LinkedIn UI before going live.
 * Aborts to "CHECKPOINT" on any verification/checkpoint screen.
 *
 * One-time login:  node windows-sender/linkedin.mjs --login
 * (opens the profile so you can log into LinkedIn once; the session then persists.)
 */
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const PROFILE_DIR = process.env.LI_PROFILE_DIR || fileURLToPath(new URL("./chrome-profile", import.meta.url));
export const DRY_RUN = process.env.DRY_RUN === "1";
const jitter = (a, b) => a + Math.floor(Math.random() * (b - a));

export async function withBrowser(fn) {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
    viewport: null,
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized"],
  });
  try {
    return await fn(ctx);
  } finally {
    await ctx.close().catch(() => {});
  }
}

function isCheckpoint(page) {
  return /checkpoint|\/uas\/|\/authwall|add-phone|verify|challenge/i.test(page.url());
}

async function ensureLoggedIn(page) {
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(jitter(1500, 3000));
  if (/\/login|\/authwall|signup/i.test(page.url())) throw new Error("NOT_LOGGED_IN");
  if (isCheckpoint(page)) throw new Error("CHECKPOINT");
}

/** Send ONE connection request with a note. Returns SENT | DRYRUN | SKIP <r> | CHECKPOINT. */
export async function sendConnection(ctx, profileUrl, note) {
  const page = await ctx.newPage();
  try {
    await ensureLoggedIn(page);
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(jitter(2000, 4000));
    if (isCheckpoint(page)) return "CHECKPOINT";

    // Connect: primary button, else under the "More" menu.
    let connect = page.locator('main button:has-text("Connect")').first();
    if (!(await connect.count())) {
      const more = page.locator('main button:has-text("More")').first();
      if (await more.count()) { await more.click(); await page.waitForTimeout(jitter(600, 1200)); }
      connect = page.locator('div[role="menu"] >> text=/^Connect$/').first();
    }
    if (!(await connect.count())) return "SKIP no-connect-option";
    await connect.click();
    await page.waitForTimeout(jitter(800, 1600));

    const addNote = page.locator('button:has-text("Add a note")').first();
    if (await addNote.count()) {
      await addNote.click();
      await page.waitForTimeout(jitter(500, 1000));
      const ta = page.locator('textarea[name="message"], textarea#custom-message, div[role="dialog"] textarea').first();
      await ta.fill(note);
      await page.waitForTimeout(jitter(600, 1200));
    }

    if (DRY_RUN) return "DRYRUN ready-to-send";

    const send = page.locator('button:has-text("Send invitation"), button:has-text("Send")').last();
    await send.click();
    await page.waitForTimeout(jitter(1500, 2500));
    if (isCheckpoint(page)) return "CHECKPOINT";
    return "SENT";
  } catch (e) {
    if (/CHECKPOINT/.test(e.message)) return "CHECKPOINT";
    if (/NOT_LOGGED_IN/.test(e.message)) return "SKIP not-logged-in";
    return `SKIP error:${e.message.slice(0, 60)}`;
  } finally {
    await page.close().catch(() => {});
  }
}

/** Send ONE message in an existing thread. Returns SENT | DRYRUN | SKIP <r> | CHECKPOINT. */
export async function sendMessage(ctx, profileUrl, text) {
  const page = await ctx.newPage();
  try {
    await ensureLoggedIn(page);
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(jitter(2000, 4000));
    if (isCheckpoint(page)) return "CHECKPOINT";

    const msgBtn = page.locator('main button:has-text("Message")').first();
    if (!(await msgBtn.count())) return "SKIP no-message-button";
    await msgBtn.click();
    await page.waitForTimeout(jitter(1000, 2000));

    const box = page.locator('div.msg-form__contenteditable[contenteditable="true"], div[role="textbox"][contenteditable="true"]').first();
    if (!(await box.count())) return "SKIP no-compose-box";
    await box.click();
    await box.type(text, { delay: jitter(20, 60) });
    await page.waitForTimeout(jitter(600, 1200));

    if (DRY_RUN) return "DRYRUN ready-to-send";

    const send = page.locator('button.msg-form__send-button, button:has-text("Send")').last();
    await send.click();
    await page.waitForTimeout(jitter(1200, 2200));
    if (isCheckpoint(page)) return "CHECKPOINT";
    return "SENT";
  } catch (e) {
    if (/CHECKPOINT/.test(e.message)) return "CHECKPOINT";
    if (/NOT_LOGGED_IN/.test(e.message)) return "SKIP not-logged-in";
    return `SKIP error:${e.message.slice(0, 60)}`;
  } finally {
    await page.close().catch(() => {});
  }
}

// --login : open the persistent profile so Joe can log into LinkedIn once.
if (process.argv.includes("--login")) {
  console.log("Opening Chrome with the automation profile. Log into LinkedIn, then close the window.");
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { channel: "chrome", headless: false, viewport: null, args: ["--start-maximized"] });
  await ctx.newPage().then((p) => p.goto("https://www.linkedin.com/login"));
  await new Promise(() => {}); // stay open until Joe closes it
}
