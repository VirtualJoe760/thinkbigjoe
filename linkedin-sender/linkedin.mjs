/**
 * LinkedIn driver for the unattended sender. Page logic is identical to the old
 * local version — it just runs against the Browserbase-provided context (see
 * browserbase.mjs), which carries your login via a persistent Context.
 *
 * SAFETY: DRY_RUN=1 locates every control and stops BEFORE clicking Send — use it
 * to verify selectors against the current LinkedIn UI before going live. Aborts to
 * "CHECKPOINT" on any verification/checkpoint screen.
 */
export { withBrowser } from "./browserbase.mjs";

export const DRY_RUN = process.env.DRY_RUN === "1";
const jitter = (a, b) => a + Math.floor(Math.random() * (b - a));

function isCheckpoint(page) {
  return /checkpoint|\/uas\/|\/authwall|add-phone|verify|challenge/i.test(page.url());
}

async function ensureLoggedIn(page) {
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(jitter(1500, 3000));
  if (/\/login|\/authwall|signup/i.test(page.url())) throw new Error("NOT_LOGGED_IN");
  if (isCheckpoint(page)) throw new Error("CHECKPOINT");
}

/** Send ONE connection request with a note. Returns SENT | DRYRUN | SKIP <r> | CHECKPOINT. */
export async function sendConnection(ctx, profileUrl, note) {
  const page = await ctx.newPage();
  try {
    await ensureLoggedIn(page);
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
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
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
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
