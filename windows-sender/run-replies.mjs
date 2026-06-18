#!/usr/bin/env node
/**
 * ThinkBigJoe — reply poster (Windows, residential). Companion to run-sender.mjs.
 *
 * Posts the replies Joe APPROVED in Telegram. Polls `reply_drafts` for
 * status='approved' (final_text set), and for each opens the LinkedIn thread and
 * sends that message via a headless Claude session, then marks it 'sent' + pings.
 * Replies are to people who already messaged Joe (existing threads) — low risk —
 * so it posts promptly, capped per run. Task Scheduler runs it every few minutes.
 *
 * Run: node windows-sender/run-replies.mjs   (cwd = repo root; reads .env.local)
 */
import { spawn } from "node:child_process";
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const pick = (k) => (env.match(new RegExp(`^${k}="?([^"\\n\\r]+)"?`, "m")) || [])[1];
const conn = pick("DATABASE_URL") || pick("DATABASE_POSTGRES_URL");
const TG_TOKEN = pick("TELEGRAM_BOT_TOKEN");
const TG_CHAT = pick("TELEGRAM_CHAT_ID");
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const MAX_PER_RUN = Number(process.env.REPLIES_PER_RUN || 3);
if (!conn) { console.error("no DATABASE_URL"); process.exit(1); }
const sql = neon(conn);
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function telegram(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch (e) { log("tg err", e.message); }
}

function runClaude(name, url, msg) {
  const prompt = [
    `You are ThinkBigJoe's reply poster. Send ONE message in an existing LinkedIn conversation, nothing else.`,
    `Open your LinkedIn messages with ${name}${url ? ` (${url})` : ""} and send exactly this message:`,
    ``, msg, ``,
    `Rules: send only this one message to this one person. If you hit any captcha/verification/checkpoint, print exactly: SUMMARY: CHECKPOINT`,
    `If you can't open the thread or send, print: SUMMARY: SKIP <short reason>. If sent, print: SUMMARY: SENT. Print only that one SUMMARY line.`,
  ].join("\n");
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, ["-p", prompt, "--dangerously-skip-permissions"], { env: process.env });
    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); process.stdout.write(d); });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("close", () => resolve((out.match(/SUMMARY:\s*(SENT|CHECKPOINT|SKIP[^\n]*)/i) || [])[1]?.trim() || "UNKNOWN"));
    child.on("error", (e) => resolve(`ERROR ${e.message}`));
  });
}

async function main() {
  const rows = await sql`
    SELECT r.id, r.final_text, r.prospect_name, p.name AS pname, p.profile_url
      FROM reply_drafts r
      LEFT JOIN prospects p ON p.id = r.prospect_id
     WHERE r.status = 'approved' AND COALESCE(r.final_text,'') <> ''
     ORDER BY r.updated_at ASC
     LIMIT ${MAX_PER_RUN}`;
  if (!rows.length) return log("no approved replies — exit");

  for (const r of rows) {
    const name = r.pname || r.prospect_name;
    log(`posting reply to ${name}`);
    const result = await runClaude(name, r.profile_url, r.final_text);
    if (/^SENT/i.test(result)) {
      await sql`UPDATE reply_drafts SET status='sent', updated_at=now() WHERE id=${r.id}`;
      await telegram(`✅ <b>Reply sent</b> to ${name}.`);
    } else if (/^CHECKPOINT/i.test(result)) {
      await telegram(`⚠️ <b>LinkedIn checkpoint while replying to ${name}</b> — stopped. Check your account.`);
      break; // stop the run on a checkpoint
    } else {
      await telegram(`⚠️ Couldn't send reply to ${name} (${result}). Left approved — will retry / you can send manually.`);
    }
    await new Promise((r2) => setTimeout(r2, 4000));
  }
}

main().catch((e) => { log("crashed", e.message); telegram(`⚠️ Reply poster error: ${e.message}`); });
