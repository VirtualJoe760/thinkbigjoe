#!/usr/bin/env node
/**
 * ThinkBigJoe — LinkedIn drip-sender (runs on Joe's Windows machine, residential).
 *
 * Windows Task Scheduler runs this every ~10 min. It's the "brain": it reads the
 * dashboard config (automation_settings), self-gates on enabled / working days /
 * hours, paces against the daily ramp target, and — only when it's actually time
 * to send one — hands that single connection request to a headless Claude session
 * (`claude -p`) to click in the logged-in browser. Then it marks it + pings Telegram.
 *
 * Sending stays SUPERVISED + RESIDENTIAL by design: human-approved prospects only
 * (outreach.status = 'approved'), hard daily cap, paused prospects skipped, and it
 * disables itself + alerts you on any LinkedIn checkpoint.
 *
 * Run: node windows-sender/run-sender.mjs   (cwd = repo root; reads .env.local)
 */
import { spawn } from "node:child_process";
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

// --- env from .env.local (repo root) ---
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const pick = (k) => (env.match(new RegExp(`^${k}="?([^"\\n\\r]+)"?`, "m")) || [])[1];
const conn = pick("DATABASE_URL") || pick("DATABASE_POSTGRES_URL");
const TG_TOKEN = pick("TELEGRAM_BOT_TOKEN");
const TG_CHAT = pick("TELEGRAM_CHAT_ID");
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
if (!conn) { console.error("no DATABASE_URL"); process.exit(1); }
const sql = neon(conn);

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function telegram(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch (e) { log("telegram err", e.message); }
}

function todaysTarget(cfg) {
  if (!cfg.ramp_enabled || !cfg.ramp_started_on) return cfg.daily_goal;
  const start = new Date(cfg.ramp_started_on + "T00:00:00Z").getTime();
  const weeks = Math.max(0, Math.floor((Date.now() - start) / (7 * 864e5)));
  return Math.min(cfg.daily_goal, cfg.ramp_start + weeks * cfg.ramp_weekly_step);
}

function ptParts(tz) {
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now));
  const minute = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, minute: "2-digit" }).format(now));
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
  return { hour, minute, day };
}

function buildPrompt(name, url, note) {
  return [
    `You are ThinkBigJoe's prospecting sender. Send ONE LinkedIn connection request, nothing else.`,
    `Person: ${name}`,
    `Profile: ${url}`,
    `Open that profile, click Connect (it may be under the "More" / "..." menu), choose "Add a note", and paste this note EXACTLY:`,
    ``,
    note,
    ``,
    `Then click Send. Rules:`,
    `- Send to THIS person only. Do not message anyone else, do not send anything beyond this one invite.`,
    `- If you hit ANY captcha / verification / "unusual activity" / checkpoint screen: STOP immediately and print exactly: SUMMARY: CHECKPOINT`,
    `- If there's no Connect option (already pending, already connected, or restricted): print exactly: SUMMARY: SKIP <short reason>`,
    `- If the invite is sent successfully: print exactly: SUMMARY: SENT`,
    `Print only that one SUMMARY line at the end.`,
  ].join("\n");
}

function runClaude(name, url, note) {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, ["-p", buildPrompt(name, url, note), "--dangerously-skip-permissions"], { env: process.env });
    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); process.stdout.write(d); });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("close", () => {
      const m = out.match(/SUMMARY:\s*(SENT|CHECKPOINT|SKIP[^\n]*)/i);
      resolve(m ? m[1].trim() : "UNKNOWN");
    });
    child.on("error", (e) => resolve(`ERROR ${e.message}`));
  });
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

  // Even-drip pacing: only send if we're behind the pace for how far we are
  // through the work day (+30min lead so it starts promptly). Plus ~20% random
  // skip for human irregularity.
  const totalMin = (cfg.work_end_hour - cfg.work_start_hour) * 60;
  const elapsedMin = (hour - cfg.work_start_hour) * 60 + minute;
  const allowedByNow = Math.ceil(target * Math.min(1, (elapsedMin + 30) / totalMin));
  if (sentToday >= allowedByNow) return log(`on pace (${sentToday}/${allowedByNow} by now) — wait`);
  if (Math.random() < 0.2) return log("random pacing skip — wait");

  // Next human-APPROVED connection note, non-paused, public /in/ profile, best-fit first.
  const next = (await sql`
    SELECT o.id AS oid, o.body, p.id AS pid, p.name, p.profile_url
      FROM outreach o JOIN prospects p ON p.id = o.prospect_id
     WHERE o.step='connection' AND o.status='approved'
       AND COALESCE(p.paused,false)=false
       AND p.profile_url ILIKE '%linkedin.com/in/%'
     ORDER BY p.fit_score DESC NULLS LAST, o.id
     LIMIT 1`)[0];
  if (!next) return log("no approved prospects in queue — exit");

  log(`sending #${sentToday + 1}/${target}: ${next.name}`);
  const result = await runClaude(next.name, next.profile_url, next.body);

  if (/^SENT/i.test(result)) {
    await sql`UPDATE outreach SET status='sent', sent_at=now(), updated_at=now() WHERE id=${next.oid}`;
    await sql`UPDATE prospects SET status='connected', updated_at=now() WHERE id=${next.pid} AND status NOT IN ('replied','meeting','won')`;
    await telegram(`✅ <b>Connection request sent</b> — ${next.name} (${sentToday + 1}/${target} today)`);
    log("SENT");
  } else if (/^CHECKPOINT/i.test(result)) {
    await sql`UPDATE automation_settings SET enabled=false, updated_at=now() WHERE id=1`;
    await telegram(`⚠️ <b>LinkedIn checkpoint hit — automation PAUSED.</b>\nCheck your account, then re-enable in /command/automation.`);
    log("CHECKPOINT — paused automation");
  } else if (/^SKIP/i.test(result)) {
    await sql`UPDATE prospects SET paused=true, updated_at=now() WHERE id=${next.pid}`;
    await telegram(`⏭️ Skipped ${next.name}: ${result.replace(/^SKIP\s*/i, "")} (paused so it won't retry)`);
    log("SKIP", result);
  } else {
    await telegram(`⚠️ Send to ${next.name} returned no clear result (${result}). Left in queue.`);
    log("UNKNOWN result", result);
  }
}

main().catch((e) => { log("crashed", e.message); telegram(`⚠️ Sender error: ${e.message}`); });
