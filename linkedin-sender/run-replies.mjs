#!/usr/bin/env node
/**
 * ThinkBigJoe — reply poster (cloud, Browserbase, Playwright). Companion to run-sender.mjs.
 *
 * Posts the replies Joe APPROVED in Telegram. Polls `reply_drafts` for status='approved'
 * (final_text set), opens each LinkedIn thread via Browserbase and sends the message, then
 * marks it 'sent' + pings. Replies are to people who already messaged Joe (existing threads,
 * low risk) so it posts promptly, capped per run. DRY_RUN=1 rehearses.
 */
import "./env.mjs";
import { neon } from "@neondatabase/serverless";
import { withBrowser, sendMessage, DRY_RUN } from "./linkedin.mjs";

const conn = process.env.DATABASE_URL || process.env.DATABASE_POSTGRES_URL;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
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

async function main() {
  const rows = await sql`
    SELECT r.id, r.final_text, r.prospect_name, p.name AS pname, p.profile_url
      FROM reply_drafts r
      LEFT JOIN prospects p ON p.id = r.prospect_id
     WHERE r.status = 'approved' AND COALESCE(r.final_text,'') <> '' AND p.profile_url ILIKE '%linkedin.com/in/%'
     ORDER BY r.updated_at ASC
     LIMIT ${MAX_PER_RUN}`;
  if (!rows.length) return log("no approved replies (with a profile URL) — exit");

  await withBrowser(async (ctx) => {
    for (const r of rows) {
      const name = r.pname || r.prospect_name;
      log(`${DRY_RUN ? "[DRY RUN] " : ""}posting reply to ${name}`);
      const result = await sendMessage(ctx, r.profile_url, r.final_text);
      if (/^SENT/.test(result)) {
        await sql`UPDATE reply_drafts SET status='sent', updated_at=now() WHERE id=${r.id}`;
        await telegram(`✅ <b>Reply sent</b> to ${name}.`);
      } else if (/^DRYRUN/.test(result)) {
        log("DRY RUN ok —", result, "(nothing sent)");
      } else if (/^CHECKPOINT/.test(result)) {
        await telegram(`⚠️ <b>LinkedIn checkpoint while replying to ${name}</b> — stopped. Check your account.`);
        break;
      } else {
        await telegram(`⚠️ Couldn't send reply to ${name} (${result}). Left approved — will retry / send manually.`);
      }
      await new Promise((res) => setTimeout(res, 4000));
    }
  });
}

main().catch((e) => { log("crashed", e.message); telegram(`⚠️ Reply poster error: ${e.message}`); });
