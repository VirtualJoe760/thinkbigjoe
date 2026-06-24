#!/usr/bin/env node
/**
 * ThinkBigJoe — LinkedIn drip-sender (cloud, Browserbase, Playwright).
 *
 * Run this on a schedule (GitHub Actions cron, Vercel cron, or any box — see README).
 * The "brain" is unchanged from the local version: reads the dashboard config
 * (automation_settings), self-gates on enabled / working days / hours, paces against the
 * daily ramp target, picks the next HUMAN-APPROVED prospect, and sends ONE connection
 * request — now by driving a cloud Chromium via Browserbase (login carried by a persistent
 * Context, residential proxy). Marks it + pings Telegram. Auto-pauses on a LinkedIn checkpoint.
 *
 * DRY_RUN=1 rehearses without clicking Send.
 */
import "./env.mjs";
import { neon } from "@neondatabase/serverless";
import { withBrowser, sendConnection, DRY_RUN } from "./linkedin.mjs";

const conn = process.env.DATABASE_URL || process.env.DATABASE_POSTGRES_URL;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
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

function todaysTarget(cfg) {
  if (!cfg.ramp_enabled || !cfg.ramp_started_on) return cfg.daily_goal;
  const start = new Date(cfg.ramp_started_on + "T00:00:00Z").getTime();
  const weeks = Math.max(0, Math.floor((Date.now() - start) / (7 * 864e5)));
  return Math.min(cfg.daily_goal, cfg.ramp_start + weeks * cfg.ramp_weekly_step);
}
function ptParts(tz) {
  const now = new Date();
  return {
    hour: Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now)),
    minute: Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, minute: "2-digit" }).format(now)),
    day: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now),
  };
}

async function main() {
  const cfg = (await sql`SELECT * FROM automation_settings WHERE id = 1`)[0];
  if (!cfg || !cfg.enabled) return log("disabled — exit");

  const { hour, minute, day } = ptParts(cfg.timezone);
  if (!cfg.work_days.split(",").map((d) => d.trim()).includes(day)) return log(`not a work day (${day}) — exit`);
  if (hour < cfg.work_start_hour || hour >= cfg.work_end_hour) return log(`outside hours (${hour}h) — exit`);

  const target = todaysTarget(cfg);
  const sentRows = await sql`SELECT count(*)::int AS n FROM outreach
    WHERE status='sent' AND sent_at >= date_trunc('day', now() AT TIME ZONE ${cfg.timezone}) AT TIME ZONE ${cfg.timezone}`;
  const sentToday = sentRows[0].n;
  if (sentToday >= target) return log(`target reached (${sentToday}/${target}) — exit`);

  const totalMin = (cfg.work_end_hour - cfg.work_start_hour) * 60;
  const elapsedMin = (hour - cfg.work_start_hour) * 60 + minute;
  const allowedByNow = Math.ceil(target * Math.min(1, (elapsedMin + 30) / totalMin));
  if (sentToday >= allowedByNow) return log(`on pace (${sentToday}/${allowedByNow}) — wait`);
  if (Math.random() < 0.2) return log("random pacing skip — wait");

  const next = (await sql`
    SELECT o.id AS oid, o.body, p.id AS pid, p.name, p.profile_url
      FROM outreach o JOIN prospects p ON p.id = o.prospect_id
     WHERE o.step='connection' AND o.status='approved'
       AND COALESCE(p.paused,false)=false
       AND p.profile_url ILIKE '%linkedin.com/in/%'
     ORDER BY p.fit_score DESC NULLS LAST, o.id
     LIMIT 1`)[0];
  if (!next) return log("no approved prospects in queue — exit");

  log(`${DRY_RUN ? "[DRY RUN] " : ""}sending #${sentToday + 1}/${target}: ${next.name}`);
  const result = await withBrowser((ctx) => sendConnection(ctx, next.profile_url, next.body));

  if (/^SENT/.test(result)) {
    await sql`UPDATE outreach SET status='sent', sent_at=now(), updated_at=now() WHERE id=${next.oid}`;
    await sql`UPDATE prospects SET status='connected', updated_at=now() WHERE id=${next.pid} AND status NOT IN ('replied','meeting','won')`;
    await telegram(`✅ <b>Connection request sent</b> — ${next.name} (${sentToday + 1}/${target} today)`);
    log("SENT");
  } else if (/^DRYRUN/.test(result)) {
    log("DRY RUN ok —", result, "(nothing sent)");
  } else if (/^CHECKPOINT/.test(result)) {
    await sql`UPDATE automation_settings SET enabled=false, updated_at=now() WHERE id=1`;
    await telegram(`⚠️ <b>LinkedIn checkpoint — automation PAUSED.</b>\nCheck your account, then re-enable in /command/automation.`);
    log("CHECKPOINT — paused automation");
  } else if (/^SKIP/.test(result)) {
    await sql`UPDATE prospects SET paused=true, updated_at=now() WHERE id=${next.pid}`;
    await telegram(`⏭️ Skipped ${next.name}: ${result.replace(/^SKIP\s*/, "")} (paused so it won't retry)`);
    log("SKIP", result);
  } else {
    await telegram(`⚠️ Send to ${next.name} unclear (${result}). Left in queue.`);
    log("UNKNOWN", result);
  }
}

main().catch((e) => { log("crashed", e.message); telegram(`⚠️ Sender error: ${e.message}`); });
