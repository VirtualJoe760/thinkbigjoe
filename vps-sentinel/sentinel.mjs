#!/usr/bin/env node
/**
 * ThinkBigJoe — Reply Sentinel (runs on a small DigitalOcean droplet, 24/7).
 *
 * Watches Joe's Gmail (IMAP) for the notification emails LinkedIn ALREADY sends
 * — "X accepted your invitation", "X sent you a message" — and pings Telegram.
 * It NEVER logs into LinkedIn, so there's zero datacenter-IP ban risk and it's
 * fully within LinkedIn's ToS. Reuses the same @thinkbigjoe_alerts_bot.
 *
 * Env (set in the systemd unit or an env file — see .env.example):
 *   GMAIL_USER            the gmail address LinkedIn notifications land in   [required]
 *   GMAIL_APP_PASSWORD    a Gmail App Password (NOT the account password)    [required]
 *   TELEGRAM_BOT_TOKEN    same bot token as the site                         [required]
 *   TELEGRAM_CHAT_ID      Joe's chat id (6338621557)                         [required]
 *   MAILBOX               default "INBOX" (use "[Gmail]/All Mail" if filtered)
 *   POLL_MS               default 60000 (1 min)
 *   STATE_FILE            default ./.sentinel-state.json (tracks last seen UID)
 */
import { ImapFlow } from "imapflow";
import { readFileSync, writeFileSync } from "node:fs";

const {
  GMAIL_USER,
  GMAIL_APP_PASSWORD,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  MAILBOX = "INBOX",
  POLL_MS = "60000",
  STATE_FILE = "./.sentinel-state.json",
} = process.env;

for (const [k, v] of Object.entries({ GMAIL_USER, GMAIL_APP_PASSWORD, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID })) {
  if (!v) { console.error(`[sentinel] ${k} is required`); process.exit(1); }
}

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escapeHtml = (x) => (x || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function telegram(text) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) log("[sentinel] telegram failed:", await r.text().catch(() => ""));
  } catch (e) { log("[sentinel] telegram error:", e.message); }
}

function loadState() { try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return { lastUid: 0 }; } }
function saveState(s) { try { writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) { log("[sentinel] state save error:", e.message); } }

/** Turn a LinkedIn notification email into a Telegram alert (or null if not one). */
function stripName(n) {
  // LinkedIn prefixes the recipient ("Joseph, X accepted...") — strip that + trailing "has".
  return (n || "Someone").replace(/^(?:hi\s+)?joseph,?\s*/i, "").replace(/\s+has$/i, "").trim() || "Someone";
}

function classify(fromAddr, subject) {
  if (!(fromAddr || "").toLowerCase().includes("linkedin.com")) return null;
  const s = subject || "";

  if (/accepted your invitation|you are now connected|is now a connection|now connected/i.test(s)) {
    const name = stripName((s.match(/^(.*?)\s+(?:has\s+)?accepted your invitation/i) || [])[1]
      || (s.match(/(?:now connected (?:with|to)|connected with)\s+(.*)/i) || [])[1]
      || (s.match(/^(.*?)\s+is now a connection/i) || [])[1]);
    return {
      kind: "accepted",
      text: `✅ <b>${escapeHtml(name.trim())} accepted your connection request</b>\nThat's your opening — ask the one diagnostic question (no pitch). Open LinkedIn when ready.`,
    };
  }

  if (/sent you a message|replied to|messaged you|new message from|sent you the following|new inmail|sent you an inmail|inmail (?:message|from)/i.test(s)) {
    const name = stripName((s.match(/^(.*?)\s+sent you (?:a message|an inmail)/i) || [])[1]
      || (s.match(/(?:new message|new inmail|inmail) from\s+(.*)/i) || [])[1]
      || (s.match(/^(.*?)\s+replied/i) || [])[1]
      || (s.match(/^(.*?):/) || [])[1]);
    return {
      kind: "message",
      text: `💬 <b>${escapeHtml(name.trim())} replied on LinkedIn</b>\n<i>${escapeHtml(s)}</i>\n\nPaused — review and reply in LinkedIn yourself (we don't auto-reply into a live conversation).`,
    };
  }

  return null;
}

async function checkNew(client, state) {
  const lock = await client.getMailboxLock(MAILBOX);
  try {
    let max = state.lastUid;
    for await (const msg of client.fetch({ uid: `${state.lastUid + 1}:*` }, { envelope: true, uid: true })) {
      if (msg.uid <= state.lastUid) continue;
      if (msg.uid > max) max = msg.uid;
      const from = msg.envelope?.from?.[0]?.address || "";
      const subject = msg.envelope?.subject || "";
      const hit = classify(from, subject);
      if (hit) { log("[sentinel] HIT", hit.kind, "|", subject); await telegram(hit.text); }
    }
    if (max > state.lastUid) { state.lastUid = max; saveState(state); }
  } finally { lock.release(); }
}

async function run() {
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    logger: false,
  });
  await client.connect();
  log(`[sentinel] up — watching ${MAILBOX} for LinkedIn notifications as ${GMAIL_USER}`);

  const state = loadState();
  if (!state.lastUid) {
    // First run: baseline to "now" so we don't replay old emails.
    const lock = await client.getMailboxLock(MAILBOX);
    try { const st = await client.status(MAILBOX, { uidNext: true }); state.lastUid = (st.uidNext || 1) - 1; saveState(state); }
    finally { lock.release(); }
    await telegram("👀 Reply Sentinel online — watching for LinkedIn accepts & replies.");
  }

  // Poll loop (simple + robust). Gmail keeps the connection open between checks.
  while (true) {
    await checkNew(client, state);
    await sleep(Number(POLL_MS));
  }
}

(async function main() {
  while (true) {
    try { await run(); }
    catch (e) { log("[sentinel] crashed:", e.message); }
    await sleep(15000); // reconnect backoff
  }
})();
