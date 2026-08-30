#!/usr/bin/env node
/**
 * tbj-mcp — ThinkBigJoe MCP server for Venus (OpenClaw)
 *
 * Tools Venus can call:
 *   get_status               — pipeline counts (prospects, drafts, approved, sent, follow-ups)
 *   list_pending_replies     — reply_drafts awaiting Joe's approval
 *   handle_reply             — approve / pause / edit a pending reply draft
 *   save_inbound_reply       — record an inbound LinkedIn message + set prospect status='replied'
 *   save_reply_draft         — store Venus's drafted response for Joe's review in the leads page
 *   add_prospect             — add a researched prospect to the review queue
 *   add_forge_prospect       — add a local service business to the site-building forge queue
 *   list_forge_queue         — list forge queue businesses, optionally by status
 *   list_needs_enrichment    — prospects missing photo/email/GMB (paginated)
 *   check_outreach_window    — verify working hours / daily limit before sending
 *   update_prospect          — enrich an existing prospect with new recon data
 *   list_approved_for_outreach — find approved connection requests to send
 *   mark_sent                — record that a LinkedIn connection request was sent
 *   log_activity             — write a Venus cron event to activity_log
 *   schedule_followup        — schedule a follow-up touch for a connected prospect
 *   list_due_followups       — follow-up touches due today or overdue
 *   mark_followup_sent       — mark a follow-up touch as sent
 *   book_appointment         — book a strategy call via the venus-book API
 *
 * Reads DATABASE_URL from env (passed via OpenClaw mcp.servers config).
 * No Vercel deploy needed — runs locally on the Mac Mini.
 *
 * AUDIT TRAIL: every action tool calls audit() as a side effect of its real DB
 * write, so activity_log mirrors what ACTUALLY happened (metadata.auto = true),
 * independent of Venus's self-reported log_activity summaries. Reviewed at
 * /command/jobs (the audit log). See docs/VENUS_UI_MAPPING.md.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import pg from "pg";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Load thinkbigjoe/.env.local as an env FALLBACK so keys saved there (APIFY_API_KEY,
// etc.) are available to this server without duplicating them into openclaw.json.
// Values already in process.env (e.g. DATABASE_URL from the gateway) win.
try {
  for (const line of readFileSync(join(homedir(), "code/thinkbigjoe/.env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {
  /* .env.local not present — rely on gateway-provided env */
}

const { Pool } = pg;

// ---------------------------------------------------------------------------
// DB connection
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// audit() — tamper-evident action log. Called BY the action tools themselves,
// as a side effect of the real DB write, so the trail reflects what ACTUALLY
// happened — not whatever Venus reports in her end-of-cron summary. Rows are
// tagged metadata.auto = true to distinguish verified DB facts from Venus's
// manual log_activity rollups. Never throws: a logging failure must not break
// the underlying action.
// ---------------------------------------------------------------------------
async function audit(action, summary, { prospectId = null, target = null, detail = null, actor = "venus" } = {}) {
  try {
    await query(
      `INSERT INTO activity_log (actor, event_type, summary, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [actor, action, summary, JSON.stringify({ auto: true, prospectId, target, detail })],
    );
  } catch (err) {
    console.error(`[audit] failed to log ${action}:`, err?.message || err);
  }
}

// Is an agent paused from the dashboard? (agents.paused — set by the Pause/Resume
// control on /command/applications; survives roster sync.) The agent's cron may
// still fire, but its loop-entry tools honor this and stand down. Fail-open: a
// lookup error must not wedge the agent.
async function isAgentPaused(agentId) {
  try {
    const r = await query(`SELECT paused FROM agents WHERE id = $1`, [agentId]);
    return r.rows[0]?.paused === true;
  } catch {
    return false;
  }
}

// Text Joe (ALERT_SMS_TO) via Twilio — e.g. when Whitney finishes an application. Fail-open.
async function notifyJoeSms(body) {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, mgSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const to = normalizeUsPhone(process.env.ALERT_SMS_TO);
  if (!sid || !token || !mgSid || !to) return false;
  try {
    const form = new URLSearchParams({ MessagingServiceSid: mgSid, To: to, Body: String(body).slice(0, 1000) });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// Message Joe on Telegram — the org's escalation channel (same bot + chat Venus speaks
// through, so it reads to Joe as the org reaching out). Used when an agent is BLOCKED and
// the board alone isn't enough: a question sitting unseen is a stalled application. This is
// a relay, not a conversation — the agent still does all the thinking. Fail-open: a Telegram
// outage must never wedge the tool call that triggered it.
// WHICH BOT sends matters more than it looks. A Telegram chat id identifies the USER, but each
// bot has its OWN private conversation with that user — so the same chat id reached from two
// different bot tokens lands in two different threads. Joe talks to Venus in @Venus_JPSbot;
// .env.local's TELEGRAM_BOT_TOKEN is @thinkbigjoe_alerts_bot, a separate app-alert bot. Sending
// agent escalations from the alerts bot delivered them successfully into a thread Joe wasn't
// reading — "ok=true" and invisible. So: prefer OpenClaw's OWN telegram credentials (single
// source of truth, no secret duplicated into .env.local) and fall back to the alerts bot only if
// OpenClaw has none. App-side alerts in src/lib/telegram.ts stay on the alerts bot on purpose —
// those are from the app, not from Venus.
let _tgCreds;
function telegramCreds() {
  if (_tgCreds !== undefined) return _tgCreds;
  let token = null, chatId = null;
  try {
    const oc = JSON.parse(readFileSync(join(homedir(), ".openclaw/openclaw.json"), "utf8"));
    const tg = oc?.channels?.telegram;
    if (tg?.enabled !== false && tg?.botToken) {
      token = tg.botToken;
      const allow = Array.isArray(tg.allowFrom) ? tg.allowFrom : [];
      chatId = allow.length ? String(allow[0]) : null;
    }
  } catch {
    /* no OpenClaw config readable — fall through to env */
  }
  _tgCreds = {
    token: token || process.env.TELEGRAM_BOT_TOKEN || null,
    chatId: chatId || process.env.TELEGRAM_CHAT_ID || null,
  };
  return _tgCreds;
}

async function notifyJoeTelegram(text) {
  const { token, chatId } = telegramCreds();
  if (!token || !chatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(text).slice(0, 3800),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// Escape for Telegram's HTML parse_mode. Agent-authored question text is DATA — if it
// carries a stray < or &, an unescaped send fails outright and Joe silently never hears.
function tgEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// DAILY BUDGETS — the ceiling that survives a bad day.
//
// Cadence (the cron) controls how OFTEN an agent wakes. That is not a cap: one pathological
// day of long turns can still burn a week of quota. Since 2026-08-29 all three operating agents
// run on claude-cli/claude-sonnet-4-6, drawing the SAME Max weekly pool as Joe's interactive
// Claude Code and the forge's `claude -p` builds — so an agent overspending doesn't just cost
// money, it takes Joe's own tooling away from him. Hence a hard stop, enforced server-side at
// each agent's loop entry rather than trusted to the prompt.
//
// Turn counts come from activity_log, which every agent writes at the end of a run. That
// slightly UNDERCOUNTS (a turn that dies before logging isn't seen), so these are deliberately
// set below the cadence ceiling — they're a backstop, not the primary control.
// ---------------------------------------------------------------------------
// Per-agent overrides; anything not listed gets DEFAULT_TURN_CAP. A NEW agent is therefore
// budgeted the moment it exists — no code change needed to keep it from running away.
const DEFAULT_TURN_CAP = 8;
const DAILY_TURN_CAP = { whitney: 15, edward: 4, main: 4, destiny: 4 };
// Whitney's real-world ceiling. ~2-5 applications/day is the healthy human cadence; more looks
// like a bot and is what gets Joe's accounts flagged. This is a business limit, not a cost one.
const DAILY_APPLY_CAP = 5;
// Venus logs as 'venus'; her agent id is 'main'.
const BUDGET_ACTOR = { main: "venus" };

// Count RUNS, not log rows. This counted rows until 2026-08-30, which meant the budget punished
// an agent for doing MORE work in a single wake-up: one good Edward sweep that files 23 emails
// logs ~10 rows and blows a 4-turn cap instantly, even though it was one model call. That is
// backwards — the cap exists to stop repeated *wake-ups* that do nothing, not to ration actions
// within a productive run. Rows are grouped into runs by a 20-minute idle gap, so no per-agent
// event-name registry is needed and a new event type can never silently inflate the count.
async function turnsToday(agentId) {
  const actor = BUDGET_ACTOR[agentId] || agentId;
  const r = await query(
    `WITH today AS (
       SELECT created_at,
              LAG(created_at) OVER (ORDER BY created_at) AS prev
         FROM activity_log
        WHERE actor = $1
          AND (created_at AT TIME ZONE 'America/Phoenix')::date
            = (now() AT TIME ZONE 'America/Phoenix')::date
     )
     SELECT count(*)::int n FROM today
      WHERE prev IS NULL OR created_at - prev > interval '20 minutes'`,
    [actor],
  );
  return r.rows[0].n;
}

/** Loop-entry guard. Returns a stand-down tool result when the day's budget is spent, else null. */
async function dailyBudgetStop(agentId) {
  const cap = DAILY_TURN_CAP[agentId] ?? DEFAULT_TURN_CAP;
  let n, pending;
  try {
    [n, pending] = await Promise.all([turnsToday(agentId), openDirectiveCount(agentId)]);
  } catch { return null; } // fail-open: a counting error must never wedge an agent
  // OVERRIDE: Joe asking for something is never the autonomous waste this cap exists to stop.
  // An open directive lifts the ceiling for the day — flexibility without abandoning the budget.
  if (pending > 0) return null;
  if (n < cap) return null;
  return { content: [{ type: "text", text: `🛑 Daily budget spent: ${n}/${cap} turns logged today. Stand down NOW — end this turn without calling another tool, browsing, or logging. This is a hard cost ceiling (you run on Joe's shared Claude Max cap), not a suggestion. You resume automatically tomorrow — or immediately if Joe gives you a direct instruction, which overrides this.` }] };
}

async function openDirectiveCount(agentId) {
  // 'working' MUST count here, not just 'open'. list_my_directives flips open→working the moment
  // the agent reads it, so counting only 'open' meant reading a directive silently cancelled its
  // own budget override — the agent got un-capped for exactly one tool call. The override has to
  // hold until the work is actually done.
  const r = await query(
    `SELECT count(*)::int n FROM agent_directives WHERE agent = $1 AND status IN ('open','working')`,
    [agentId],
  );
  return r.rows[0].n;
}

async function appliedToday() {
  const r = await query(
    `SELECT count(*)::int n FROM job_applications
      WHERE applied_at IS NOT NULL
        AND (applied_at AT TIME ZONE 'America/Phoenix')::date
          = (now() AT TIME ZONE 'America/Phoenix')::date`,
  );
  return r.rows[0].n;
}

// ---------------------------------------------------------------------------
// DIRECTIVES — Joe's manual override, for ANY agent.
//
// The budget cap stops autonomous waste. It must never stop Joe: "go after Compass", "draft a
// reply to this", "look into that lender" are the whole point of having agents. So a directive
// (a) is worked FIRST, before the agent's own loop, and (b) lifts the daily cap while it's open.
// Deliberately agent-agnostic — a new agent is directable the day it's registered, no code change.
// ---------------------------------------------------------------------------
async function toolListMyDirectives({ agent }) {
  if (!agent) return { content: [{ type: "text", text: "❌ agent is required — pass your own agent id." }], isError: true };
  const r = await query(
    `SELECT id, request, context, created_at FROM agent_directives
      WHERE agent = $1 AND status IN ('open','working') ORDER BY created_at ASC LIMIT 10`,
    [agent],
  );
  if (!r.rows.length) {
    return { content: [{ type: "text", text: "📭 No direct instructions from Joe. Work your normal loop." }] };
  }
  await query(`UPDATE agent_directives SET status='working', started_at=COALESCE(started_at, now()) WHERE agent=$1 AND status='open'`, [agent]);
  const lines = [`📌 **${r.rows.length} direct instruction(s) from Joe — these come FIRST, before your normal loop:**`, ""];
  for (const d of r.rows) {
    lines.push(`**#${d.id}** — ${d.request}`);
    if (d.context) lines.push(`Context: ${d.context}`);
    lines.push("");
  }
  lines.push("_Work these to completion, then **complete_directive** each with what you actually did. While one is open your daily budget cap is lifted, so don't rush — but don't wander either: do what he asked, not what's adjacent to it. If you genuinely can't do it, complete it anyway and say why._");
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolCompleteDirective({ id, result }) {
  if (!Number.isFinite(Number(id))) return { content: [{ type: "text", text: "❌ id is required (from list_my_directives)." }], isError: true };
  const r = await query(
    `UPDATE agent_directives SET status='done', result=$2, completed_at=now()
      WHERE id=$1 AND status IN ('open','working') RETURNING agent, request`,
    [id, result || null],
  );
  if (!r.rows.length) return { content: [{ type: "text", text: `❌ No open directive #${id}.` }], isError: true };
  await audit("agent_directive_done", `${r.rows[0].agent} finished Joe's instruction: ${String(r.rows[0].request).slice(0, 120)}`, {
    actor: r.rows[0].agent, detail: { directive_id: Number(id), result: result || null },
  });
  return { content: [{ type: "text", text: `✅ Directive #${id} marked done. Joe sees your result on the board.` }] };
}

// The review board's opportunity cap — how many 'found' roles can wait for Joe at once.
// Rolling: Whitney stops finding at the cap and resumes once Joe works the queue below it.
const REVIEW_CAP = 25;

// DIRECTED finds get their own, separate allowance. The general cap exists to stop Whitney
// spraying — indiscriminate searching that costs tokens and puts traffic on Joe's job-board
// identity. A role at an employer JOE NAMED is not that: naming it is already the human
// judgement the cap is waiting for. So a full board must not block "go look at Anthropic".
// It's still capped, just separately, so a directed run can't run away either.
const DIRECTED_CAP = 20;

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------
const VERTICAL_LABEL = {
  insurance: "insurance agencies",
  mortgage: "mortgage / lending",
  wealth: "wealth management",
  msp: "MSP / IT services",
  law: "law firms",
  other: "general",
};

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------
async function toolGetStatus() {
  const [prospects, drafts, approvedWaiting, sentWeek, followupsDue] = await Promise.all([
    query(`SELECT count(*)::int AS n FROM prospects`),
    query(`SELECT count(*)::int AS n FROM outreach WHERE status = 'draft'`),
    query(`SELECT count(*)::int AS n FROM outreach WHERE step = 'connection' AND status = 'approved'`),
    query(`SELECT count(*)::int AS n FROM outreach WHERE status = 'sent' AND sent_at > now() - interval '7 days'`),
    query(`SELECT count(*)::int AS n FROM follow_ups WHERE status = 'pending' AND scheduled_for <= now()`),
  ]);
  const lines = [
    `📊 ThinkBigJoe Pipeline`,
    `• Prospects in DB: **${prospects.rows[0].n}**`,
    `• Drafts awaiting review: **${drafts.rows[0].n}**`,
    `• Approved connections ready to send: **${approvedWaiting.rows[0].n}**`,
    `• Sent this week: **${sentWeek.rows[0].n}**`,
    `• Follow-ups due now: **${followupsDue.rows[0].n}**`,
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolListPendingReplies() {
  const res = await query(
    `SELECT rd.id, rd.prospect_name, rd.their_message, rd.draft, rd.created_at,
            p.title, p.company, p.vertical
     FROM reply_drafts rd
     LEFT JOIN prospects p ON p.id = rd.prospect_id
     WHERE rd.status = 'awaiting'
     ORDER BY rd.created_at ASC`,
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "No pending reply drafts — inbox is clear." }] };
  }
  const lines = [`💬 **${res.rows.length} pending reply draft(s):**`, ""];
  for (const r of res.rows) {
    const who = [r.prospect_name, r.title, r.company, r.vertical ? VERTICAL_LABEL[r.vertical] || r.vertical : null]
      .filter(Boolean).join(" · ");
    lines.push(`**#${r.id} — ${who}**`);
    lines.push(`Their message: _${r.their_message?.slice(0, 300)}_`);
    lines.push(`Suggested reply: ${r.draft?.slice(0, 400)}`);
    lines.push("");
  }
  lines.push('Use handle_reply with the draft id and action "send", "pause", or provide your own text.');
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolHandleReply({ draft_id, action }) {
  const existing = await query(
    `SELECT id, prospect_name, draft, status FROM reply_drafts WHERE id = $1`,
    [draft_id],
  );
  if (!existing.rows.length) {
    return { content: [{ type: "text", text: `Draft #${draft_id} not found.` }] };
  }
  const row = existing.rows[0];
  if (row.status !== "awaiting") {
    return { content: [{ type: "text", text: `Draft #${draft_id} is already ${row.status} — nothing to do.` }] };
  }
  const lower = (action || "").toLowerCase().trim();
  if (/^(pause|skip|stop|hold|mute|ignore|no)\b/.test(lower)) {
    await query(`UPDATE reply_drafts SET status = 'paused', updated_at = now() WHERE id = $1`, [draft_id]);
    await query(`UPDATE prospects SET paused = true, updated_at = now() WHERE id = (SELECT prospect_id FROM reply_drafts WHERE id = $1)`, [draft_id]);
    await audit("reply_paused", `Paused reply thread for ${row.prospect_name}`, {
      target: row.prospect_name,
      detail: { draftId: draft_id },
    });
    return { content: [{ type: "text", text: `⏸ Paused draft #${draft_id} for ${row.prospect_name} — nothing sent, that thread is muted.` }] };
  }
  const finalText = /^(send|yes|go|approve|ok|sure|send it)\b/.test(lower) ? row.draft : action;
  await query(
    `UPDATE reply_drafts SET status = 'approved', final_text = $1, updated_at = now() WHERE id = $2`,
    [finalText, draft_id],
  );
  await audit("reply_approved", `Approved reply to ${row.prospect_name}`, {
    target: row.prospect_name,
    detail: { draftId: draft_id, finalText },
  });
  return {
    content: [{
      type: "text",
      text: `✅ Approved reply for ${row.prospect_name}:\n_${finalText?.slice(0, 300)}_\n\nThe Windows sender will post it shortly.`,
    }],
  };
}

// ---------------------------------------------------------------------------
// save_inbound_reply — record an inbound LinkedIn message, move prospect to 'replied',
//   return full conversation thread so Venus can draft a contextual response.
// ---------------------------------------------------------------------------
async function toolSaveInboundReply({ prospect_id, prospect_name, message, platform = "linkedin" }) {
  if (!prospect_name || !message) {
    return { content: [{ type: "text", text: "prospect_name and message are required." }] };
  }

  let pid = prospect_id ? Number(prospect_id) : null;

  // Resolve prospect by ID or name lookup
  if (!pid && prospect_name) {
    const found = await query(
      `SELECT id FROM prospects WHERE lower(name) = lower($1) LIMIT 1`,
      [prospect_name.trim()],
    );
    if (found.rows.length) pid = found.rows[0].id;
  }

  if (!pid) {
    return { content: [{ type: "text", text: `Could not find prospect "${prospect_name}" in the DB. Add them with add_prospect first.` }] };
  }

  // Save inbound message
  await query(
    `INSERT INTO conversations (prospect_id, direction, body, platform) VALUES ($1, 'inbound', $2, $3)`,
    [pid, message.trim(), platform],
  );

  // Move to 'replied' unless already further along
  await query(
    `UPDATE prospects SET status = 'replied', updated_at = now()
     WHERE id = $1 AND status NOT IN ('invited','prepped','meeting','won','lost','disqualified')`,
    [pid],
  );

  await audit("reply_received", `Inbound reply from ${prospect_name}`, {
    prospectId: pid,
    target: prospect_name,
    detail: { message: message.trim(), platform },
  });

  // Return last 10 messages for context
  const thread = await query(
    `SELECT direction, body, created_at FROM conversations
     WHERE prospect_id = $1 ORDER BY created_at ASC LIMIT 10`,
    [pid],
  );

  const history = thread.rows.map((r) => `[${r.direction}] ${r.body}`).join("\n");
  return {
    content: [{
      type: "text",
      text: [
        `✅ Saved inbound reply for prospect #${pid} (${prospect_name}). Status → replied.`,
        ``,
        `Conversation history (${thread.rows.length} messages):`,
        history,
        ``,
        `Draft your response and call save_reply_draft with prospect_id=${pid}, prospect_name, their original message, and your draft text.`,
      ].join("\n"),
    }],
  };
}

// ---------------------------------------------------------------------------
// save_reply_draft — store Venus's drafted LinkedIn response for Joe to review
//   in the Leads page before it's sent. Joe approves or edits in the UI.
// ---------------------------------------------------------------------------
async function toolSaveReplyDraft({ prospect_id, prospect_name, their_message, draft }) {
  if (!prospect_name || !their_message || !draft) {
    return { content: [{ type: "text", text: "prospect_name, their_message, and draft are required." }] };
  }
  const pid = prospect_id ? Number(prospect_id) : null;
  const res = await query(
    `INSERT INTO reply_drafts (prospect_id, prospect_name, their_message, draft, status)
     VALUES ($1, $2, $3, $4, 'awaiting')
     RETURNING id`,
    [pid, prospect_name.trim(), their_message.trim(), draft.trim()],
  );
  const id = res.rows[0]?.id;
  await audit("reply_drafted", `Drafted reply to ${prospect_name}`, {
    prospectId: pid,
    target: prospect_name,
    detail: { theirMessage: their_message.trim(), draft: draft.trim() },
  });
  return {
    content: [{
      type: "text",
      text: [
        `✅ Reply draft #${id} saved for ${prospect_name} — status: awaiting Joe's review.`,
        `Joe will see it in the Leads page at thinkbigjoe.com/command/leads and can approve or edit before it's sent.`,
        `Do NOT send this on LinkedIn yourself — wait for Joe's approval.`,
      ].join("\n"),
    }],
  };
}

async function toolAddProspect({
  name, title, company, vertical, location, profile_url,
  fit_score, fit_reason, hook, source = "venus_scout",
  website_url, photo_url, email, phone,
  website_status, website_rating, website_notes,
  sales_opportunities = [],
}) {
  const existing = profile_url
    ? await query(`SELECT id FROM prospects WHERE profile_url = $1 LIMIT 1`, [profile_url])
    : { rows: [] };
  if (existing.rows.length) {
    return { content: [{ type: "text", text: `⚠️ ${name} is already in the DB (duplicate URL).` }] };
  }

  const opportunities = Array.isArray(sales_opportunities)
    ? sales_opportunities.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 5)
    : String(sales_opportunities || "").trim()
      ? [String(sales_opportunities).trim()]
      : [];

  const rating = Number(website_rating);
  const recon = {
    websiteUrl: String(website_url || "").trim(),
    photoUrl: String(photo_url || "").trim(),
    email: String(email || "").trim(),
    phone: String(phone || "").trim(),
    websiteStatus: String(website_status || "").trim(),
    websiteRating: Number.isFinite(rating) ? Math.max(1, Math.min(10, Math.round(rating))) : null,
    websiteNotes: String(website_notes || "").trim(),
    salesOpportunities: opportunities,
  };

  const res = await query(
    `INSERT INTO prospects (name, title, company, vertical, location, profile_url, fit_score, fit_reason, hook, source, recon, status, paused)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, 'new', false)
     RETURNING id`,
    [name, title, company, vertical, location, profile_url, fit_score, fit_reason, hook, source, JSON.stringify(recon)],
  );
  const prospect_id = res.rows[0].id;
  await query(
    `INSERT INTO outreach (prospect_id, step, status, body) VALUES ($1, 'connection', 'draft', $2)`,
    [prospect_id, hook],
  );
  await audit("prospect_added", `Added ${name}${company ? ` · ${company}` : ""}`, {
    prospectId: prospect_id,
    target: name,
    detail: { company, vertical, source, fitScore: fit_score },
  });
  return { content: [{ type: "text", text: `✅ Added ${name} from ${company} to the review queue.` }] };
}

// ---------------------------------------------------------------------------
// Apify — structured scraping so the prospector gets clean JSON instead of
// reading rendered pages (far fewer tokens, more reliable). Uses the
// run-sync-get-dataset-items endpoint (blocks until the run finishes).
// ---------------------------------------------------------------------------
const APIFY_TOKEN = process.env.APIFY_API_KEY;

async function runApifyActor(actorSlug, input, timeoutMs = 240000) {
  if (!APIFY_TOKEN) return { error: "APIFY_API_KEY is not set (save it in thinkbigjoe/.env.local)." };
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${actorSlug}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!res.ok) return { error: `Apify ${actorSlug} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { items: await res.json() };
  } catch (err) {
    return { error: `Apify ${actorSlug} failed: ${err?.message || err}` };
  }
}

async function toolApifyFindBusinesses({ query, location, max = 30 } = {}) {
  if (!query || !location) return { content: [{ type: "text", text: "Need `query` (a trade, e.g. 'plumber') and `location` (e.g. 'Denver, CO')." }] };
  const n = Math.max(1, Math.min(120, Number(max) || 30));
  const { items, error } = await runApifyActor("compass~crawler-google-places", {
    searchStringsArray: [String(query)], locationQuery: String(location),
    maxCrawledPlacesPerSearch: n, language: "en", skipClosedPlaces: true,
  });
  if (error) return { content: [{ type: "text", text: `❌ ${error}` }] };
  if (!items?.length) return { content: [{ type: "text", text: `No Google Maps results for "${query}" in ${location}.` }] };
  const lines = [`🗺️ **${items.length} businesses** — "${query}" in ${location} (Google Maps via Apify):`, ""];
  for (const b of items) {
    const mapsUrl = b.url || (b.placeId ? `https://www.google.com/maps/place/?q=place_id:${b.placeId}` : "");
    lines.push(`- **${b.title}** · ${b.categoryName || "—"} · ${[b.city, b.state].filter(Boolean).join(", ")}`);
    lines.push(`   website: ${b.website || "❌ NONE ← strong lead"} · phone: ${b.phone || "—"} · ${b.totalScore ? `${b.totalScore}★ (${b.reviewsCount || 0})` : "no rating"}`);
    lines.push(`   address: ${b.address || "—"}${mapsUrl ? ` · maps: ${mapsUrl}` : ""}`);
  }
  lines.push("", `Leads = businesses with NO website (or one you open and rate ≤4). For each keeper: pull contacts (apify_extract_contacts on their site, and/or apify_find_instagram) then add_forge_prospect with owner/email/socials. Skip any with a solid modern site.`);
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolApifyFindInstagram({ search, max = 20 } = {}) {
  if (!search) return { content: [{ type: "text", text: "Need `search` — a trade + city (e.g. 'phoenix plumber') or a hashtag." }] };
  const n = Math.max(1, Math.min(50, Number(max) || 20));
  const { items, error } = await runApifyActor("apify~instagram-scraper", {
    search: String(search), searchType: "user", resultsType: "details", resultsLimit: n, addParentData: false,
  });
  if (error) return { content: [{ type: "text", text: `❌ ${error}` }] };
  if (!items?.length) return { content: [{ type: "text", text: `No Instagram accounts found for "${search}".` }] };
  const lines = [`📸 **${items.length} Instagram accounts** for "${search}":`, ""];
  for (const p of items) {
    const handle = p.username || p.ownerUsername;
    if (!handle) continue;
    const site = p.externalUrl || p.external_url || "";
    const email = p.businessEmail || p.public_email || p.email || "";
    const followers = p.followersCount ?? p.followers ?? "?";
    const isBiz = p.isBusinessAccount ?? p.is_business_account;
    lines.push(`- **@${handle}**${p.fullName ? ` (${p.fullName})` : ""}${isBiz ? " · business acct" : ""} · ${followers} followers`);
    lines.push(`   website in bio: ${site || "❌ NONE ← lead (runs off Instagram)"} · email: ${email || "—"}${p.businessPhoneNumber ? ` · phone: ${p.businessPhoneNumber}` : ""}`);
    if (p.biography) lines.push(`   bio: ${String(p.biography).replace(/\s+/g, " ").slice(0, 120)}`);
  }
  lines.push("", `PRIME leads = business accounts with NO website in the bio (or just a linktree/Facebook) — they clearly invest in their presence but have no site. For each: instagram_url = https://instagram.com/<handle>, grab the bio email, then add_forge_prospect.`);
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolApifyExtractContacts({ url } = {}) {
  if (!url) return { content: [{ type: "text", text: "Need `url` — the business's website." }] };
  const { items, error } = await runApifyActor("vdrmota~contact-info-scraper", { startUrls: [{ url: String(url) }], maxDepth: 2, maxRequestsPerStartUrl: 10 }, 180000);
  if (error) return { content: [{ type: "text", text: `❌ ${error}` }] };
  const it = items?.[0];
  if (!it) return { content: [{ type: "text", text: `No contact info found at ${url}.` }] };
  const g = (a) => (Array.isArray(a) ? a.filter(Boolean) : []);
  const emails = g(it.emails), phones = g(it.phones), ig = g(it.instagrams), fb = g(it.facebooks), li = g(it.linkedIns), tw = g(it.twitters), yt = g(it.youtubes);
  const lines = [
    `📇 **Contacts scraped from ${url}:**`,
    `   emails: ${emails.join(", ") || "none"}`,
    `   phones: ${phones.join(", ") || "none"}`,
    `   instagram: ${ig.join(", ") || "none"} · facebook: ${fb.join(", ") || "none"} · linkedin: ${li.join(", ") || "none"}`,
  ];
  if (tw.length || yt.length) lines.push(`   other: ${[...tw, ...yt].join(", ")}`);
  lines.push("", `Feed what you found into enrich_forge_contact / add_forge_prospect. Sanity-check an email looks real (not a stock/placeholder) before saving.`);
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function slugifyBusinessName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Bare hostname of a URL (no scheme, no www), or null. */
function hostOf(url) {
  const u = String(url || "").trim();
  if (!u) return null;
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function toolAddForgeProspect({
  business_name, niche, city, service_area, phone, email,
  existing_website_url, brand_color, fit_reason, source = "venus_forge_scout", notes,
  google_rating, review_count, google_maps_url, linkedin_url,
  owner_name, instagram_url, facebook_url,
}) {
  const slug = slugifyBusinessName(business_name);
  if (!slug) {
    return { content: [{ type: "text", text: `❌ Could not derive a slug from business_name "${business_name}".` }] };
  }
  const existing = await query(`SELECT id FROM forge_sites WHERE slug = $1 LIMIT 1`, [slug]);
  if (existing.rows.length) {
    return { content: [{ type: "text", text: `⚠️ ${business_name} is already in the forge queue (slug: ${slug}).` }] };
  }
  // Blacklist guard — Joe denied this business before; never re-add / re-crawl it.
  // Match on normalized name+city OR the existing site's domain (name may be reworded).
  const normKey = `${slug}|${slugifyBusinessName(city)}`;
  const domain = hostOf(existing_website_url);
  const blocked = await query(
    `SELECT reason FROM forge_blacklist WHERE norm_key = $1 OR (domain IS NOT NULL AND domain = $2) LIMIT 1`,
    [normKey, domain],
  );
  if (blocked.rows.length) {
    await audit("forge_prospect_blacklisted", `Skipped blacklisted business ${business_name} (${city || "?"})`, {
      target: slug,
      detail: { city, reason: blocked.rows[0].reason || "denied" },
    });
    return { content: [{ type: "text", text: `🚫 ${business_name} (${city || "?"}) is BLACKLISTED (previously denied${blocked.rows[0].reason ? `: ${blocked.rows[0].reason}` : ""}). Not added — do not research it again.` }] };
  }
  const res = await query(
    `INSERT INTO forge_sites (slug, business_name, niche, city, service_area, phone, email, existing_website_url, brand_color, google_rating, review_count, google_maps_url, linkedin_url, owner_name, instagram_url, facebook_url, fit_reason, source, notes, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 'discovered')
     RETURNING id`,
    [slug, business_name, niche, city, service_area, phone, email, existing_website_url, brand_color, google_rating, review_count, google_maps_url, linkedin_url, owner_name, instagram_url, facebook_url, fit_reason, source, notes],
  );
  const site_id = res.rows[0].id;
  const channels = [email && "email", phone && "phone", owner_name && "owner", instagram_url && "IG", facebook_url && "FB", linkedin_url && "LinkedIn"].filter(Boolean);
  await audit("forge_prospect_added", `Added ${business_name}${niche ? ` · ${niche}` : ""} to forge queue`, {
    target: slug,
    detail: { city, niche, source, fitReason: fit_reason, channels },
  });
  return { content: [{ type: "text", text: `✅ Added ${business_name} (slug: ${slug}) — channels: ${channels.join(", ") || "none yet"}. Awaiting Joe's approval to build. [id ${site_id}]` }] };
}

async function toolListForgeQueue({ status } = {}) {
  const cols = `id, slug, business_name, niche, city, status, live_url, claim_code, claimed_by_user_id, created_at`;
  const res = status
    ? await query(
        `SELECT ${cols}
         FROM forge_sites WHERE status = $1 ORDER BY created_at DESC LIMIT 100`,
        [status],
      )
    : await query(
        `SELECT ${cols}
         FROM forge_sites ORDER BY created_at DESC LIMIT 100`,
      );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: status ? `No forge_sites with status '${status}'.` : "Forge queue is empty." }] };
  }
  const lines = [`🏗️ **${res.rows.length} forge site(s)${status ? ` · status=${status}` : ""}:**`, ""];
  for (const r of res.rows) {
    // claim_code is the code the owner redeems at thinkbigjoe.com/portal/claim to
    // take ownership — include it in outreach to a built (unclaimed) site.
    const claim = r.claimed_by_user_id
      ? " · ✓ claimed"
      : r.claim_code
        ? ` · claim code: ${r.claim_code}`
        : "";
    lines.push(`**#${r.id} ${r.business_name}** (${r.slug}) · ${r.niche || "—"} · ${r.city || "—"} · status: ${r.status}${r.live_url ? ` · ${r.live_url}` : ""}${claim}`);
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolListForgeBlacklist() {
  const res = await query(
    `SELECT business_name, city, domain, reason FROM forge_blacklist ORDER BY created_at DESC LIMIT 200`,
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "Blacklist is empty — no businesses to avoid yet." }] };
  }
  const lines = [`🚫 **${res.rows.length} blacklisted business(es)** — do NOT research or add these:`, ""];
  for (const r of res.rows) {
    lines.push(`- ${r.business_name}${r.city ? ` · ${r.city}` : ""}${r.domain ? ` · ${r.domain}` : ""}${r.reason ? ` — ${r.reason}` : ""}`);
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

const APP_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_URL || "https://thinkbigjoe.com";

async function toolListForgeOutreachQueue({ status } = {}) {
  const stage = status || "none";
  // Built + unclaimed sites at this outreach stage. A missing claim_code means the
  // register step didn't verify it live, so those aren't ready — require it.
  const res = await query(
    `SELECT id, slug, business_name, niche, city, service_area, owner_name, email, phone, live_url, claim_code,
            google_rating, review_count, instagram_url, facebook_url, linkedin_url
     FROM forge_sites
     WHERE status = 'built' AND claim_code IS NOT NULL AND claimed_by_user_id IS NULL
       AND marketing_approved_at IS NOT NULL   -- only leads Joe approved for marketing
       AND outreach_status = $1
     ORDER BY built_at DESC NULLS LAST, created_at DESC
     LIMIT 50`,
    [stage],
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: `No built, unclaimed sites with outreach_status='${stage}'. Nothing to draft.` }] };
  }
  const lines = [
    `📣 **${res.rows.length} built site(s) ready for FIRST-TOUCH** (stage=${stage}):`,
    "",
    `Links to weave into every message:`,
    `  • sign in & claim: ${APP_SITE_URL}/portal/claim  (they enter the claim code after signing in)`,
    `  • book a call with Joe: ${APP_SITE_URL}/book-appointment`,
    "",
  ];
  for (const r of res.rows) {
    const rating = r.google_rating ? ` · ${r.google_rating}★${r.review_count ? ` (${r.review_count})` : ""}` : "";
    const socials = [r.instagram_url && `IG:${r.instagram_url}`, r.facebook_url && `FB:${r.facebook_url}`, r.linkedin_url && `LinkedIn:${r.linkedin_url}`].filter(Boolean);
    lines.push(`**#${r.id} ${r.business_name}**${r.owner_name ? ` · owner ${r.owner_name}` : ""} · ${r.niche || "—"} · ${r.city || r.service_area || "—"}${rating}`);
    lines.push(`   live site: ${r.live_url || "(none)"} · claim code: ${r.claim_code}`);
    lines.push(`   channels → email: ${r.email || "(none)"}${r.phone ? ` · phone: ${r.phone}` : ""}${socials.length ? ` · ${socials.join(" · ")}` : ""}`);
    lines.push("");
  }
  lines.push(
    `You do the FIRST TOUCH; Joe CALLS them second. For each site, message the owner on the BEST channel available:\n` +
      `  • Has an EMAIL → call save_forge_outreach_draft(site_id, "email", subject, body). Joe reviews + sends.\n` +
      `  • No email but a SOCIAL (Instagram/Facebook/LinkedIn) → call save_forge_outreach_draft(site_id, channel, "", body) with a short DM, Joe reviews it, you send the DM on that platform, then call mark_forge_outreach_sent(site_id, channel).\n` +
      `  • No email or social → leave it; its phone is on Joe's contact card to call.\n` +
      `Keep it warm and short: their new site is live (link it), the claim code to take ownership, and an invite to talk. Never invent contact info.`,
  );
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

const OUTREACH_CHANNELS = ["email", "instagram", "facebook", "linkedin", "sms"];

async function toolListForgePreviewOutreach({ status } = {}) {
  const stage = status || "none";
  // GOAL-AWARE PACING: the outreach engine sets a daily first-touch GOAL so token spend is flat.
  // Only hand back up to (daily_goal - drafted today) so the agent never over-drafts in a run.
  const cfg = (await query(`SELECT daily_goal, enabled FROM outreach_engine WHERE id = 1`)).rows[0] || { daily_goal: 25, enabled: true };
  if (!cfg.enabled) {
    return { content: [{ type: "text", text: "Outreach is paused (outreach_engine.enabled=false). Nothing to draft." }] };
  }
  const goal = Number(cfg.daily_goal) || 25;
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const draftedToday = Number(
    (await query(`SELECT count(*) n FROM activity_log WHERE event_type = 'forge_outreach_drafted' AND created_at >= $1`, [dayStart.toISOString()])).rows[0].n,
  );
  const remaining = Math.max(0, goal - draftedToday);
  if (remaining === 0) {
    return { content: [{ type: "text", text: `Today's outreach goal met — ${draftedToday}/${goal} first-touches drafted. Rest until tomorrow.` }] };
  }
  const limit = Math.min(remaining, 50);

  // SHOWROOM outreach: prospects with a personalized PREVIEW ready (not yet built/claimed).
  // The message invites the owner to CLAIM the preview — which triggers the real build.
  const res = await query(
    `SELECT id, slug, business_name, niche, city, service_area, owner_name, email, phone, claim_code,
            google_rating, review_count, instagram_url, facebook_url, linkedin_url, preview_expires_at
     FROM forge_sites
     WHERE preview IS NOT NULL AND claim_code IS NOT NULL AND claimed_by_user_id IS NULL
       AND status = 'discovered'
       AND outreach_status = $1
     ORDER BY (marketing_approved_at IS NOT NULL) DESC, NULLIF(review_count,'')::int DESC NULLS LAST, preview_generated_at DESC NULLS LAST
     LIMIT $2`,
    [stage, limit],
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: `No preview-ready prospects with outreach_status='${stage}'. Generate previews first (preview-engine / generate_forge_preview).` }] };
  }
  const lines = [
    `🖼️ **${res.rows.length} preview(s) to first-touch now** — today's goal ${draftedToday}/${goal}, ${remaining} left (stage=${stage}):`,
    "",
    `The pitch: you built them a free preview — invite them to CLAIM it (claiming triggers the real build).`,
    `  • book a call with Joe: ${APP_SITE_URL}/book-appointment`,
    "",
  ];
  for (const r of res.rows) {
    const rating = r.google_rating ? ` · ${r.google_rating}★${r.review_count ? ` (${r.review_count})` : ""}` : "";
    const socials = [r.instagram_url && `IG:${r.instagram_url}`, r.facebook_url && `FB:${r.facebook_url}`, r.linkedin_url && `LinkedIn:${r.linkedin_url}`].filter(Boolean);
    const days = r.preview_expires_at ? Math.max(0, Math.ceil((new Date(r.preview_expires_at) - Date.now()) / 86400000)) : null;
    lines.push(`**#${r.id} ${r.business_name}**${r.owner_name ? ` · owner ${r.owner_name}` : ""} · ${r.niche || "—"} · ${r.city || r.service_area || "—"}${rating}`);
    lines.push(`   preview: ${APP_SITE_URL}/s/${r.slug} · claim code: ${r.claim_code}${days !== null ? ` · reserved ${days}d` : ""}`);
    lines.push(`   channels → email: ${r.email || "(none)"}${r.phone ? ` · phone: ${r.phone}` : ""}${socials.length ? ` · ${socials.join(" · ")}` : ""}`);
    lines.push("");
  }
  lines.push(
    `For each, message the owner on the BEST channel:\n` +
      `  • Has an EMAIL → save_forge_outreach_draft(site_id, "email", subject, body): a short warm note — you built them a preview (link it), they can CLAIM it with the code to have you build & launch the full site, offer to chat. Joe reviews + sends.\n` +
      `  • No email but a SOCIAL → save_forge_outreach_draft(site_id, channel, "", body): a short DM with the preview link + claim invite. Joe reviews, you send it, then mark_forge_outreach_sent(site_id, channel).\n` +
      `  • No email/social → leave it for Joe to call (phone on his card).\n` +
      `Keep it warm and specific to their trade. Never invent contact info.`,
  );
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolSaveForgeOutreachDraft({ site_id, subject, body, channel = "email" }) {
  const id = Number(site_id);
  if (!Number.isFinite(id)) return { content: [{ type: "text", text: "site_id must be a number." }] };
  const ch = OUTREACH_CHANNELS.includes(String(channel)) ? String(channel) : "email";
  const subj = String(subject || "").trim();
  const text = String(body || "").trim();
  if (!text) return { content: [{ type: "text", text: "A message body is required." }] };
  if (ch === "email" && !subj) return { content: [{ type: "text", text: "An email needs a subject." }] };

  const existing = await query(`SELECT id, business_name, status, (preview IS NOT NULL) AS has_preview FROM forge_sites WHERE id = $1 LIMIT 1`, [id]);
  if (!existing.rows.length) return { content: [{ type: "text", text: `forge_sites #${id} not found.` }] };
  const site = existing.rows[0];
  // Draftable once there's something to link: a built site (live URL) OR a showroom preview.
  if (site.status !== "built" && !site.has_preview) {
    return { content: [{ type: "text", text: `#${id} (${site.business_name}) has no built site and no preview yet (status=${site.status}) — generate a preview first.` }] };
  }

  await query(
    `UPDATE forge_sites
     SET outreach_subject = $2, outreach_draft = $3, outreach_channel = $4,
         outreach_status = 'drafted', updated_at = now()
     WHERE id = $1`,
    [id, subj, text, ch],
  );
  await audit("forge_outreach_drafted", `Drafted ${ch} first-touch for ${site.business_name} (#${id})`, {
    target: site.business_name,
    detail: { siteId: id, channel: ch, subject: subj },
  });
  const how = ch === "email"
    ? "Joe reviews + sends it from /command/prospects → Built."
    : `This is a ${ch} DM — Joe reviews it, then YOU send it by opening their ${ch} and messaging; afterward call mark_forge_outreach_sent(site_id, "${ch}").`;
  return { content: [{ type: "text", text: `✅ ${ch} first-touch draft saved for ${site.business_name} (#${id}). ${how}` }] };
}

// The outreach agent sends social DMs itself (by driving Instagram/Facebook/LinkedIn),
// so it marks those sent here. Email sends flow through Joe's approve-&-send in the UI.
async function toolMarkForgeOutreachSent({ site_id, channel = "email", note } = {}) {
  const id = Number(site_id);
  if (!Number.isFinite(id)) return { content: [{ type: "text", text: "site_id must be a number." }] };
  const ch = OUTREACH_CHANNELS.includes(String(channel)) ? String(channel) : "email";
  const existing = await query(`SELECT id, business_name, followup_count FROM forge_sites WHERE id = $1 LIMIT 1`, [id]);
  if (!existing.rows.length) return { content: [{ type: "text", text: `forge_sites #${id} not found.` }] };
  const site = existing.rows[0];
  const touch = Number(site.followup_count || 0) + 1;
  const vals = [id, ch, touch];
  let noteSql = "";
  if (note && String(note).trim()) {
    vals.push(String(note).trim());
    noteSql = `, contact_notes = COALESCE(contact_notes || E'\\n', '') || $${vals.length}`;
  }
  await query(
    `UPDATE forge_sites SET outreach_status = 'sent', outreach_channel = $2, followup_count = $3, contacted_at = now(), updated_at = now()${noteSql} WHERE id = $1`,
    vals,
  );
  await audit("forge_outreach_sent", `First-touched ${site.business_name} (#${id}) via ${ch} (touch ${touch})`, {
    target: site.business_name,
    detail: { siteId: id, channel: ch, touch },
  });
  return { content: [{ type: "text", text: `✅ Marked ${site.business_name} (#${id}) first-touched via ${ch} (touch ${touch}). Now it's Joe's turn to CALL them (2nd touch).` }] };
}

async function toolListForgeNeedsContact() {
  // Sites still missing an email or an owner name — the ones worth hunting a
  // reachable channel for. Built ones first (they're ready for outreach/calls).
  const res = await query(
    `SELECT id, business_name, niche, city, service_area, phone, email, owner_name,
            existing_website_url, live_url, google_maps_url, linkedin_url, instagram_url, facebook_url, status, outreach_status,
            phone_bad_at, phone_bad_note
     FROM forge_sites
     WHERE status IN ('built','approved','discovered')
       AND (email IS NULL OR email = '' OR owner_name IS NULL OR owner_name = ''
            OR outreach_status = 'bounced' OR phone_bad_at IS NOT NULL)
     ORDER BY (phone_bad_at IS NOT NULL) DESC, (outreach_status = 'bounced') DESC, (status = 'built') DESC, created_at DESC
     LIMIT 40`,
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "Every site already has an email + owner name — nothing to enrich." }] };
  }
  const bouncedN = res.rows.filter((r) => r.outreach_status === "bounced").length;
  const header = bouncedN
    ? `🔎 **${res.rows.length} site(s) need contact enrichment** — ⚠️ ${bouncedN} BOUNCED (dead email, hunt a new channel FIRST):`
    : `🔎 **${res.rows.length} site(s) need contact enrichment** (built first):`;
  const lines = [header, ""];
  for (const r of res.rows) {
    const bounced = r.outreach_status === "bounced";
    const have = [r.email && "email", r.owner_name && "owner", r.phone && "phone", r.instagram_url && "IG", r.facebook_url && "FB", r.linkedin_url && "LinkedIn"].filter(Boolean);
    const dig = [r.existing_website_url && `their site: ${r.existing_website_url}`, r.google_maps_url && `maps: ${r.google_maps_url}`, r.live_url && `our build: ${r.live_url}`].filter(Boolean);
    lines.push(`**#${r.id} ${r.business_name}** · ${r.niche || "—"} · ${r.city || r.service_area || "—"} [${r.status}]${bounced ? " ⚠️ BOUNCED" : ""}`);
    if (bounced) lines.push(`   ⚠️ Their previous email BOUNCED (dead) — find a DIFFERENT email OR a social profile (IG/FB/LinkedIn). A social is a valid channel; don't reuse the old address.`);
    lines.push(`   have: ${have.join(", ") || "phone only"} · MISSING: ${[!r.email && "email", !r.owner_name && "owner"].filter(Boolean).join(" + ") || "reachable channel"}`);
    if (dig.length) lines.push(`   dig here: ${dig.join(" · ")}`);
    lines.push("");
  }
  lines.push(
    `For each: open their website's contact/about page, their Google Maps listing, and search Instagram, Facebook and LinkedIn for the business. Find the OWNER's name and a real EMAIL, plus any social profile URLs. Then call enrich_forge_contact(site_id, owner_name, email, phone, instagram_url, facebook_url, linkedin_url, notes) — only pass the fields you actually found. Blank fields aren't overwritten.`,
  );
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolEnrichForgeContact({ site_id, owner_name, email, phone, instagram_url, facebook_url, linkedin_url, notes } = {}) {
  const id = Number(site_id);
  if (!Number.isFinite(id)) return { content: [{ type: "text", text: "site_id must be a number." }] };
  const existing = await query(`SELECT id, business_name, outreach_status FROM forge_sites WHERE id = $1 LIMIT 1`, [id]);
  if (!existing.rows.length) return { content: [{ type: "text", text: `forge_sites #${id} not found.` }] };
  const site = existing.rows[0];

  // Gap-fill only: COALESCE(NULLIF(col,''), new) keeps any value already there and
  // fills blanks with what was found — so enrichment never clobbers good data.
  const set = [];
  const vals = [id];
  const fill = (col, v) => {
    if (v !== undefined && String(v).trim()) {
      vals.push(String(v).trim());
      set.push(`${col} = COALESCE(NULLIF(${col}, ''), $${vals.length})`);
    }
  };
  fill("owner_name", owner_name);
  fill("email", email);
  fill("phone", phone);
  fill("instagram_url", instagram_url);
  fill("facebook_url", facebook_url);
  fill("linkedin_url", linkedin_url);
  if (notes && String(notes).trim()) {
    vals.push(String(notes).trim());
    set.push(`contact_notes = COALESCE(contact_notes || E'\\n', '') || $${vals.length}`);
  }
  if (!set.length) return { content: [{ type: "text", text: `Nothing to save for ${site.business_name} — pass at least one field you found.` }] };
  // Bounce recovery: if this lead was flagged 'bounced' and we now have a reachable channel
  // (a new email or any social), clear the flag → 'none' so it re-enters outreach as sendable.
  const gotChannel = [email, instagram_url, facebook_url, linkedin_url].some((v) => v && String(v).trim());
  const recovered = site.outreach_status === "bounced" && gotChannel;
  if (recovered) set.push(`outreach_status = 'none'`);
  // A NEW phone clears the bad-number flag — the lead flows straight back into the dialer queue.
  const gotPhone = phone && String(phone).trim();
  if (gotPhone) set.push(`phone_bad_at = NULL`);
  set.push(`contact_enriched_at = now()`, `updated_at = now()`);
  await query(`UPDATE forge_sites SET ${set.join(", ")} WHERE id = $1`, vals);

  await audit("forge_contact_enriched", `Enriched contact for ${site.business_name} (#${id})${recovered ? " — RECOVERED from bounce" : ""}`, {
    target: site.business_name,
    detail: { siteId: id, recovered, found: { owner_name, email, phone, instagram_url, facebook_url, linkedin_url } },
  });
  const found = [owner_name && `owner ${owner_name}`, email && `email ${email}`, phone && `phone ${phone}`].filter(Boolean).join(" · ");
  const recoveredNote = recovered ? ` ♻️ Recovered from a bounce — back in the outreach queue with a fresh channel.` : "";
  return { content: [{ type: "text", text: `✅ Enriched ${site.business_name} (#${id})${found ? ` — ${found}` : ""}. (Existing values kept; only blanks filled.)${recoveredNote}` }] };
}

async function toolListForgeNeedsCallprep() {
  // Sites with no call-prep yet — the ones to research for talking points before Joe
  // dials. Most-reviewed first (warmest), built/approved boosted.
  const res = await query(
    `SELECT id, business_name, niche, city, service_area, phone, google_rating, review_count,
            google_maps_url, facebook_url, instagram_url, existing_website_url, status
     FROM forge_sites
     WHERE call_prep IS NULL OR call_prep = ''
     ORDER BY (status IN ('built','approved')) DESC, NULLIF(review_count,'')::int DESC NULLS LAST, created_at DESC
     LIMIT 25`,
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "Every lead already has call-prep — nothing to research." }] };
  }
  const lines = [`📋 **${res.rows.length} lead(s) need call-prep** (most-reviewed first):`, ""];
  for (const r of res.rows) {
    const dig = [
      r.google_maps_url ? `Maps: ${r.google_maps_url}` : `search Google Maps for "${r.business_name} ${r.city || ""}"`,
      r.facebook_url && `FB: ${r.facebook_url}`,
      r.instagram_url && `IG: ${r.instagram_url}`,
      r.existing_website_url && `site: ${r.existing_website_url}`,
    ].filter(Boolean);
    lines.push(`**#${r.id} ${r.business_name}** · ${r.niche || "—"} · ${r.city || r.service_area || "—"} [${r.status}]${r.google_rating ? ` · ${r.google_rating}★ / ${r.review_count || "?"} reviews` : ""}`);
    lines.push(`   dig here: ${dig.join(" · ")}`);
    lines.push("");
  }
  lines.push(
    `For each: open their Google Maps listing → read the exact rating + copy 2–3 real review quotes (reviewer name + text). Open their Facebook/Instagram → note follower counts. Then call save_forge_callprep(site_id, google_rating, review_count, review_quotes[{stars,name,text}], social_stats{facebook:{followers},instagram:{followers}}, call_prep). Write call_prep as a short talking-points script: a strength to praise + a real review to reference → the gap (no website) → how our plan gets them more sales + organizes their lead flow → a warm close.`,
  );
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolSaveForgeCallprep({ site_id, google_rating, review_count, review_quotes, social_stats, call_prep, photo_url } = {}) {
  const id = Number(site_id);
  if (!Number.isFinite(id)) return { content: [{ type: "text", text: "site_id must be a number." }] };
  const existing = await query(`SELECT id, business_name FROM forge_sites WHERE id = $1 LIMIT 1`, [id]);
  if (!existing.rows.length) return { content: [{ type: "text", text: `forge_sites #${id} not found.` }] };
  const site = existing.rows[0];

  const set = [];
  const vals = [id];
  const push = (frag, v) => { vals.push(v); set.push(frag.replace("$$", `$${vals.length}`)); };
  if (google_rating != null && String(google_rating).trim()) push("google_rating = COALESCE($$, google_rating)", String(google_rating).trim());
  if (review_count != null && String(review_count).trim()) push("review_count = COALESCE($$, review_count)", String(review_count).trim());
  if (Array.isArray(review_quotes) && review_quotes.length) push("review_quotes = $$::jsonb", JSON.stringify(review_quotes.slice(0, 5)));
  if (social_stats && typeof social_stats === "object") push("social_stats = $$::jsonb", JSON.stringify(social_stats));
  if (call_prep && String(call_prep).trim()) push("call_prep = $$", String(call_prep).trim());
  if (photo_url && String(photo_url).trim()) push("photo_url = COALESCE(NULLIF(photo_url,''), $$)", String(photo_url).trim());
  if (!set.length) return { content: [{ type: "text", text: `Nothing to save for ${site.business_name} — pass review quotes, social stats, or call_prep.` }] };
  set.push("call_prep_at = now()", "updated_at = now()");
  await query(`UPDATE forge_sites SET ${set.join(", ")} WHERE id = $1`, vals);

  const nQuotes = Array.isArray(review_quotes) ? review_quotes.length : 0;
  await audit("forge_callprep", `Call-prep saved for ${site.business_name} (#${id}) — ${nQuotes} review quotes`, {
    target: site.business_name,
    detail: { siteId: id, quotes: nQuotes, hasScript: !!call_prep },
  });
  return { content: [{ type: "text", text: `✅ Call-prep saved for ${site.business_name} (#${id}) — ${nQuotes} review quote(s)${call_prep ? " + talking points" : ""}.` }] };
}

async function toolListForgeFollowupDue() {
  // Sites that got an initial email, aren't claimed, and are overdue for a follow-up
  // (>3 days since the last touch, fewer than 3 emails total). Include the prior
  // subject so the agent writes a NEW angle instead of repeating itself.
  const res = await query(
    `SELECT id, slug, business_name, niche, city, email, live_url, claim_code, followup_count, contacted_at, outreach_subject, preview_expires_at
     FROM forge_sites
     WHERE (status = 'built' OR (status = 'discovered' AND preview IS NOT NULL))
       AND claimed_by_user_id IS NULL AND email IS NOT NULL
       AND outreach_status = 'sent' AND followup_count >= 1 AND followup_count < 3
       AND contacted_at < now() - interval '3 days'
       AND (preview_expires_at IS NULL OR preview_expires_at > now())
     ORDER BY contacted_at ASC
     LIMIT 50`,
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "No sites are due for a follow-up right now." }] };
  }
  const lines = [`🔁 **${res.rows.length} site(s) due for a follow-up:**`, "", `book-a-call link: ${APP_SITE_URL}/book-appointment`, ""];
  for (const r of res.rows) {
    const nextTouch = Number(r.followup_count) + 1;
    const link = r.live_url || `${APP_SITE_URL}/s/${r.slug}`;
    const days = r.preview_expires_at ? Math.max(0, Math.ceil((new Date(r.preview_expires_at) - Date.now()) / 86400000)) : null;
    lines.push(`**#${r.id} ${r.business_name}** · ${r.niche || "—"} · ${r.city || "—"} — next is TOUCH ${nextTouch} of 3`);
    lines.push(`   ${r.live_url ? "live site" : "preview"}: ${link} · claim code: ${r.claim_code}${days !== null ? ` · reserved ${days}d` : ""}`);
    lines.push(`   last emailed: ${r.contacted_at} → ${r.email}${r.outreach_subject ? ` · prior subject: "${r.outreach_subject}"` : ""}`);
    lines.push("");
  }
  lines.push(
    `For each, write a SHORT follow-up with a NEW angle — don't repeat the prior email. Touch 2 = a gentle nudge with a fresh benefit; touch 3 = a brief, friendly "last note" break-up. The live-site link, claim code and book-a-call button are appended automatically. Call save_forge_outreach_draft(site_id, subject, body). Joe reviews + sends. Never go past touch 3.`,
  );
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// ── SMS cadence (autonomous — the outreach agent's own channel) ─────────────────────────────────
// Number-warming cap: at most this many SMS follow-ups a day, on TOP of the ~15/day first-touches.
const SMS_FOLLOWUP_DAILY_CAP = 25;

async function toolListSmsFollowupDue() {
  // Who's due for their next SMS touch on the ~2×/week cadence. HARD FILTERS (the safeguards the
  // agent must never override, enforced here so a paused/opted-out contact never even reaches it):
  //   ai_paused=false · not opted_out · not declined · not claimed · has a phone · not deleted.
  // Cadence: last outbound SMS ≥3 days ago · first touch <6 months ago · they've NEVER replied
  // (a reply moves them to list_sms_replies_pending — conversation mode, not cadence).
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const sentToday = Number(
    (
      await query(
        `SELECT count(*)::int AS n FROM activity_log
          WHERE event_type = 'sms_outreach_sent' AND metadata->'detail'->>'via' = 'followup'
            AND created_at >= $1`,
        [today.toISOString()],
      )
    ).rows[0].n,
  );
  const remaining = Math.max(0, SMS_FOLLOWUP_DAILY_CAP - sentToday);
  if (remaining === 0) {
    return { content: [{ type: "text", text: `Today's SMS follow-up cap is met (${sentToday}/${SMS_FOLLOWUP_DAILY_CAP} — we're warming the Twilio number). Rest until tomorrow.` }] };
  }

  const res = await query(
    `WITH sms AS (
       SELECT (metadata->'detail'->>'siteId')::int AS site_id,
              max(created_at) FILTER (WHERE event_type IN ('sms_outreach_sent','sms_outbound')) AS last_out,
              min(created_at) FILTER (WHERE event_type = 'sms_outreach_sent') AS first_touch,
              count(*) FILTER (WHERE event_type IN ('sms_outreach_sent','sms_outbound')) AS touches,
              count(*) FILTER (WHERE event_type = 'sms_inbound') AS replies
       FROM activity_log
       WHERE event_type IN ('sms_outreach_sent','sms_inbound','sms_outbound')
         AND (metadata->'detail'->>'siteId') ~ '^[0-9]+$'
       GROUP BY 1
     )
     SELECT f.id, f.slug, f.business_name, f.niche, f.city, f.owner_name, f.phone, f.claim_code,
            f.google_rating, f.review_count, f.contact_notes, f.live_url,
            s.last_out, s.first_touch, s.touches
     FROM sms s JOIN forge_sites f ON f.id = s.site_id
     WHERE s.replies = 0
       AND s.last_out < now() - interval '3 days'
       AND s.first_touch > now() - interval '6 months'
       AND f.status <> 'deleted' AND f.claimed_by_user_id IS NULL AND f.phone IS NOT NULL
       AND f.ai_paused = false
       AND f.outreach_status IS DISTINCT FROM 'opted_out'
       AND f.lead_stage IS DISTINCT FROM 'declined'
     ORDER BY s.last_out ASC
     LIMIT $1`,
    [remaining],
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "No leads are due for an SMS follow-up right now." }] };
  }
  const lines = [
    `🔁 **${res.rows.length} lead(s) due for their next SMS touch** — today ${sentToday}/${SMS_FOLLOWUP_DAILY_CAP} sent (number-warming cap):`,
    "",
  ];
  for (const r of res.rows) {
    const daysSince = Math.floor((Date.now() - new Date(r.last_out).getTime()) / 86400000);
    const link = r.live_url || `${APP_SITE_URL}/s/${r.slug}`;
    lines.push(
      `**#${r.id} ${r.business_name}**${r.owner_name ? ` · owner ${r.owner_name}` : ""} · ${r.niche || "—"} · ${r.city || "—"}${r.google_rating ? ` · ${r.google_rating}★${r.review_count ? ` (${r.review_count})` : ""}` : ""}`,
    );
    lines.push(`   📱 ${r.phone} · touch #${Number(r.touches) + 1} · last text ${daysSince}d ago · preview: ${link} · code: ${r.claim_code || "—"}`);
    if (r.contact_notes) lines.push(`   notes: ${String(r.contact_notes).slice(0, 160)}`);
    lines.push("");
  }
  lines.push(
    `For each: write ONE short casual text (your SMS voice — lowercase, one move, one question, a genuinely NEW angle for this touch number, never a repeat, never re-send a link they ignored without a fresh reason). Then send it with send_sms(to, body, site_id, purpose:"followup") — that logs the touch + advances the cadence. Stay under today's cap; if a text fails, move on.`,
  );
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolListSmsRepliesPending() {
  // Inbound SMS threads where the LEAD spoke last — the agent owes them a reply. Excludes paused /
  // opted-out / declined contacts (the webhook already suppressed hard opt-outs before they land here).
  const res = await query(
    `WITH sms AS (
       SELECT (metadata->'detail'->>'siteId')::int AS site_id,
              max(created_at) FILTER (WHERE event_type = 'sms_inbound') AS last_in,
              max(created_at) FILTER (WHERE event_type IN ('sms_outreach_sent','sms_outbound')) AS last_out
       FROM activity_log
       WHERE event_type IN ('sms_outreach_sent','sms_inbound','sms_outbound')
         AND (metadata->'detail'->>'siteId') ~ '^[0-9]+$'
       GROUP BY 1
     )
     SELECT f.id, f.slug, f.business_name, f.niche, f.city, f.service_area, f.owner_name, f.phone,
            f.claim_code, f.google_rating, f.review_count, f.contact_notes, f.call_prep, f.live_url,
            s.last_in
     FROM sms s JOIN forge_sites f ON f.id = s.site_id
     WHERE s.last_in IS NOT NULL AND (s.last_out IS NULL OR s.last_in > s.last_out)
       AND f.status <> 'deleted' AND f.ai_paused = false
       AND f.outreach_status IS DISTINCT FROM 'opted_out'
       AND f.lead_stage IS DISTINCT FROM 'declined'
     ORDER BY s.last_in ASC
     LIMIT 10`,
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "No SMS replies are waiting — every thread is answered." }] };
  }
  const lines = [`📱 **${res.rows.length} SMS repl${res.rows.length === 1 ? "y" : "ies"} waiting on you:**`, ""];
  for (const r of res.rows) {
    const thread = await query(
      `SELECT event_type AS et, metadata->'detail'->>'note' AS note, created_at
       FROM activity_log
       WHERE event_type IN ('sms_outreach_sent','sms_inbound','sms_outbound')
         AND (metadata->'detail'->>'siteId') = $1 AND metadata->'detail'->>'note' IS NOT NULL
       ORDER BY created_at DESC LIMIT 12`,
      [String(r.id)],
    );
    const link = r.live_url || `${APP_SITE_URL}/s/${r.slug}`;
    lines.push(
      `**#${r.id} ${r.business_name}**${r.owner_name ? ` · owner ${r.owner_name}` : ""} · ${r.niche || "—"} · ${r.city || r.service_area || "—"}${r.google_rating ? ` · ${r.google_rating}★${r.review_count ? ` (${r.review_count})` : ""}` : ""}`,
    );
    lines.push(`   📱 ${r.phone} · preview: ${link} · code: ${r.claim_code || "—"}`);
    if (r.contact_notes) lines.push(`   notes: ${String(r.contact_notes).slice(0, 200)}`);
    if (r.call_prep) lines.push(`   call prep: ${String(r.call_prep).slice(0, 300)}`);
    lines.push(`   thread (newest first):`);
    for (const t of thread.rows) {
      lines.push(`     ${t.et === "sms_inbound" ? "THEM" : "US  "} · ${String(t.note).slice(0, 200)}`);
    }
    lines.push("");
  }
  lines.push(
    `Answer each one with your SMS doctrine — respond to what THEY actually said, work the objection, book the call when there's interest. Send with send_sms(to, body, site_id, purpose:"reply"). Never re-send a link/code already in the thread.`,
  );
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolListEmailRepliesPending() {
  // Prospects who REPLIED to an outreach email and are still waiting on us. The inbox poller
  // (scripts/inbox-poll.mjs) writes these to forge_replies with a pre-draft; the agent's job is to
  // write the real reply. Email stays Joe-approved, so the agent SAVES a draft, never sends.
  const res = await query(
    `SELECT r.id, r.site_id, r.from_email, r.subject, r.inbound_text, r.draft, r.created_at,
            f.business_name, f.niche, f.city, f.owner_name, f.google_rating, f.review_count,
            f.claim_code, f.slug, f.live_url, f.contact_notes
     FROM forge_replies r JOIN forge_sites f ON f.id = r.site_id
     WHERE r.status = 'awaiting'
       AND f.ai_paused = false AND f.lead_stage IS DISTINCT FROM 'declined'
     ORDER BY r.created_at ASC LIMIT 10`,
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "No email replies are waiting — inbox is clear." }] };
  }
  const lines = [`📧 **${res.rows.length} email repl${res.rows.length === 1 ? "y" : "ies"} waiting on a response:**`, ""];
  for (const r of res.rows) {
    lines.push(`**#${r.site_id} ${r.business_name}**${r.owner_name ? ` · ${r.owner_name}` : ""} · ${r.niche || "—"} · ${r.city || "—"}${r.google_rating ? ` · ${r.google_rating}★${r.review_count ? ` (${r.review_count})` : ""}` : ""}`);
    lines.push(`   from: ${r.from_email}${r.subject ? ` · re: "${r.subject}"` : ""}`);
    lines.push(`   THEY WROTE: ${String(r.inbound_text || "").slice(0, 800)}`);
    lines.push(`   preview: ${APP_SITE_URL}/s/${r.slug} · code: ${r.claim_code || "—"}`);
    if (r.contact_notes) lines.push(`   notes: ${String(r.contact_notes).slice(0, 200)}`);
    lines.push("");
  }
  lines.push(
    `Answer each with ACA (acknowledge what they said → compliment tied to it → ask the question that moves toward a call). Short, plain, signed Joe — no branded fluff, no claim code unless they asked. Save with save_forge_outreach_draft(site_id, "email", subject, body); Joe reviews + sends from /command/leads.`,
  );
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolListForgeRescheduleDue() {
  // Near-won clients Joe flagged 'reschedule' — they got deep into the funnel but bailed on the
  // setup/payment call and need to rebook. Highest-priority warm leads. AI-paused rows excluded.
  const res = await query(
    `SELECT id, slug, business_name, niche, city, owner_name, email, phone, live_url, claim_code,
            instagram_url, facebook_url, contacted_at, contact_notes
     FROM forge_sites
     WHERE lead_stage = 'reschedule'
       AND ai_paused = false
       AND one_time_paid = false
       AND (subscription_status IS NULL OR subscription_status NOT IN ('active', 'trialing'))
     ORDER BY contacted_at DESC NULLS LAST
     LIMIT 50`,
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "No clients are waiting to reschedule right now." }] };
  }
  const lines = [`🗓️ **${res.rows.length} client(s) need to reschedule setup + payment:**`, "", `book-a-call link: ${APP_SITE_URL}/book-appointment`, ""];
  for (const r of res.rows) {
    const link = r.live_url || `${APP_SITE_URL}/s/${r.slug}`;
    const channels = [r.phone && `📱 ${r.phone}`, r.email && `✉️ ${r.email}`, r.instagram_url && "IG", r.facebook_url && "FB"].filter(Boolean).join(" · ");
    lines.push(`**#${r.id} ${r.business_name}** · ${r.niche || "—"} · ${r.city || "—"}${r.owner_name ? ` · owner: ${r.owner_name}` : ""}`);
    lines.push(`   ${r.live_url ? "live site" : "preview"}: ${link} · claim code: ${r.claim_code || "—"}`);
    lines.push(`   reach via: ${channels || "no channel on file"}${r.contacted_at ? ` · last touch: ${r.contacted_at}` : ""}`);
    if (r.contact_notes) lines.push(`   notes: ${String(r.contact_notes).slice(0, 200)}`);
    lines.push("");
  }
  lines.push(
    `These are your WARMEST leads — they already wanted the site and just need to rebook the setup + payment call. For each, write a SHORT, warm, low-pressure nudge: their site is ready and waiting on them, it only takes a few minutes to finish setup, include the book-a-call link. Prefer a text (send_sms) if you have a mobile, else draft with save_forge_outreach_draft for Joe to review + send. Never pressure; make rebooking effortless.`,
  );
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolUpdateProspect({
  prospect_id, photo_url, email, phone, website_url, google_my_business_url, source,
  website_status, website_rating, website_notes, sales_opportunities,
}) {
  const existing = await query(`SELECT id, recon, source AS current_source FROM prospects WHERE id = $1 LIMIT 1`, [prospect_id]);
  if (!existing.rows.length) {
    return { content: [{ type: "text", text: `Prospect #${prospect_id} not found.` }] };
  }
  const current = existing.rows[0].recon || {};
  const opportunities = sales_opportunities !== undefined
    ? (Array.isArray(sales_opportunities)
        ? sales_opportunities.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 5)
        : String(sales_opportunities || "").trim() ? [String(sales_opportunities).trim()] : [])
    : current.salesOpportunities;

  const rating = Number(website_rating);
  const updated = {
    ...current,
    ...(photo_url !== undefined && { photoUrl: String(photo_url).trim() }),
    ...(email !== undefined && { email: String(email).trim() }),
    ...(phone !== undefined && { phone: String(phone).trim() }),
    ...(website_url !== undefined && { websiteUrl: String(website_url).trim() }),
    ...(google_my_business_url !== undefined && { googleMyBusinessUrl: String(google_my_business_url).trim() }),
    ...(website_status !== undefined && { websiteStatus: String(website_status).trim() }),
    ...(website_rating !== undefined && { websiteRating: Number.isFinite(rating) ? Math.max(1, Math.min(10, Math.round(rating))) : null }),
    ...(website_notes !== undefined && { websiteNotes: String(website_notes).trim() }),
    ...(sales_opportunities !== undefined && { salesOpportunities: opportunities }),
  };

  const setClauses = source !== undefined
    ? `recon = $1::jsonb, source = $3, updated_at = now()`
    : `recon = $1::jsonb, updated_at = now()`;
  await query(
    `UPDATE prospects SET ${setClauses} WHERE id = $2`,
    source !== undefined ? [JSON.stringify(updated), prospect_id, String(source).trim()] : [JSON.stringify(updated), prospect_id],
  );
  const changes = Object.keys(updated).filter((k) => updated[k] !== current[k]);
  if (changes.length) {
    await audit("prospect_enriched", `Enriched prospect #${prospect_id}: ${changes.join(", ")}`, {
      prospectId: prospect_id,
      detail: { fields: changes },
    });
  }
  return { content: [{ type: "text", text: `✅ Updated prospect #${prospect_id} — enriched: ${changes.join(", ") || "no changes"}.` }] };
}

async function toolListNeedsEnrichment({ offset = 0 } = {}) {
  const res = await query(
    `SELECT id, name, title, company, vertical, source, profile_url,
            recon->>'photoUrl' AS photo_url,
            recon->>'email' AS email,
            recon->>'phone' AS phone,
            recon->>'websiteUrl' AS website_url,
            recon->>'googleMyBusinessUrl' AS gmb_url
     FROM prospects
     WHERE paused = false
       AND (recon IS NULL
         OR recon->>'photoUrl' IS NULL OR recon->>'photoUrl' = ''
         OR recon->>'email' IS NULL OR recon->>'email' = '')
     ORDER BY created_at ASC
     LIMIT 50 OFFSET $1`,
    [Math.max(0, Number(offset) || 0)],
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "All prospects in this batch already have photos and email — try a higher offset or enrichment is complete." }] };
  }
  const lines = [`🔍 **${res.rows.length} prospects need enrichment (offset ${offset}):**`, ""];
  for (const r of res.rows) {
    const missing = [!r.photo_url && "photo", !r.email && "email", !r.phone && "phone"].filter(Boolean).join(", ");
    lines.push(`**#${r.id} ${r.name}** · ${r.title || ""} at ${r.company || ""} · source: ${r.source || "unknown"} · missing: ${missing}`);
    if (r.profile_url) lines.push(`LinkedIn: ${r.profile_url}`);
    if (r.website_url) lines.push(`Website: ${r.website_url}`);
    if (r.gmb_url) lines.push(`Google Business: ${r.gmb_url}`);
    lines.push("");
  }
  lines.push("For each: visit LinkedIn or website, find photo/email/phone/GMB URL, call update_prospect. Use offset+50 to get the next batch.");
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolCheckOutreachWindow() {
  const res = await query(
    `SELECT enabled, timezone, work_days, work_start_hour, work_end_hour,
            daily_goal, ramp_enabled, ramp_start, ramp_weekly_step, ramp_started_on
     FROM automation_settings WHERE id = 1 LIMIT 1`,
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: `{"allowed":false,"reason":"No automation_settings row found — skipping."}` }] };
  }
  const cfg = res.rows[0];
  if (!cfg.enabled) {
    return { content: [{ type: "text", text: JSON.stringify({ allowed: false, reason: "Automation is disabled in settings." }) }] };
  }

  const tz = cfg.timezone || "America/Los_Angeles";
  const now = new Date();
  const fmt = (unit) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, [unit]: unit === "hour" ? "2-digit" : "short", hourCycle: "h23" }).format(now));
  const hour = fmt("hour");
  const dayStr = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
  const workDays = (cfg.work_days || "Mon,Tue,Wed,Thu,Fri").split(",").map((d) => d.trim());

  if (!workDays.includes(dayStr)) {
    return { content: [{ type: "text", text: JSON.stringify({ allowed: false, reason: `Today is ${dayStr} — not a working day (${workDays.join(", ")}).` }) }] };
  }
  if (hour < cfg.work_start_hour || hour >= cfg.work_end_hour) {
    return { content: [{ type: "text", text: JSON.stringify({ allowed: false, reason: `Current hour is ${hour}:xx ${tz} — outside working window (${cfg.work_start_hour}:00–${cfg.work_end_hour}:00).` }) }] };
  }

  // Compute daily target (ramp-aware)
  let target = cfg.daily_goal;
  if (cfg.ramp_enabled && cfg.ramp_started_on) {
    const start = new Date(cfg.ramp_started_on + "T00:00:00Z").getTime();
    const weeks = Math.max(0, Math.floor((Date.now() - start) / (7 * 24 * 3600 * 1000)));
    target = Math.min(cfg.daily_goal, cfg.ramp_start + weeks * cfg.ramp_weekly_step);
  }

  // Check how many sent today in this timezone
  const todayRes = await query(
    `SELECT count(*)::int AS n FROM outreach WHERE status = 'sent'
     AND sent_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1`,
    [tz],
  );
  const sentToday = Number(todayRes.rows[0]?.n ?? 0);

  if (sentToday >= target) {
    return { content: [{ type: "text", text: JSON.stringify({ allowed: false, reason: `Daily goal met — sent ${sentToday}/${target} today. Done for the day.` }) }] };
  }

  const remaining = target - sentToday;
  return {
    content: [{
      type: "text",
      text: JSON.stringify({ allowed: true, sentToday, target, remaining, reason: `In window (${dayStr} ${hour}:xx ${tz}). ${remaining} left to send today.` }),
    }],
  };
}

async function toolListApprovedForOutreach() {
  const res = await query(
    `SELECT p.id, p.name, p.title, p.company, p.vertical, p.location, p.profile_url,
            o.body, o.id AS outreach_id
     FROM prospects p
     JOIN outreach o ON o.prospect_id = p.id
     WHERE o.step = 'connection' AND o.status = 'approved' AND p.paused = false
     ORDER BY o.approved_at ASC
     LIMIT 5`,
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "No approved prospects waiting — queue is clear." }] };
  }
  const lines = [`🔗 **${res.rows.length} approved connection request(s) to send:**`, ""];
  for (const r of res.rows) {
    lines.push(`**#${r.id} ${r.name}** · ${r.title} at ${r.company} · ${r.location}`);
    lines.push(`LinkedIn: ${r.profile_url}`);
    lines.push(`Note to send: ${r.body}`);
    lines.push(`_(outreach_id: ${r.outreach_id})_`);
    lines.push("");
  }
  lines.push("Use mark_sent with the outreach_id after sending each connection request.");
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolMarkSent({ outreach_id, notes }) {
  const upd = await query(
    `UPDATE outreach SET status = 'sent', sent_at = now() WHERE id = $1 RETURNING prospect_id, body`,
    [outreach_id],
  );
  const o = upd.rows[0];
  if (!o) {
    return { content: [{ type: "text", text: `Outreach #${outreach_id} not found.` }] };
  }
  const p = await query(
    `UPDATE prospects SET status = 'connected' WHERE id = $1 RETURNING name`,
    [o.prospect_id],
  );
  const name = p.rows[0]?.name ?? null;
  await audit("outreach_sent", `Sent connection request to ${name || `prospect #${o.prospect_id}`}`, {
    prospectId: o.prospect_id,
    target: name,
    detail: { note: o.body, notes: notes || null },
  });
  const extra = notes ? `\nNotes: ${notes}` : "";
  return { content: [{ type: "text", text: `✅ Marked as sent. Prospect moved to 'connected' status.${extra}` }] };
}

// ---------------------------------------------------------------------------
// New tool handlers
// ---------------------------------------------------------------------------
async function toolLogActivity({ event_type, summary, metadata, actor }) {
  const res = await query(
    `INSERT INTO activity_log (actor, event_type, summary, metadata) VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
    [actor || "venus", event_type, summary, metadata ? JSON.stringify(metadata) : null],
  );
  const id = res.rows[0].id;
  return { content: [{ type: "text", text: `✅ Activity logged (#${id}).` }] };
}

// ---------------------------------------------------------------------------
// Whitney — job-application tools. Every state change logs as actor='whitney'
// so her work is attributable on the dashboard (roster "Last:" + /command/jobs).
// The board she writes to (job_applications) is reviewed at /command/applications;
// Joe's Approve/Dismiss is the human gate between "found" and "apply".
// ---------------------------------------------------------------------------
const APPLICATION_STATUSES = [
  "found", "approved", "dismissed", "account_created", "verified", "applied", "interview", "rejected", "closed",
];

// Cheap pre-flight for Whitney's filler path. The cap is also enforced inside
// record_found_job, but only AFTER a full search has already been paid for — she
// was scraping 2-4 leads every 15 minutes and discarding them while the board sat
// at 93. This lets her check first and stop before doing any browsing at all.
async function toolJobBoardCount() {
  if (await isAgentPaused("whitney")) {
    return { content: [{ type: "text", text: "⏸ Whitney is PAUSED by Joe. Stand down — do not find or post jobs. End your turn without acting." }] };
  }
  const budget = await dailyBudgetStop("whitney");
  if (budget) return budget;
  const res = await query(`SELECT count(*)::int n FROM job_applications WHERE status = 'found'`);
  const n = res.rows[0].n;
  const room = Math.max(0, REVIEW_CAP - n);
  if (n >= REVIEW_CAP) {
    const dir = await query(`SELECT count(*)::int n FROM job_applications WHERE status = 'found' AND directed = true`);
    const dirRoom = Math.max(0, DIRECTED_CAP - dir.rows[0].n);
    return { content: [{ type: "text", text: `🧢 Review board is FULL for GENERAL search: ${n} awaiting review, cap ${REVIEW_CAP}. Do NOT go looking for roles broadly this turn — no speculative browsing, no scraping, no untargeted record_found_job.\n\n${dirRoom > 0
      ? `✅ BUT Joe's PRIORITY EMPLOYERS (listed in your USER.md target profile) are exempt — that lane has room for ${dirRoom} more. You may go straight to those employers' own careers pages, and record what you find with **directed: true**. Nothing else this turn.`
      : `Joe's priority-employer lane is also full (${dir.rows[0].n}/${DIRECTED_CAP}) — end your turn now.`}` }] };
  }
  return { content: [{ type: "text", text: `✅ Review board has room: ${n}/${REVIEW_CAP} awaiting review — you may surface up to ${room} more this turn.` }] };
}

async function toolRecordFoundJob({
  company, role, platform, url, location, pay,
  fit_reason, fit_score, interest_match, interest_score,
  job_description, company_about, company_address, company_website,
  company_reviews, contact_info, directed,
}) {
  if (await isAgentPaused("whitney")) {
    return { content: [{ type: "text", text: "⏸ Whitney is PAUSED by Joe. Stand down — do not find or post jobs. End your turn without acting." }] };
  }
  const budgetStop = await dailyBudgetStop("whitney");
  if (budgetStop) return budgetStop;
  if (!company || !role) {
    return { content: [{ type: "text", text: "❌ company and role are required." }], isError: true };
  }
  // Directed finds are counted and capped separately — a full general board doesn't block them.
  const isDirected = directed === true;
  const capCheck = await query(
    `SELECT count(*)::int n FROM job_applications WHERE status = 'found' AND directed = $1`,
    [isDirected],
  );
  const cap = isDirected ? DIRECTED_CAP : REVIEW_CAP;
  if (capCheck.rows[0].n >= cap) {
    return { content: [{ type: "text", text: isDirected
      ? `🧢 Joe's priority-target lane is full: ${capCheck.rows[0].n} directed roles awaiting review (cap ${cap}). Stop finding — he needs to work these before you surface more.`
      : `🧢 The review board is at its ${cap}-opportunity cap (${capCheck.rows[0].n} awaiting review). Stop general finding — Joe needs to approve or decline some before you surface more. You MAY still surface roles at the priority employers in his target profile: pass directed: true for those.` }] };
  }
  // Dedup: same company + role already on the board (any status) → don't re-add.
  const dup = await query(
    `SELECT id, status FROM job_applications WHERE lower(company) = lower($1) AND lower(role) = lower($2) LIMIT 1`,
    [company, role],
  );
  if (dup.rows.length) {
    return { content: [{ type: "text", text: `⏭️ Already on the board: ${role} @ ${company} (#${dup.rows[0].id}, status: ${dup.rows[0].status}). Not re-added.` }] };
  }
  const clampScore = (n) => (Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null);
  const res = await query(
    `INSERT INTO job_applications
       (company, role, platform, url, location, pay, fit_reason, fit_score,
        interest_match, interest_score, job_description, company_about,
        company_address, company_website, company_reviews, contact_info, status, directed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,'found',$17)
     RETURNING id`,
    [
      company, role, platform || null, url || null, location || null, pay || null,
      fit_reason || null, clampScore(fit_score),
      interest_match || null, clampScore(interest_score),
      job_description || null, company_about || null, company_address || null, company_website || null,
      company_reviews ? JSON.stringify(company_reviews) : null,
      contact_info ? JSON.stringify(contact_info) : null,
      isDirected,
    ],
  );
  const id = res.rows[0].id;
  await audit("job_found", `Found${isDirected ? " (priority target)" : ""}: ${role} @ ${company}${location ? ` (${location})` : ""}`, {
    actor: "whitney", target: company,
    detail: { role, platform, url, pay, directed: isDirected, fit_score: clampScore(fit_score), interest_score: clampScore(interest_score) },
  });
  const scoreNote = [
    clampScore(fit_score) != null ? `fit ${clampScore(fit_score)}%` : null,
    clampScore(interest_score) != null ? `interest ${clampScore(interest_score)}%` : null,
  ].filter(Boolean).join(" · ");
  return { content: [{ type: "text", text: `✅ Posted to the review board: **${role} @ ${company}** (#${id})${scoreNote ? ` — ${scoreNote}` : ""}. Awaiting Joe's approval.` }] };
}

async function toolListApprovedJobs() {
  if (await isAgentPaused("whitney")) {
    return { content: [{ type: "text", text: "⏸ Whitney is PAUSED by Joe. Stand down — do NOT apply to anything and do NOT find new jobs. Log nothing and end your turn." }] };
  }
  const budget = await dailyBudgetStop("whitney");
  if (budget) return budget;
  const appliedN = await appliedToday();
  if (appliedN >= DAILY_APPLY_CAP) {
    return { content: [{ type: "text", text: `✅ Today's applications are done: ${appliedN}/${DAILY_APPLY_CAP}. That is the healthy human ceiling — more in one day looks automated and is what gets Joe's job-board accounts flagged. Do NOT apply to anything else today and do NOT go looking for more roles. End your turn; the queue will still be here tomorrow.` }] };
  }
  const res = await query(
    `SELECT id, company, role, platform, url, location, pay, fit_reason, priority, approved_at,
            job_description, company_website, contact_info
     FROM job_applications
     WHERE status = 'approved'
     ORDER BY priority DESC, approved_at ASC NULLS LAST, created_at ASC
     LIMIT 25`,
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "📭 No approved jobs waiting. Nothing to apply to — switch to your filler role: find new jobs and record_found_job them for Joe to approve." }] };
  }
  const lines = [`📬 **${res.rows.length} approved job(s) waiting** (top of queue first):`, ""];
  for (const r of res.rows) {
    lines.push(`**#${r.id} — ${r.role} @ ${r.company}**${r.location ? ` · ${r.location}` : ""}${r.pay ? ` · ${r.pay}` : ""}`);
    if (r.platform) lines.push(`Platform: ${r.platform}`);
    if (r.url) lines.push(`Apply: ${r.url}`);
    if (r.company_website) lines.push(`Company site: ${r.company_website}`);
    if (r.contact_info) {
      const c = typeof r.contact_info === "string" ? JSON.parse(r.contact_info) : r.contact_info;
      const bits = [c.recruiter_name, c.email, c.phone, c.careers_url].filter(Boolean).join(" · ");
      if (bits) lines.push(`Contact: ${bits}`);
    }
    if (r.fit_reason) lines.push(`Why it fits: ${r.fit_reason}`);
    if (r.job_description) lines.push(`JD: ${String(r.job_description).replace(/\s+/g, " ").slice(0, 500)}${r.job_description.length > 500 ? "…" : ""}`);
    lines.push("");
  }
  lines.push("_Work the TOP one to completion: create account → verify by email (inbox_search) → tailor → submit, calling update_application_status at each stage. One approved job per turn._");
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolUpdateApplicationStatus({ id, status, notes }) {
  if (!APPLICATION_STATUSES.includes(status)) {
    return { content: [{ type: "text", text: `❌ Invalid status "${status}". Allowed: ${APPLICATION_STATUSES.join(", ")}.` }], isError: true };
  }
  const cur = await query(`SELECT company, role, status FROM job_applications WHERE id = $1`, [id]);
  if (!cur.rows.length) {
    return { content: [{ type: "text", text: `❌ No job_application #${id}.` }], isError: true };
  }
  const stamp =
    status === "approved" ? ", approved_at = COALESCE(approved_at, now())"
    : status === "applied" ? ", applied_at = COALESCE(applied_at, now())"
    : "";
  await query(
    `UPDATE job_applications SET status = $1, notes = COALESCE($2, notes), updated_at = now()${stamp} WHERE id = $3`,
    [status, notes || null, id],
  );
  const prev = cur.rows[0].status;
  const { company, role } = cur.rows[0];
  await audit(`application_${status}`, `${role} @ ${company}: ${prev} → ${status}`, {
    actor: "whitney", target: company, detail: { id, from: prev, to: status, notes },
  });
  if (status === "applied") {
    await notifyJoeSms(`📮 Whitney just applied: ${role} @ ${company} (#${id}). Review it on /command/applications.`);
    // The apply cap's REAL chokepoint. list_approved_jobs checks it too, but that only guards the
    // queue path — a directive from Joe can send her straight here, and that path was unguarded.
    // Deliberately AFTER the write, never instead of it: by the time she calls this the form is
    // already submitted, so refusing to record it would leave the board lying about reality.
    // Record the truth, then stop her.
    try {
      const n = await appliedToday();
      if (n >= DAILY_APPLY_CAP) {
        return { content: [{ type: "text", text: `✅ #${id} ${role} @ ${company}: ${prev} → **applied**.\n\n🛑 That was application ${n}/${DAILY_APPLY_CAP} for today — your daily limit. STOP applying now: do not start another, even if Joe's directive lists more employers. The rest carry over to tomorrow, and that is the correct outcome — more than ${DAILY_APPLY_CAP} applications in one day reads as automated and is exactly what gets Joe's accounts flagged. Finish your turn: log_activity, and leave any directive open so you pick it up tomorrow.` }] };
      }
    } catch { /* fail-open: a counting error must not hide a real application */ }
  }
  return { content: [{ type: "text", text: `✅ #${id} ${role} @ ${company}: ${prev} → **${status}**.` }] };
}

// Read joe@thinkbigjoe.com (Zoho IMAP, same creds as SMTP) for a SPECIFIC purpose:
// the verification link/code for an account Whitney just created, or an interview
// invite. BODY.PEEK — never marks mail read. Not a general inbox browser.
// Transactional mail — account verifications, magic links, OTPs — is very often HTML-ONLY, with
// no text/plain part at all. Reading just `parsed.text` therefore returned an empty body and zero
// links for exactly the messages Whitney needs most: on 2026-08-30 she found Zillow's Workday
// "Verify your candidate account" email, got back a subject and nothing else, and had to escalate
// to Joe for a link that was sitting in the HTML. Strip the HTML instead.
function htmlToText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// Links live in href="..." in HTML, not inline in the text — so scrape both.
function extractLinks(text, html) {
  const out = new Set();
  for (const m of String(text || "").match(/https?:\/\/[^\s<>()"']+/g) || []) out.add(m);
  for (const m of String(html || "").matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const u = m[1];
    if (/^https?:\/\//i.test(u)) out.add(u.replace(/&amp;/gi, "&"));
  }
  return Array.from(out);
}

async function toolInboxSearch({ query: q, from, since_minutes, limit }) {
  const USER = process.env.SMTP_USER, PASS = process.env.SMTP_PASS;
  if (!USER || !PASS) {
    return { content: [{ type: "text", text: "❌ Inbox not configured (SMTP_USER/SMTP_PASS missing in .env.local)." }], isError: true };
  }
  const sinceMin = Number.isFinite(since_minutes) ? since_minutes : 1440; // default: last 24h
  const max = Math.min(Number(limit) || 10, 25);
  const since = new Date(Date.now() - sinceMin * 60 * 1000);
  const needle = (q || "").toLowerCase();
  const fromNeedle = (from || "").toLowerCase();

  const client = new ImapFlow({ host: "imap.zoho.com", port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false });
  const hits = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ since }, { uid: true });
      const scan = (uids || []).slice(-80).reverse(); // newest first, cap the scan
      for (const uid of scan) {
        if (hits.length >= max) break;
        let parsed = null;
        for await (const msg of client.fetch(uid, { source: true, envelope: true }, { uid: true })) {
          try { parsed = await simpleParser(msg.source); } catch { parsed = null; }
        }
        if (!parsed) continue;
        const fromAddr = (parsed.from?.text || "").toLowerCase();
        const subject = parsed.subject || "";
        const bodyText = parsed.text || htmlToText(parsed.html) || "";
        const hay = `${subject}\n${fromAddr}\n${bodyText}\n${parsed.html || ""}`.toLowerCase();
        if (needle && !hay.includes(needle)) continue;
        if (fromNeedle && !fromAddr.includes(fromNeedle)) continue;
        // Verification/magic links are the whole point of this tool — keep more of them, and
        // float the ones that look like a confirm/verify action to the front.
        const all = extractLinks(bodyText, parsed.html);
        const isAction = (u) => /verif|confirm|activat|validate|token|otp|magic|reset/i.test(u);
        const links = [...all.filter(isAction), ...all.filter((u) => !isAction(u))].slice(0, 15);
        hits.push({
          date: parsed.date ? parsed.date.toISOString() : null,
          from: parsed.from?.text || "",
          subject,
          snippet: bodyText.replace(/\s+/g, " ").trim().slice(0, 600),
          links,
        });
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Inbox search failed: ${err?.message || err}` }], isError: true };
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
  if (!hits.length) {
    return { content: [{ type: "text", text: `📭 No messages in the last ${sinceMin} min matching ${q ? `"${q}"` : "(any)"}${from ? ` from "${from}"` : ""}.` }] };
  }
  const lines = [`📨 **${hits.length} match(es)** (newest first):`, ""];
  for (const h of hits) {
    lines.push(`**${h.subject || "(no subject)"}**`);
    lines.push(`From: ${h.from}${h.date ? ` · ${h.date}` : ""}`);
    if (h.links.length) lines.push(`Links: ${h.links.join("  ")}`);
    lines.push(h.snippet);
    lines.push("");
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// ---------------------------------------------------------------------------
// Edward — inbox management for joe@thinkbigjoe.com (Zoho IMAP/SMTP).
// Edward sweeps + classifies + drafts; sends go to the email_outbox queue where
// VENUS approves/rejects (email_approve_send / email_reject_send — her tools,
// not Edward's). Approved future-dated sends are fired by the outbox drain
// (scripts/email-outbox-drain.mjs). Queue + activity visible on /command/inbox.
// ---------------------------------------------------------------------------
function zohoImap() {
  const USER = process.env.SMTP_USER, PASS = process.env.SMTP_PASS;
  if (!USER || !PASS) return null;
  return new ImapFlow({ host: "imap.zoho.com", port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false });
}
const NO_MAIL_CREDS = { content: [{ type: "text", text: "❌ Mailbox not configured (SMTP_USER/SMTP_PASS missing in .env.local)." }], isError: true };

// Zoho names its junk folder "Spam"; resolve by special-use flag so we never guess wrong.
async function findMailbox(client, specialUse, fallback) {
  try {
    for (const mbx of await client.list()) {
      if (mbx.specialUse === specialUse) return mbx.path;
    }
  } catch { /* fall through */ }
  return fallback;
}

// Folders a sweep must cover. Zoho (and any server-side filter Joe adds later) routes mail
// OUT of INBOX — ATS/employer mail lands in "Notification" — so an INBOX-only sweep is
// structurally blind to exactly the mail that matters most. Scan INBOX plus every ordinary
// user folder; skip only the ones where mail is already handled or outbound.
const SWEEP_SKIP_SPECIAL = new Set(["\\Sent", "\\Drafts", "\\Trash", "\\Junk", "\\All", "\\Flagged"]);
const SWEEP_SKIP_NAMES = new Set(["sent", "drafts", "trash", "spam", "junk", "templates", "snoozed", "outbox"]);
async function sweepableFolders(client) {
  const out = [];
  try {
    for (const mbx of await client.list()) {
      if (mbx.path === "INBOX") { out.unshift("INBOX"); continue; }
      if (mbx.specialUse && SWEEP_SKIP_SPECIAL.has(mbx.specialUse)) continue;
      if (SWEEP_SKIP_NAMES.has(String(mbx.path).toLowerCase())) continue;
      out.push(mbx.path);
    }
  } catch { /* fall back to INBOX only */ }
  return out.length ? out : ["INBOX"];
}

// Senders that can never be "waiting on a reply" — machine mail. Kept deliberately tight:
// a real person at a company must never be filtered out just because their domain looks noisy.
const MACHINE_SENDER = /(^|[<.@])(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounce|notifications?@|automated|noreply)/i;
const MACHINE_SUBJECT = /^(report domain|delivery status notification|undelivered mail|mail delivery)/i;
function isMachineMail(from, subject) {
  return MACHINE_SENDER.test(from || "") || MACHINE_SUBJECT.test(subject || "");
}
function bareAddress(s) {
  const m = /<([^>]+)>/.exec(s || "");
  return (m ? m[1] : (s || "")).trim().toLowerCase();
}

async function toolInboxSweep({ since_minutes, limit } = {}) {
  const budget = await dailyBudgetStop("edward");
  if (budget) return budget;
  const client = zohoImap();
  if (!client) return NO_MAIL_CREDS;
  const sinceMin = Number.isFinite(since_minutes) ? since_minutes : 480; // default 8h — covers a missed sweep
  const max = Math.min(Number(limit) || 30, 50);
  const since = new Date(Date.now() - sinceMin * 60 * 1000);
  const msgs = [];
  try {
    await client.connect();
    for (const folder of await sweepableFolders(client)) {
      const lock = await client.getMailboxLock(folder);
      try {
        const uids = await client.search({ since }, { uid: true });
        const scan = (uids || []).slice(-max).reverse(); // newest first
        for (const uid of scan) {
          let parsed = null;
          for await (const msg of client.fetch(uid, { source: true }, { uid: true })) {
            try { parsed = await simpleParser(msg.source); } catch { parsed = null; }
          }
          if (!parsed) continue;
          msgs.push({
            uid,
            folder,
            date: parsed.date ? parsed.date.toISOString() : null,
            from: parsed.from?.text || "",
            // Relay senders (YC's Work at a Startup, most ATS platforms) put the human's real
            // routing address in Reply-To and a generic no-reply in From. Replying to From sends
            // the message nowhere. Surface it so a draft can never be addressed to the wrong box.
            reply_to: parsed.replyTo?.value?.[0]?.address || null,
            subject: parsed.subject || "(no subject)",
            message_id: parsed.messageId || null,
            snippet: (parsed.text || "").replace(/\s+/g, " ").trim().slice(0, 400),
          });
        }
      } finally {
        lock.release();
      }
    }
    msgs.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Inbox sweep failed: ${err?.message || err}` }], isError: true };
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
  if (!msgs.length) return { content: [{ type: "text", text: `📭 Nothing new in the last ${sinceMin} min across any folder.` }] };
  const byFolder = [...new Set(msgs.map((m) => m.folder))].join(", ");
  const lines = [`📥 **${msgs.length} message(s)** across ${byFolder} (newest first) — classify each and act per your SOP:`, ""];
  for (const m of msgs) {
    lines.push(`• uid ${m.uid} · [${m.folder}] · ${m.date || "?"}`);
    lines.push(`  From: ${m.from}`);
    if (m.reply_to) lines.push(`  ⚠️ Reply-To: ${m.reply_to}  ← reply HERE, not to From`);
    lines.push(`  Subject: ${m.subject}`);
    if (m.message_id) lines.push(`  Message-ID: ${m.message_id}`);
    lines.push(`  ${m.snippet}`);
    lines.push("");
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolEmailCreateDraft({ to, subject, body, in_reply_to } = {}) {
  if (!to || !subject || !body) return { content: [{ type: "text", text: "❌ to, subject, and body are required." }], isError: true };
  const client = zohoImap();
  if (!client) return NO_MAIL_CREDS;
  const USER = process.env.SMTP_USER;
  const raw = [
    `From: Joe Sardella <${USER}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    in_reply_to ? `In-Reply-To: ${in_reply_to}` : null,
    in_reply_to ? `References: ${in_reply_to}` : null,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
  ].filter((l) => l !== null).join("\r\n");
  try {
    await client.connect();
    const drafts = await findMailbox(client, "\\Drafts", "Drafts");
    await client.append(drafts, raw, ["\\Draft"]);
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Draft creation failed: ${err?.message || err}` }], isError: true };
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
  await audit("email_draft_created", `Draft to ${to}: ${subject}`, { actor: "edward", target: to });
  return { content: [{ type: "text", text: `📝 Draft saved to ${to} ("${subject}") — it's in the Drafts folder (visible in Joe's Apple Mail). To actually send it, queue it with email_request_send for Venus's approval.` }] };
}

async function toolEmailMoveSpam({ uid, uids } = {}) {
  const list = (Array.isArray(uids) ? uids : [uid]).map(Number).filter(Number.isFinite);
  if (!list.length) return { content: [{ type: "text", text: "❌ Pass uid (or uids[]) from inbox_sweep." }], isError: true };
  const client = zohoImap();
  if (!client) return NO_MAIL_CREDS;
  let junk = "Spam";
  try {
    await client.connect();
    junk = await findMailbox(client, "\\Junk", "Spam");
    const lock = await client.getMailboxLock("INBOX");
    try {
      await client.messageMove(list.join(","), junk, { uid: true });
    } finally {
      lock.release();
    }
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Move to ${junk} failed: ${err?.message || err}` }], isError: true };
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
  await audit("email_spam_moved", `Moved uid ${list.join(",")} → ${junk}`, { actor: "edward" });
  return { content: [{ type: "text", text: `🗑️ Moved ${list.length} message(s) to ${junk}. Recoverable there — nothing is ever permanently deleted.` }] };
}

// --- The unanswered backlog -------------------------------------------------
// inbox_sweep is time-windowed by design, which means an inquiry nobody answered simply ages
// out of view and is never seen again. That is how a Klavis AI interview invite and a Farmers
// Insurance meeting request both went 4 and 34 days without a reply while Edward reported
// "inbox clear". This tool is age-blind on purpose: it asks "who is still owed a reply?"
async function toolInboxUnanswered({ limit, include_machine } = {}) {
  const client = zohoImap();
  if (!client) return NO_MAIL_CREDS;
  const max = Math.min(Number(limit) || 40, 100);
  const repliedTo = new Set();   // addresses we have written to
  const answeredIds = new Set(); // Message-IDs we have replied to (thread-accurate)
  const inbound = [];
  try {
    await client.connect();

    const sentPath = await findMailbox(client, "\\Sent", "Sent");
    const slock = await client.getMailboxLock(sentPath);
    try {
      for await (const m of client.fetch({ all: true }, { envelope: true, uid: true })) {
        const e = m.envelope || {};
        for (const a of (e.to || [])) if (a.address) repliedTo.add(a.address.toLowerCase());
        for (const a of (e.cc || [])) if (a.address) repliedTo.add(a.address.toLowerCase());
        if (e.inReplyTo) answeredIds.add(String(e.inReplyTo).trim());
      }
    } finally { slock.release(); }

    for (const folder of await sweepableFolders(client)) {
      const lock = await client.getMailboxLock(folder);
      try {
        for await (const m of client.fetch({ all: true }, { envelope: true, flags: true, uid: true, headers: ["list-unsubscribe", "precedence", "auto-submitted"] })) {
          const e = m.envelope || {};
          const from = (e.from || []).map((a) => `${a.name || ""} <${a.address}>`).join(", ");
          const subject = e.subject || "(no subject)";
          if (!include_machine && isMachineMail(from, subject)) continue;
          const addr = bareAddress(from);
          if (!addr || repliedTo.has(addr)) continue;
          if (e.messageId && answeredIds.has(String(e.messageId).trim())) continue;
          // Bulk detection: List-Unsubscribe (RFC 2369) is the honest signal that a message was
          // blasted to a list, not written to Joe. Without this, 60 days of vendor onboarding mail
          // outranks a recruiter — which is exactly how the Klavis invite stayed buried.
          const hdr = m.headers ? m.headers.toString().toLowerCase() : "";
          const bulk = /list-unsubscribe:/.test(hdr)
            || /precedence:\s*(bulk|list|junk)/.test(hdr)
            || /auto-submitted:\s*auto/.test(hdr)
            || folder.toLowerCase() === "newsletter";
          inbound.push({
            uid: m.uid, folder, from, subject, bulk,
            date: e.date ? new Date(e.date).toISOString() : null,
            seen: !!(m.flags && m.flags.has && m.flags.has("\\Seen")),
          });
        }
      } finally { lock.release(); }
    }
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Unanswered scan failed: ${err?.message || err}` }], isError: true };
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }

  const byAge = (a, b) => String(a.date || "").localeCompare(String(b.date || "")); // oldest = most overdue
  const real = inbound.filter((m) => !m.bulk).sort(byAge);
  const bulk = inbound.filter((m) => m.bulk).sort(byAge);
  if (!real.length && !bulk.length) {
    return { content: [{ type: "text", text: "✅ Nothing is waiting on a reply — every human message in the mailbox has an answer in Sent." }] };
  }

  const now = Date.now();
  const age = (m) => (m.date ? Math.floor((now - new Date(m.date).getTime()) / 86400000) : "?");
  const lines = [];
  if (real.length) {
    lines.push(`⏳ **${real.length} message(s) from a real person, still owed a reply** (most overdue first):`, "");
    for (const m of real.slice(0, max)) {
      lines.push(`• uid ${m.uid} · [${m.folder}] · **${age(m)}d overdue** · ${m.seen ? "read" : "UNREAD"}`);
      lines.push(`  From: ${m.from}`);
      lines.push(`  Subject: ${m.subject}`);
      lines.push("");
    }
  } else {
    lines.push("✅ No person is waiting on a reply.", "");
  }
  if (bulk.length) {
    lines.push(`📰 Plus **${bulk.length} bulk/list message(s)** (List-Unsubscribe or newsletter) with no reply — these are mailing lists, not people waiting on Joe. Ignore them unless he says otherwise; pass include_machine:true to see them.`, "");
  }
  lines.push("Draft a reply for anything real — employer, recruiter, client, investor. If one genuinely needs no reply (a rejection, a cold pitch Joe would ignore), file it with email_file so it stops surfacing. If it's an employer answering an application, ALSO call record_employer_reply so it reaches Joe's board.");
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// --- Filing -----------------------------------------------------------------
async function toolEmailFile({ uid, uids, folder, from_folder } = {}) {
  const list = (Array.isArray(uids) ? uids : [uid]).map(Number).filter(Number.isFinite);
  if (!list.length) return { content: [{ type: "text", text: "❌ Pass uid (or uids[]) from inbox_sweep / inbox_unanswered." }], isError: true };
  if (!folder) return { content: [{ type: "text", text: "❌ Pass folder — the destination, e.g. \"Job Alerts\"." }], isError: true };
  const src = from_folder || "INBOX";
  const client = zohoImap();
  if (!client) return NO_MAIL_CREDS;
  try {
    await client.connect();
    try { await client.mailboxCreate(folder); } catch { /* already exists — fine */ }
    const lock = await client.getMailboxLock(src);
    try {
      await client.messageMove(list.join(","), folder, { uid: true });
    } finally { lock.release(); }
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Move to ${folder} failed: ${err?.message || err}` }], isError: true };
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
  await audit("email_filed", `Filed uid ${list.join(",")} from ${src} → ${folder}`, { actor: "edward" });
  return { content: [{ type: "text", text: `📁 Filed ${list.length} message(s) from ${src} → ${folder}. Still swept — filing organises, it never hides mail.` }] };
}

// ============================================================================
// DESTINY — Upwork gig hunting. Draft-only, by design.
//
// Upwork bans accounts permanently for automation: auto-submitting proposals, scraping the job
// feed, or letting a tool log in "as you" are all prohibited. RSS was killed in Aug 2024 for
// exactly that reason and the official API is gated behind partner approval we don't have. So the
// ONLY compliant ingestion path is Upwork's own saved-search alert email, which Upwork pushes to
// Joe. Reading our own mailbox is not automation against Upwork. Nothing here logs in, scrapes,
// submits, or spends a Connect — Joe does that himself.
// ============================================================================
const GIG_FOLDER = "Upwork";

async function toolListGigAlerts({ since_minutes, limit } = {}) {
  const budget = await dailyBudgetStop("destiny");
  if (budget) return budget;
  const client = zohoImap();
  if (!client) return NO_MAIL_CREDS;
  const sinceMin = Number.isFinite(since_minutes) ? since_minutes : 1440;
  const max = Math.min(Number(limit) || 15, 40);
  const since = new Date(Date.now() - sinceMin * 60 * 1000);
  const mails = [];
  try {
    await client.connect();
    try { await client.mailboxCreate(GIG_FOLDER); } catch { /* exists */ }
    const lock = await client.getMailboxLock(GIG_FOLDER);
    try {
      const uids = await client.search({ since }, { uid: true });
      for (const uid of (uids || []).slice(-max).reverse()) {
        let parsed = null;
        for await (const m of client.fetch(uid, { source: true }, { uid: true })) {
          try { parsed = await simpleParser(m.source); } catch { parsed = null; }
        }
        if (!parsed) continue;
        const body = (parsed.text || parsed.html?.replace(/<[^>]+>/g, " ") || "").replace(/[ \t]+/g, " ");
        // Deterministic only where it must be: the posting URL is the dedupe key. Everything else
        // is judgement, which is Destiny's job, not this tool's.
        const urls = [...new Set((body.match(/https?:\/\/[^\s)>\]]*upwork\.com\/[^\s)>\]]*/gi) || [])
          .map((u) => u.replace(/[.,;]+$/, "")))];
        mails.push({ uid, date: parsed.date?.toISOString() || null, subject: parsed.subject || "", body: body.trim().slice(0, 6000), urls });
      }
    } finally { lock.release(); }
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Reading the ${GIG_FOLDER} folder failed: ${err?.message || err}` }], isError: true };
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }

  if (!mails.length) {
    return { content: [{ type: "text", text: `📭 No Upwork alerts in the "${GIG_FOLDER}" folder in the last ${sinceMin} min.\n\nIf this stays empty, the saved-search alerts aren't set up yet (Joe configures those in Upwork's UI) or the mail filter isn't routing them to "${GIG_FOLDER}". Say so in your report rather than guessing — an empty folder is a setup problem, not "no gigs available".` }] };
  }

  // Dedupe: the same posting arrives in several saved-search alerts.
  let seen = new Set();
  try {
    const all = mails.flatMap((m) => m.urls);
    if (all.length) {
      const r = await query(`SELECT url FROM gigs WHERE url = ANY($1::text[])`, [all]);
      seen = new Set(r.rows.map((x) => x.url));
    }
  } catch { /* dedupe is a nicety; never block the run on it */ }

  const lines = [`📬 **${mails.length} Upwork alert email(s)** — read each and pull the gigs out yourself; I deliberately don't parse them for you:`, ""];
  for (const m of mails) {
    const fresh = m.urls.filter((u) => !seen.has(u));
    lines.push(`━━ uid ${m.uid} · ${m.date || "?"} · ${m.subject}`);
    if (m.urls.length) {
      lines.push(`  postings: ${m.urls.length} (${fresh.length} new, ${m.urls.length - fresh.length} already on the board)`);
      for (const u of fresh.slice(0, 12)) lines.push(`  • ${u}`);
    }
    lines.push(m.body, "");
  }
  lines.push("Score each NEW posting on fit_score AND win_score, then record_found_gig the ones worth Joe's Connects. Postings already on the board need nothing. Drop the rest with a reason — a dropped gig with a stated reason is a useful output.");
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolRecordFoundGig(a = {}) {
  const { title, client, url, budget, scope, description, lane, proposals_so_far, client_hires, client_verified, fit_score, win_score, fit_reason, win_reason } = a;
  if (!title) return { content: [{ type: "text", text: "❌ title is required." }], isError: true };
  if (!Number.isFinite(Number(fit_score)) || !Number.isFinite(Number(win_score))) {
    return { content: [{ type: "text", text: "❌ Both fit_score and win_score are required (0-100). win_score is the one that matters: can a profile with NO reviews win this?" }], isError: true };
  }
  try {
    const r = await query(
      `INSERT INTO gigs (title, client, url, budget, scope, description, lane,
                         proposals_so_far, client_hires, client_verified,
                         fit_score, win_score, fit_reason, win_reason, status)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'ai-agent'),$8,$9,$10,$11,$12,$13,$14,'found')
       ON CONFLICT (url) WHERE url IS NOT NULL DO NOTHING
       RETURNING id`,
      [title, client ?? null, url ?? null, budget ?? null, scope ?? null, description ?? null, lane ?? null,
       proposals_so_far ?? null, client_hires ?? null, client_verified ?? null,
       Number(fit_score), Number(win_score), fit_reason ?? null, win_reason ?? null]);
    if (!r.rows.length) return { content: [{ type: "text", text: `↩️ Already on the board (same URL) — skipped, not duplicated.` }] };
    await audit("gig_found", `${title}${client ? ` @ ${client}` : ""} — fit ${fit_score} / win ${win_score}`, { actor: "destiny", target: String(r.rows[0].id) });
    return { content: [{ type: "text", text: `✅ Gig #${r.rows[0].id} on the board for Joe: ${title}. fit ${fit_score} · win ${win_score}.` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Could not record the gig: ${err?.message || err}` }], isError: true };
  }
}

async function toolListApprovedGigs({ limit } = {}) {
  const budget = await dailyBudgetStop("destiny");
  if (budget) return budget;
  const max = Math.min(Number(limit) || 10, 25);
  let rows;
  try {
    const r = await query(
      `SELECT id, title, client, url, budget, scope, description, fit_score, win_score, fit_reason, win_reason, notes
         FROM gigs WHERE status = 'approved' ORDER BY approved_at ASC NULLS LAST, win_score DESC LIMIT $1`, [max]);
    rows = r.rows;
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Lookup failed: ${err?.message || err}` }], isError: true };
  }
  if (!rows.length) return { content: [{ type: "text", text: "📭 No approved gigs waiting. Joe hasn't approved anything new on /command/gigs — go find gigs instead, or end the turn." }] };
  const lines = [`✍️ **${rows.length} approved gig(s)** awaiting a proposal, oldest approval first:`, ""];
  for (const g of rows) {
    lines.push(`━━ #${g.id} · ${g.title}${g.client ? ` — ${g.client}` : ""}`);
    if (g.budget) lines.push(`  Budget: ${g.budget}`);
    if (g.url) lines.push(`  ${g.url}`);
    lines.push(`  fit ${g.fit_score} / win ${g.win_score}${g.win_reason ? ` — ${g.win_reason}` : ""}`);
    if (g.description) lines.push(`  ${String(g.description).slice(0, 1200)}`);
    if (g.notes) lines.push(`  Joe's note: ${g.notes}`);
    lines.push("");
  }
  lines.push("Write the proposal per AGENTS.md — their problem in their words, name the fear, evidence from OUTSIDE Upwork, one honest line about being new plus a concrete first step. Then save_gig_proposal. Max 3 per run. Never send it.");
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolSaveGigProposal({ gig_id, proposal, note } = {}) {
  if (!Number.isFinite(Number(gig_id)) || !proposal) {
    return { content: [{ type: "text", text: "❌ gig_id and proposal are both required." }], isError: true };
  }
  try {
    const r = await query(
      `UPDATE gigs SET proposal = $1, proposal_drafted_at = now(), status = 'drafted',
              notes = CASE WHEN $2::text IS NULL THEN notes
                           WHEN COALESCE(notes,'') = '' THEN $2 ELSE notes || E'\n\n' || $2 END,
              updated_at = now()
        WHERE id = $3 AND status IN ('approved','drafted') RETURNING id, title`,
      [proposal, note ?? null, Number(gig_id)]);
    if (!r.rows.length) return { content: [{ type: "text", text: `❌ Gig #${gig_id} isn't approved (or doesn't exist). Only gigs Joe approved can get a proposal.` }], isError: true };
    await audit("gig_proposal_drafted", `Proposal drafted for #${r.rows[0].id} ${r.rows[0].title}`, { actor: "destiny", target: String(r.rows[0].id) });
    return { content: [{ type: "text", text: `✅ Proposal saved on #${r.rows[0].id}. It's on /command/gigs for Joe to review, edit, and submit himself. You do NOT submit it and you never spend a Connect.` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Save failed: ${err?.message || err}` }], isError: true };
  }
}

const GIG_STATUS = ["found", "approved", "dismissed", "drafted", "submitted", "won", "lost"];
async function toolUpdateGigStatus({ gig_id, status, note } = {}) {
  if (!Number.isFinite(Number(gig_id)) || !GIG_STATUS.includes(status)) {
    return { content: [{ type: "text", text: `❌ gig_id + status required. status ∈ ${GIG_STATUS.join(", ")}.` }], isError: true };
  }
  if (status === "submitted") {
    return { content: [{ type: "text", text: "❌ Only Joe marks a gig submitted — he's the one who sends it on Upwork. You draft and stop." }], isError: true };
  }
  try {
    const r = await query(
      `UPDATE gigs SET status = $1,
              notes = CASE WHEN $2::text IS NULL THEN notes
                           WHEN COALESCE(notes,'') = '' THEN $2 ELSE notes || E'\n\n' || $2 END,
              updated_at = now()
        WHERE id = $3 RETURNING id, title, status`, [status, note ?? null, Number(gig_id)]);
    if (!r.rows.length) return { content: [{ type: "text", text: `❌ No gig #${gig_id}.` }], isError: true };
    await audit("gig_status", `#${r.rows[0].id} ${r.rows[0].title} → ${status}`, { actor: "destiny", target: String(r.rows[0].id) });
    return { content: [{ type: "text", text: `✅ #${r.rows[0].id} → ${status}.` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Update failed: ${err?.message || err}` }], isError: true };
  }
}

// Venus's read on the gig pipeline. Kept separate from get_job_hunt_report on purpose: that one
// is Whitney's job hunt (Joe as an employee); this is contract work he sells.
async function toolGetGigReport() {
  const vBudget = await dailyBudgetStop("main");
  if (vBudget) return vBudget;
  let rep, counts, ready;
  try {
    [rep, counts, ready] = await Promise.all([
      query(`SELECT summary, created_at FROM activity_log WHERE event_type = 'gig_hunt_report' ORDER BY created_at DESC LIMIT 1`),
      query(`SELECT status, count(*)::int n FROM gigs GROUP BY status`),
      query(`SELECT id, title, client FROM gigs WHERE status = 'drafted' ORDER BY proposal_drafted_at ASC LIMIT 10`),
    ]);
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Gig report failed: ${err?.message || err}` }], isError: true };
  }
  const by = Object.fromEntries(counts.rows.map((r) => [r.status, r.n]));
  const lines = [];
  if (rep.rows.length) {
    const age = Math.round((Date.now() - new Date(rep.rows[0].created_at).getTime()) / 3600000);
    lines.push(`📄 **Destiny's latest gig report** (${age}h ago):`, "", rep.rows[0].summary, "");
  } else {
    lines.push("📄 Destiny hasn't filed a gig report yet.", "");
  }
  lines.push(`Board: ${by.found ?? 0} awaiting Joe's approval · ${by.approved ?? 0} approved (proposal pending) · ${by.drafted ?? 0} drafted · ${by.submitted ?? 0} submitted · ${by.won ?? 0} won / ${by.lost ?? 0} lost`);
  if (ready.rows.length) {
    lines.push("", `✍️ **${ready.rows.length} proposal(s) written and waiting on JOE to send** — he is the only one who can submit, so these stall until he acts:`);
    for (const g of ready.rows) lines.push(`• #${g.id} ${g.title}${g.client ? ` — ${g.client}` : ""}`);
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// --- Following up on silence ------------------------------------------------
// The failure this closes: an application is submitted, the ATS auto-confirms, and then nothing
// ever happens again. Nobody notices, because "applied" looks like success. This asks the only
// question that matters after a submission — who has gone quiet, and for how long?
async function toolListFollowupDue({ days, limit } = {}) {
  const minDays = Number.isFinite(Number(days)) ? Number(days) : 7;
  const max = Math.min(Number(limit) || 15, 40);
  let rows;
  try {
    const r = await query(
      `SELECT id, company, role, platform, applied_at, contact_info, notes,
              EXTRACT(DAY FROM (now() - applied_at))::int AS days_silent
         FROM job_applications
        WHERE status = 'applied'
          AND applied_at IS NOT NULL
          AND applied_at < now() - ($1 || ' days')::interval
          AND COALESCE(notes, '') NOT LIKE '%[employer reply%'
          AND COALESCE(notes, '') NOT LIKE '%[followed up%'
        ORDER BY applied_at ASC
        LIMIT $2`, [String(minDays), max]);
    rows = r.rows;
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Follow-up scan failed: ${err?.message || err}` }], isError: true };
  }
  if (!rows.length) {
    return { content: [{ type: "text", text: `✅ Nothing is due a follow-up — no application has been silent longer than ${minDays} days without a reply already recorded.` }] };
  }
  const lines = [`📮 **${rows.length} application(s) silent ${minDays}+ days** — no employer response recorded. Oldest first:`, ""];
  for (const r of rows) {
    let contact = "";
    try {
      const ci = typeof r.contact_info === "string" ? JSON.parse(r.contact_info) : r.contact_info;
      if (ci) {
        const bits = [ci.recruiter_name || ci.name, ci.email, ci.linkedin].filter(Boolean);
        if (bits.length) contact = bits.join(" · ");
      }
    } catch { /* contact_info is free-form; ignore shape errors */ }
    lines.push(`• #${r.id} · **${r.days_silent}d silent** · ${r.company} — ${r.role}${r.platform ? ` (${r.platform})` : ""}`);
    if (contact) lines.push(`  Contact: ${contact}`);
    lines.push("");
  }
  lines.push(
    "For each, draft ONE short, warm follow-up and queue it with email_request_send.",
    "• Reply INTO the existing ATS thread in `Job Alerts` where one exists — that reaches a real inbox; a fresh mail to a no-reply address does not.",
    "• If the only address is no-reply and there's no named contact, DON'T invent one: say so in your report and let Joe decide whether to chase it on LinkedIn.",
    "• Never follow up twice on the same application, and never chase a rejection.",
    "• After you queue one, call record_employer_reply with kind 'info' and a summary starting '[followed up' so it stops appearing here.",
  );
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// --- Employer replies must reach the database -------------------------------
// Whitney writes to job_applications; employers write to the mailbox. Nothing joined the two,
// so an interview invite was invisible to Venus's debrief and to /command/applications.
async function toolRecordEmployerReply({ application_id, company, kind, summary } = {}) {
  const KINDS = { interview: "interview", rejected: "rejected", offer: "interview", info: null };
  if (!kind || !(kind in KINDS)) {
    return { content: [{ type: "text", text: "❌ kind must be one of: interview, offer, rejected, info." }], isError: true };
  }
  if (!summary) return { content: [{ type: "text", text: "❌ summary is required — one line on what the employer actually said." }], isError: true };

  let row = null;
  try {
    if (Number.isFinite(Number(application_id))) {
      const r = await query(`SELECT id, company, role, status FROM job_applications WHERE id = $1`, [Number(application_id)]);
      row = r.rows[0] || null;
    } else if (company) {
      const r = await query(
        `SELECT id, company, role, status FROM job_applications
          WHERE company ILIKE $1 ORDER BY updated_at DESC LIMIT 1`, [`%${company}%`]);
      row = r.rows[0] || null;
    }
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Lookup failed: ${err?.message || err}` }], isError: true };
  }
  if (!row) {
    return { content: [{ type: "text", text: `❌ No application matched (application_id ${application_id ?? "—"}, company "${company ?? "—"}"). Don't guess: report it in your log so Joe can match it by hand.` }], isError: true };
  }

  const nextStatus = KINDS[kind];
  const note = `[employer reply · ${new Date().toISOString().slice(0, 10)}] ${summary}`;
  try {
    await query(
      `UPDATE job_applications
          SET status = COALESCE($1, status),
              notes = CASE WHEN COALESCE(notes,'') = '' THEN $2 ELSE notes || E'\n\n' || $2 END,
              updated_at = now()
        WHERE id = $3`, [nextStatus, note, row.id]);
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Update failed: ${err?.message || err}` }], isError: true };
  }
  await audit(kind === "interview" ? "application_interview" : "application_employer_reply",
    `${row.company} — ${row.role}: ${summary}`, { actor: "edward", target: String(row.id) });
  const moved = nextStatus && nextStatus !== row.status ? ` Status ${row.status} → ${nextStatus}.` : "";
  return { content: [{ type: "text", text: `✅ Recorded on #${row.id} ${row.company} — ${row.role}.${moved} It will now show on /command/applications and in Venus's debrief.` }] };
}

async function toolEmailRequestSend({ to, cc, subject, body, in_reply_to, context, send_at } = {}) {
  if (!to || !subject || !body) return { content: [{ type: "text", text: "❌ to, subject, and body are required." }], isError: true };
  let sendAt = null;
  if (send_at) {
    sendAt = new Date(send_at);
    if (isNaN(sendAt.getTime())) return { content: [{ type: "text", text: `❌ send_at "${send_at}" isn't a parseable datetime (use ISO, e.g. 2026-08-27T09:00:00-07:00).` }], isError: true };
  }
  const res = await query(
    `INSERT INTO email_outbox (to_addr, cc_addr, subject, body, in_reply_to, context, send_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [String(to).trim(), cc ? String(cc).trim() : null, subject, body, in_reply_to || null, context || null, sendAt],
  );
  const id = res.rows[0].id;
  await audit("email_send_requested", `Outbox #${id} to ${to}: ${subject}${sendAt ? ` (scheduled ${sendAt.toISOString()})` : ""}`, { actor: "edward", target: to, detail: { id, send_at: sendAt?.toISOString() || null } });
  return { content: [{ type: "text", text: `📤 Queued as outbox #${id}, awaiting Venus's approval${sendAt ? ` (requested send time ${sendAt.toISOString()})` : ""}. Report the id to Venus; you're done with this one until she decides.` }] };
}

async function toolEmailListPendingSends({ status } = {}) {
  const st = ["pending", "approved", "sent", "rejected", "failed"].includes(String(status)) ? String(status) : "pending";
  const res = await query(
    `SELECT id, to_addr, subject, context, send_at, status, requested_by, decided_by, decision_note, sent_at, error, created_at
       FROM email_outbox WHERE status = $1 ORDER BY created_at DESC LIMIT 25`,
    [st],
  );
  if (!res.rows.length) return { content: [{ type: "text", text: `📭 No ${st} sends in the outbox.` }] };
  const lines = [`📬 **${res.rows.length} ${st} send(s):**`, ""];
  for (const r of res.rows) {
    lines.push(`• #${r.id} → ${r.to_addr} · "${r.subject}"`);
    if (r.context) lines.push(`  why: ${r.context}`);
    if (r.send_at) lines.push(`  scheduled: ${new Date(r.send_at).toISOString()}`);
    if (r.decided_by) lines.push(`  decided by ${r.decided_by}${r.decision_note ? ` — ${r.decision_note}` : ""}`);
    if (r.error) lines.push(`  ⚠️ error: ${r.error}`);
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// Actually fire one approved outbox row over Zoho SMTP. Shared by email_approve_send
// (immediate sends) and scripts/email-outbox-drain.mjs (scheduled sends).
async function sendOutboxRow(row) {
  const USER = process.env.SMTP_USER, PASS = process.env.SMTP_PASS;
  if (!USER || !PASS) throw new Error("SMTP_USER/SMTP_PASS missing");
  const transport = nodemailer.createTransport({ host: "smtp.zoho.com", port: 465, secure: true, auth: { user: USER, pass: PASS } });
  await transport.sendMail({
    from: `Joe Sardella <${USER}>`,
    to: row.to_addr,
    cc: row.cc_addr || undefined,
    subject: row.subject,
    text: row.body,
    inReplyTo: row.in_reply_to || undefined,
    references: row.in_reply_to || undefined,
  });
}

async function toolEmailApproveSend({ id, note } = {}) {
  if (!Number.isFinite(Number(id))) return { content: [{ type: "text", text: "❌ id is required (from email_list_pending_sends)." }], isError: true };
  const cur = await query(`SELECT * FROM email_outbox WHERE id = $1`, [Number(id)]);
  if (!cur.rows.length) return { content: [{ type: "text", text: `❌ Outbox #${id} not found.` }], isError: true };
  const row = cur.rows[0];
  if (row.status !== "pending") return { content: [{ type: "text", text: `❌ Outbox #${id} is '${row.status}', not pending — nothing to approve.` }], isError: true };

  const scheduledFuture = row.send_at && new Date(row.send_at).getTime() > Date.now();
  await query(
    `UPDATE email_outbox SET status = 'approved', decided_by = 'venus', decided_at = now(), decision_note = $2 WHERE id = $1`,
    [row.id, note || null],
  );
  await audit("email_send_approved", `Outbox #${row.id} to ${row.to_addr}: ${row.subject}`, { actor: "venus", target: row.to_addr, detail: { id: row.id, note } });

  if (scheduledFuture) {
    return { content: [{ type: "text", text: `✅ Approved #${row.id} — scheduled; the outbox drain sends it at ${new Date(row.send_at).toISOString()}.` }] };
  }
  try {
    await sendOutboxRow(row);
    await query(`UPDATE email_outbox SET status = 'sent', sent_at = now() WHERE id = $1`, [row.id]);
    await audit("email_sent", `Outbox #${row.id} sent to ${row.to_addr}: ${row.subject}`, { actor: "venus", target: row.to_addr, detail: { id: row.id } });
    return { content: [{ type: "text", text: `✅ Approved and SENT #${row.id} to ${row.to_addr} ("${row.subject}").` }] };
  } catch (err) {
    const msg = String(err?.message || err);
    await query(`UPDATE email_outbox SET status = 'failed', error = $2 WHERE id = $1`, [row.id, msg]);
    await audit("email_send_failed", `Outbox #${row.id} to ${row.to_addr} failed: ${msg}`, { actor: "venus", target: row.to_addr, detail: { id: row.id } });
    return { content: [{ type: "text", text: `❌ Approved #${row.id} but the send FAILED: ${msg}. It's marked failed — surface this to Joe.` }], isError: true };
  }
}

// Venus: Edward's latest filed inbox report (he logs one per sweep as
// event_type='email_inbox_report') + the pending-approval queue, in one call —
// everything needed to compose the Telegram update for Joe.
async function toolGetInboxReport() {
  const vBudget = await dailyBudgetStop("main");
  if (vBudget) return vBudget;
  const rep = await query(
    `SELECT summary, created_at FROM activity_log
      WHERE event_type = 'email_inbox_report' ORDER BY created_at DESC LIMIT 1`,
  );
  // The follow-up run files under its own event type so it doesn't overwrite the sweep report.
  // Venus needs BOTH — the sweep says what arrived, the follow-up says what has gone silent.
  const followup = await query(
    `SELECT summary, created_at FROM activity_log
      WHERE event_type = 'job_followup_report' ORDER BY created_at DESC LIMIT 1`,
  );
  const pending = await query(
    `SELECT id, to_addr, subject, context, send_at FROM email_outbox WHERE status = 'pending' ORDER BY created_at DESC LIMIT 25`,
  );
  const lines = [];
  if (rep.rows.length) {
    const age = Math.round((Date.now() - new Date(rep.rows[0].created_at).getTime()) / 60000);
    lines.push(`📥 **Edward's latest inbox report** (${age} min ago):`, "", rep.rows[0].summary, "");
  } else {
    lines.push("📭 Edward hasn't filed an inbox report yet (no email_inbox_report in activity_log).", "");
  }
  if (followup.rows.length) {
    const fAge = Math.round((Date.now() - new Date(followup.rows[0].created_at).getTime()) / 3600000);
    lines.push(`📮 **Edward's latest follow-up report** (${fAge}h ago) — applications that have gone silent:`, "", followup.rows[0].summary, "");
  }
  if (pending.rows.length) {
    lines.push(`⏳ **${pending.rows.length} send(s) awaiting your approval** (email_approve_send / email_reject_send):`);
    for (const r of pending.rows) {
      lines.push(`• #${r.id} → ${r.to_addr} · "${r.subject}"${r.context ? ` — ${r.context}` : ""}${r.send_at ? ` (wants ${new Date(r.send_at).toISOString()})` : ""}`);
    }
  } else {
    lines.push("✅ No sends awaiting approval.");
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolEmailRejectSend({ id, note } = {}) {
  if (!Number.isFinite(Number(id))) return { content: [{ type: "text", text: "❌ id is required (from email_list_pending_sends)." }], isError: true };
  const res = await query(
    `UPDATE email_outbox SET status = 'rejected', decided_by = 'venus', decided_at = now(), decision_note = $2
      WHERE id = $1 AND status = 'pending' RETURNING to_addr, subject`,
    [Number(id), note || null],
  );
  if (!res.rows.length) return { content: [{ type: "text", text: `❌ Outbox #${id} not found or not pending.` }], isError: true };
  await audit("email_send_rejected", `Outbox #${id} to ${res.rows[0].to_addr}: ${res.rows[0].subject}${note ? ` — ${note}` : ""}`, { actor: "venus", target: res.rows[0].to_addr, detail: { id: Number(id), note } });
  return { content: [{ type: "text", text: `🚫 Rejected #${id}${note ? ` — ${note}` : ""}. Tell Edward why so the next draft is better.` }] };
}

// Whitney ↔ Joe question loop. When Whitney can't proceed truthfully (a field she can't
// answer, a judgment call), she records a question against the job instead of guessing or
// silently stopping. Joe answers on /command/applications; she reads the answer next run and
// resumes. This is how "escalate rather than fabricate" becomes a resumable loop.
async function toolRecordQuestion({ application_id, question, options, topic }) {
  if (!question) return { content: [{ type: "text", text: "❌ question is required." }], isError: true };
  // Ask-once: if this maps to a durable fact I already learned, don't ask Joe again.
  if (topic) {
    const known = await query(`SELECT fact FROM candidate_facts WHERE topic = $1`, [topic]);
    if (known.rows.length) {
      return { content: [{ type: "text", text: `✅ Already known — ${topic}: ${known.rows[0].fact}\nUse this to answer; do NOT ask Joe again.` }] };
    }
  }
  let appLabel = "";
  if (application_id) {
    const a = await query(`SELECT company, role FROM job_applications WHERE id = $1`, [application_id]);
    if (a.rows.length) appLabel = ` about ${a.rows[0].role} @ ${a.rows[0].company}`;
  }
  const res = await query(
    `INSERT INTO agent_questions (application_id, agent, question, status, options, topic)
     VALUES ($1, 'whitney', $2, 'open', $3::jsonb, $4) RETURNING id`,
    [application_id || null, question, Array.isArray(options) && options.length ? JSON.stringify(options) : null, topic || null],
  );
  const id = res.rows[0].id;
  await audit("agent_question", `Whitney asked${appLabel}: ${String(question).slice(0, 160)}`, {
    actor: "whitney", detail: { question_id: id, application_id: application_id || null },
  });

  // Escalate to Joe's Telegram immediately. The board is passive — a blocked application
  // sits dead until he looks at it — so the ping is what makes this loop actually resumable.
  const opts = Array.isArray(options) && options.length
    ? `\n\nOptions: ${options.map((o) => tgEscape(o)).join(" · ")}`
    : "";
  const tgSent = await notifyJoeTelegram(
    `🙋 <b>Whitney is blocked</b>${appLabel ? ` — ${tgEscape(appLabel.replace(/^ about /, ""))}` : ""}\n\n` +
      `<b>Q#${id}:</b> ${tgEscape(question)}${opts}\n\n` +
      `Answer, or <b>Decline to answer</b> (declining cancels this application and frees her to move on):\n` +
      `https://thinkbigjoe.com/command/applications`,
  );

  return { content: [{ type: "text", text: `✅ Question posted for Joe (#${id})${appLabel}${tgSent ? " and sent to his Telegram" : ""}. He can ANSWER it, or DECLINE to answer — a decline cancels this application, and that's a legitimate outcome, not a failure. Either way I pick it up next run via list_answered_questions. Do not wait on this one now: move to the next thing.` }] };
}

async function toolListAnsweredQuestions() {
  const res = await query(
    `SELECT q.id, q.application_id, q.question, q.answer, q.status, q.answered_at,
            j.company, j.role, j.status AS job_status
     FROM agent_questions q
     LEFT JOIN job_applications j ON j.id = q.application_id
     WHERE q.status IN ('answered', 'declined')
     ORDER BY q.answered_at ASC NULLS LAST
     LIMIT 25`,
  );
  if (!res.rows.length) return { content: [{ type: "text", text: "📭 No decisions waiting. Nothing to resume from Joe's side." }] };

  const where = (r) => (r.application_id ? `#${r.application_id} ${r.role} @ ${r.company} (job: ${r.job_status})` : "(general)");
  const answered = res.rows.filter((r) => r.status === "answered");
  const declined = res.rows.filter((r) => r.status === "declined");
  const lines = [];

  if (answered.length) {
    lines.push(`💡 **${answered.length} answered question(s) from Joe** — act on these, then mark_question_resolved each:`, "");
    for (const r of answered) {
      lines.push(`**Q#${r.id} · ${where(r)}**`);
      lines.push(`Q: ${r.question}`);
      lines.push(`A: ${r.answer}`);
      lines.push("");
    }
  }

  // Joe declining to answer is a DECISION, not a dead end. The application is already
  // cancelled (job status 'closed') by the time this shows up — so there is nothing left
  // to work, and nothing to chase. She acknowledges it and spends the turn elsewhere.
  if (declined.length) {
    lines.push(`🚫 **${declined.length} question(s) Joe DECLINED to answer** — the application is CANCELLED. This is a normal outcome, not a failure or a rejection of me:`, "");
    for (const r of declined) {
      lines.push(`**Q#${r.id} · ${where(r)}**`);
      lines.push(`Q: ${r.question}`);
      lines.push(`→ Joe declined. Job #${r.application_id} is closed. Do NOT apply to it, do NOT ask again, do NOT ask a reworded version of this question.`);
      lines.push("");
    }
    lines.push("_For each declined one: mark_question_resolved it, then move on to the next job in the queue. Don't spend the turn on it._");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolMarkQuestionResolved({ id }) {
  const r = await query(`UPDATE agent_questions SET status = 'resolved' WHERE id = $1 RETURNING application_id`, [id]);
  if (!r.rows.length) return { content: [{ type: "text", text: `❌ No question #${id}.` }], isError: true };
  return { content: [{ type: "text", text: `✅ Question #${id} resolved — I've used Joe's answer.` }] };
}

// VENUS: deliver a composed update to Joe's Telegram herself.
//
// Why this exists instead of OpenClaw's --announce: a cron on Venus's MAIN session is refused
// delivery flags outright ("--announce/--no-deliver require a non-main agentTurn or command
// session target"), and the agent-cron path defaults to `--channel last`, which fail-closes on
// this machine because BOTH discord and telegram are configured ("Channel is required when
// multiple channels are configured"). Rather than demote Venus to a worker agent just to get a
// delivery route, she composes the message and calls this to send it. She still decides every
// word — the tool is only the wire.
async function toolSendTelegramUpdate({ text }) {
  if (!text || !String(text).trim()) {
    return { content: [{ type: "text", text: "❌ text is required — compose the update, then send it." }], isError: true };
  }
  // Telegram HTML mode: escape first (a stray < or & in agent-written text fails the whole
  // send), then re-introduce only the markup we control. Markdown-style **bold** is what an
  // agent naturally writes, so translate it rather than leaving asterisks on Joe's screen.
  const body = tgEscape(String(text))
    .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
    .replace(/(^|[\s(])_(?!_)(.+?)_(?=[\s.,!?)]|$)/gs, "$1<i>$2</i>");

  const ok = await notifyJoeTelegram(body);
  if (!ok) {
    return { content: [{ type: "text", text: "❌ Telegram send FAILED (token/chat not configured, or the API rejected it). Joe did NOT receive this. Do not pretend it went out — say so in your run log." }], isError: true };
  }
  await audit("telegram_update_sent", String(text).replace(/\s+/g, " ").slice(0, 200), { actor: "venus" });
  return { content: [{ type: "text", text: "📨 Sent to Joe's Telegram. That was the delivery — you're done; don't also 'report' it somewhere else." }] };
}

// VENUS: the job-hunt rollup she reads for Joe's Telegram debrief. Deliberately computed
// from the TABLES, not from Whitney's self-reported log_activity summaries — same principle as
// the audit trail: the debrief should say what actually happened, not what she said happened.
// Her own run notes ride along underneath as colour, clearly labelled as self-reported.
async function toolGetJobHuntReport({ since_hours } = {}) {
  const vBudget = await dailyBudgetStop("main");
  if (vBudget) return vBudget;
  const hours = Math.max(1, Math.min(Number(since_hours) || 12, 168));
  const label = (r) => `${r.role} @ ${r.company}`;

  const [applied, interview, working, blocked, queued, review, notes] = await Promise.all([
    query(`SELECT id, company, role, applied_at FROM job_applications
           WHERE status IN ('applied','interview') AND applied_at > now() - ($1 || ' hours')::interval
           ORDER BY applied_at DESC`, [String(hours)]),
    query(`SELECT id, company, role FROM job_applications WHERE status = 'interview' ORDER BY updated_at DESC`),
    query(`SELECT id, company, role, status FROM job_applications
           WHERE status IN ('account_created','verified') ORDER BY updated_at DESC`),
    query(`SELECT q.id, q.question, q.created_at, j.company, j.role, j.id AS job_id
           FROM agent_questions q LEFT JOIN job_applications j ON j.id = q.application_id
           WHERE q.agent = 'whitney' AND q.status = 'open' ORDER BY q.created_at ASC`),
    query(`SELECT count(*)::int n FROM job_applications WHERE status = 'approved'`),
    query(`SELECT count(*)::int n FROM job_applications WHERE status = 'found'`),
    query(`SELECT summary, created_at FROM activity_log
           WHERE actor = 'whitney' AND created_at > now() - ($1 || ' hours')::interval
           ORDER BY created_at DESC LIMIT 8`, [String(hours)]),
  ]);

  const lines = [`📮 **Job hunt — last ${hours}h** (from the tables, not self-reported)`, ""];

  lines.push(`**APPLIED (${applied.rows.length}):**`);
  if (applied.rows.length) for (const r of applied.rows) lines.push(`• #${r.id} ${label(r)}`);
  else lines.push("• none in this window");
  lines.push("");

  if (interview.rows.length) {
    lines.push(`**🎉 INTERVIEW STAGE (${interview.rows.length}):**`);
    for (const r of interview.rows) lines.push(`• #${r.id} ${label(r)}`);
    lines.push("");
  }

  if (working.rows.length) {
    lines.push(`**IN PROGRESS (${working.rows.length}):**`);
    for (const r of working.rows) lines.push(`• #${r.id} ${label(r)} — ${r.status}`);
    lines.push("");
  }

  // The half Joe asked for by name: what is STUCK on him, and what she asked.
  lines.push(`**⏳ PENDING ON JOE — open questions (${blocked.rows.length}):**`);
  if (blocked.rows.length) {
    for (const r of blocked.rows) {
      const where = r.job_id ? `${label(r)} (job #${r.job_id})` : "general";
      lines.push(`• Q#${r.id} · ${where}`);
      lines.push(`  "${String(r.question).replace(/\s+/g, " ").slice(0, 200)}"`);
    }
  } else lines.push("• none — nothing is blocked on him");
  lines.push("");

  lines.push(`**QUEUE:** ${queued.rows[0].n} approved waiting for her · ${review.rows[0].n} found waiting for Joe's approval`);

  if (notes.rows.length) {
    lines.push("", "_Whitney's own run notes (self-reported):_");
    for (const n of notes.rows) lines.push(`• ${String(n.summary).replace(/\s+/g, " ").slice(0, 180)}`);
  }

  lines.push(
    "",
    "_For Joe's Telegram debrief: lead with what she APPLIED to (titles + companies — he wants the names, not just a count), then anything at INTERVIEW stage, then how many questions are PENDING on him and what they are. Each pending question he can answer or DECLINE on /command/applications — declining cancels that application. If nothing applied and nothing is pending, say so in one line rather than padding._",
  );

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// Joe's resume + LinkedIn — Whitney's source of truth for his history. She NEVER claims anything
// not backed by this. Reads RESUME_PATH (a file) + LINKEDIN_URL from .env.local.
async function toolGetCandidateProfile() {
  const linkedin = process.env.LINKEDIN_URL || null;
  const resumePath = process.env.RESUME_PATH || null;
  let resumeText = null, note = null;
  if (resumePath) {
    try { resumeText = readFileSync(resumePath, "utf8"); }
    catch (e) { note = `⚠️ Could not read RESUME_PATH (${resumePath}): ${e?.message || e}`; }
  }
  if (!resumeText && !linkedin) {
    return { content: [{ type: "text", text: "⚠️ No candidate profile configured yet (RESUME_PATH / LINKEDIN_URL not set in .env.local). I can FIND and score jobs, but I can't TAILOR or truthfully APPLY without Joe's resume — record_question to Joe or hold applying until he provides it." }] };
  }
  const lines = ["📄 **Joe's candidate profile — SOURCE OF TRUTH. Never claim anything not backed by this.**", ""];
  if (linkedin) lines.push(`LinkedIn: ${linkedin}`);
  if (resumeText) lines.push("", "--- RESUME ---", resumeText.slice(0, 12000));
  if (note) lines.push("", note);
  const facts = await query(`SELECT topic, fact FROM candidate_facts ORDER BY topic`);
  if (facts.rows.length) {
    lines.push("", "--- REMEMBERED FACTS (answer screening questions from these; never re-ask) ---");
    for (const f of facts.rows) lines.push(`• ${f.topic}: ${f.fact}`);
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// Whitney's durable memory about Joe — recurring application facts (work authorization, relocation,
// clearance, etc.). Learn once, then answer screening questions truthfully without re-asking.
async function toolRememberFact({ topic, fact }) {
  if (!topic || !fact) return { content: [{ type: "text", text: "❌ topic and fact are required." }], isError: true };
  const key = String(topic).trim().toLowerCase().replace(/\s+/g, "_").slice(0, 60);
  await query(
    `INSERT INTO candidate_facts (topic, fact) VALUES ($1, $2)
     ON CONFLICT (topic) DO UPDATE SET fact = EXCLUDED.fact, updated_at = now()`,
    [key, fact],
  );
  await audit("candidate_fact", `Remembered "${key}"`, { actor: "whitney", detail: { topic: key } });
  return { content: [{ type: "text", text: `🧠 Remembered — ${key}: ${fact}\nI'll answer this from memory and won't ask Joe again.` }] };
}

async function toolGetCandidateFacts() {
  const r = await query(`SELECT topic, fact FROM candidate_facts ORDER BY topic`);
  if (!r.rows.length) return { content: [{ type: "text", text: "No remembered facts about Joe yet." }] };
  const lines = ["🧠 **What I remember about Joe** (answer screening questions from these; never re-ask):", ""];
  for (const f of r.rows) lines.push(`• ${f.topic}: ${f.fact}`);
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// Login/signup credentials Whitney uses to CREATE accounts on job sites. Sourced from .env.local
// (never persona/DB). If no password is set, she must NOT fabricate one — hold + ask Joe.
async function toolGetSignupCredentials() {
  const email = process.env.JOB_SIGNUP_EMAIL || "joe@thinkbigjoe.com";
  const password = process.env.JOB_SIGNUP_PASSWORD || null;
  if (!password) {
    return { content: [{ type: "text", text: "⚠️ No signup password is set yet (JOB_SIGNUP_PASSWORD missing in .env.local). I can't create an account — record_question for Joe and HOLD this application until he provides it. Do not invent a password." }] };
  }
  return { content: [{ type: "text", text: `Registration identity for creating job-site accounts:\nEmail: ${email}\nPassword: ${password}\n\nUse these ONLY in a site's signup/login form, verify the account via inbox_search on joe@thinkbigjoe.com, then continue. Never paste these anywhere else.` }] };
}

async function toolScheduleFollowup({ prospect_id, touch_number, days_from_now, body }) {
  const existing = await query(
    `SELECT id FROM follow_ups WHERE prospect_id = $1 AND touch_number = $2 LIMIT 1`,
    [prospect_id, touch_number],
  );
  if (existing.rows.length) {
    return {
      content: [{
        type: "text",
        text: `⚠️ Follow-up touch ${touch_number} for prospect #${prospect_id} already scheduled (id: ${existing.rows[0].id}). Nothing added.`,
      }],
    };
  }
  const res = await query(
    `INSERT INTO follow_ups (prospect_id, touch_number, scheduled_for, body, status)
     VALUES ($1, $2, NOW() + ($3 || ' days')::interval, $4, 'pending')
     RETURNING id, scheduled_for`,
    [prospect_id, touch_number, String(days_from_now), body],
  );
  const row = res.rows[0];
  const date = new Date(row.scheduled_for).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const pn = await query(`SELECT name FROM prospects WHERE id = $1`, [prospect_id]);
  const name = pn.rows[0]?.name ?? null;
  await audit("followup_scheduled", `Scheduled touch ${touch_number} for ${name || `prospect #${prospect_id}`} (due ${date})`, {
    prospectId: prospect_id,
    target: name,
    detail: { touch: touch_number, scheduledFor: row.scheduled_for, body },
  });
  return {
    content: [{
      type: "text",
      text: `✅ Follow-up touch #${touch_number} scheduled for prospect #${prospect_id} on ${date} (follow_up id: ${row.id}).`,
    }],
  };
}

async function toolListConnectedWithoutFollowups() {
  const res = await query(
    `SELECT p.id, p.name, p.company, p.vertical, p.profile_url
     FROM prospects p
     WHERE p.status = 'connected'
       AND p.paused = false
       AND NOT EXISTS (
         SELECT 1 FROM follow_ups f WHERE f.prospect_id = p.id
       )
     ORDER BY p.updated_at ASC
     LIMIT 50`,
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "✅ All connected prospects already have follow-ups scheduled." }] };
  }
  const lines = [`📋 **${res.rows.length} connected prospect(s) with no follow-ups scheduled:**`, ""];
  for (const r of res.rows) {
    lines.push(`**#${r.id} — ${r.name}** · ${r.company || ""}${r.vertical ? ` · ${r.vertical}` : ""}`);
    if (r.profile_url) lines.push(`LinkedIn: ${r.profile_url}`);
    lines.push("_(call schedule_followup with this prospect_id)_");
    lines.push("");
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolListIncompleteFollowupSequences() {
  const res = await query(
    `SELECT p.id, p.name, p.company, p.vertical, p.profile_url,
            array_agg(f.touch_number ORDER BY f.touch_number) AS scheduled_touches
     FROM prospects p
     JOIN follow_ups f ON f.prospect_id = p.id
     WHERE p.status = 'connected' AND p.paused = false
     GROUP BY p.id, p.name, p.company, p.vertical, p.profile_url
     HAVING NOT (1 = ANY(array_agg(f.touch_number))
              AND 2 = ANY(array_agg(f.touch_number))
              AND 3 = ANY(array_agg(f.touch_number)))
     ORDER BY p.updated_at ASC
     LIMIT 50`,
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "✅ All connected prospects have complete 3-touch sequences." }] };
  }
  const lines = [`📋 **${res.rows.length} prospect(s) with incomplete follow-up sequences:**`, ""];
  for (const r of res.rows) {
    const missing = [1, 2, 3].filter((t) => !r.scheduled_touches.includes(t));
    lines.push(`**#${r.id} — ${r.name}** · ${r.company || ""}${r.vertical ? ` · ${r.vertical}` : ""}`);
    lines.push(`Has touches: ${r.scheduled_touches.join(", ")} · Missing: ${missing.join(", ")}`);
    if (r.profile_url) lines.push(`LinkedIn: ${r.profile_url}`);
    lines.push("");
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolListDueFollowups() {
  const res = await query(
    `SELECT f.id, f.touch_number, f.body, f.scheduled_for,
            p.id AS prospect_id, p.name, p.profile_url, p.vertical
     FROM follow_ups f
     JOIN prospects p ON p.id = f.prospect_id
     WHERE f.status = 'pending' AND f.scheduled_for <= NOW() AND p.paused = false
     ORDER BY f.scheduled_for ASC
     LIMIT 10`,
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "No follow-ups due — queue is clear." }] };
  }
  const lines = [`💬 **${res.rows.length} follow-up(s) due:**`, ""];
  for (const r of res.rows) {
    const due = new Date(r.scheduled_for).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    lines.push(`**#${r.id} — ${r.name}** (prospect #${r.prospect_id}) · Touch ${r.touch_number} · Due: ${due}`);
    if (r.profile_url) lines.push(`LinkedIn: ${r.profile_url}`);
    if (r.body) lines.push(`Message to send: ${r.body}`);
    lines.push("_(call mark_followup_sent with followup_id after sending)_");
    lines.push("");
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolMarkFollowupSent({ followup_id, notes }) {
  const res = await query(
    `UPDATE follow_ups SET status = 'sent', sent_at = now(), updated_at = now() WHERE id = $1 RETURNING id, prospect_id, touch_number, body`,
    [followup_id],
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: `Follow-up #${followup_id} not found.` }] };
  }
  const row = res.rows[0];
  const pn = await query(`SELECT name FROM prospects WHERE id = $1`, [row.prospect_id]);
  const fname = pn.rows[0]?.name ?? null;
  await audit("followup_sent", `Sent follow-up touch ${row.touch_number} to ${fname || `prospect #${row.prospect_id}`}`, {
    prospectId: row.prospect_id,
    target: fname,
    detail: { touch: row.touch_number, body: row.body, notes: notes || null },
  });
  const extra = notes ? `\nNotes: ${notes}` : "";
  return {
    content: [{
      type: "text",
      text: `✅ Follow-up #${followup_id} marked sent (prospect #${row.prospect_id}, touch ${row.touch_number}).${extra}`,
    }],
  };
}

async function toolBookAppointment({ name, email, start_time, end_time, phone, company, notes }) {
  const apiKey = process.env.VENUS_API_KEY;
  if (!apiKey) {
    return { content: [{ type: "text", text: "❌ VENUS_API_KEY is not set in environment." }] };
  }
  try {
    const resp = await fetch("https://thinkbigjoe.com/api/appointments/venus-book", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ name, email, startTime: start_time, endTime: end_time, phone, company, notes }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return { content: [{ type: "text", text: `❌ Booking failed (${resp.status}): ${data?.error || "unknown error"}` }] };
    }
    await audit("booking_made", `Booked strategy call for ${name}`, {
      target: name,
      detail: { email, startTime: start_time, company: company || null },
    });
    return {
      content: [{
        type: "text",
        text: `✅ Strategy call booked for ${name} (${email})!\nMeeting link: ${data.htmlLink || "(link not returned)"}`,
      }],
    };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Booking request failed: ${err?.message || String(err)}` }] };
  }
}

async function toolGenerateForgePreview({ site_id, slug }) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return { content: [{ type: "text", text: "❌ CRON_SECRET is not set in environment." }] };
  }
  if (!site_id && !slug) {
    return { content: [{ type: "text", text: "❌ Provide site_id or slug." }] };
  }
  try {
    const resp = await fetch(`${APP_SITE_URL}/api/forge/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${secret}` },
      body: JSON.stringify(site_id ? { siteId: site_id } : { slug }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      return { content: [{ type: "text", text: `❌ Preview generation failed (${resp.status}): ${data?.error || "unknown error"}` }] };
    }
    await audit("forge_preview_generated", `Generated preview for ${slug || "site " + site_id}`, {
      target: slug || String(site_id),
      detail: { claimCode: data.claimCode, usedGemini: data.usedGemini },
    });
    return {
      content: [{
        type: "text",
        text: `✅ Preview ready — claim code ${data.claimCode}. Send the preview link /s/<slug> in outreach; when the owner claims it, the real site build kicks off.`,
      }],
    };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Preview request failed: ${err?.message || String(err)}` }] };
  }
}

async function toolForgeFunnelStats() {
  const q = async (s, p = []) => Number((await query(s, p)).rows[0].n);
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const ds = dayStart.toISOString();
  const discovered = await q("SELECT count(*) n FROM forge_sites WHERE status='discovered'");
  const withPreview = await q("SELECT count(*) n FROM forge_sites WHERE preview IS NOT NULL");
  const sent = await q("SELECT count(*) n FROM forge_sites WHERE outreach_status='sent'");
  const claimed = await q("SELECT count(*) n FROM forge_sites WHERE claimed_by_user_id IS NOT NULL");
  const built = await q("SELECT count(*) n FROM forge_sites WHERE status='built'");
  const paid = await q("SELECT count(*) n FROM forge_sites WHERE one_time_paid=true");
  const draftedToday = await q("SELECT count(*) n FROM activity_log WHERE event_type='forge_outreach_drafted' AND created_at>=$1", [ds]);
  const genToday = await q("SELECT count(*) n FROM forge_sites WHERE preview_generated_at>=$1", [ds]);
  const expiring = await q("SELECT count(*) n FROM forge_sites WHERE preview IS NOT NULL AND claimed_by_user_id IS NULL AND outreach_status='sent' AND preview_expires_at IS NOT NULL AND preview_expires_at < now()+interval '3 days'");
  const oe = (await query("SELECT daily_goal,enabled FROM outreach_engine WHERE id=1")).rows[0] || {};
  const pe = (await query("SELECT daily_budget,enabled FROM preview_engine WHERE id=1")).rows[0] || {};
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const text = [
    `📊 **Forge funnel**`,
    ``,
    `discovered ${discovered} → preview ${withPreview} → sent ${sent} → claimed ${claimed} → built ${built} → paid ${paid}`,
    `conversion: sent→claimed ${pct(claimed, sent)}% · claimed→built ${pct(built, claimed)}% · built→paid ${pct(paid, built)}%`,
    `today: ${genToday} previews generated · ${draftedToday}/${oe.daily_goal ?? "?"} outreach drafted`,
    `dials: outreach goal ${oe.daily_goal ?? "?"} (${oe.enabled ? "on" : "OFF"}) · preview budget ${pe.daily_budget ?? "?"} (${pe.enabled ? "on" : "OFF"})`,
    expiring ? `⚠️ ${expiring} preview(s) expiring within 3 days — chase them (list_expiring_previews).` : `no previews expiring soon.`,
  ].join("\n");
  return { content: [{ type: "text", text }] };
}

async function toolAdsFunnelReport({ days = 7 } = {}) {
  // The on-site half of paid-ads math (docs/ADS.md): Meta reports spend + clicks, this reports
  // what those clicks became — form-fills → booked calls → accounts — grouped per campaign.
  const d = Math.max(1, Math.min(90, Number(days) || 7));
  const rows = (await query(
    `SELECT coalesce(utm_campaign, '(no campaign)') AS campaign,
            coalesce(utm_source, 'fbclid-only') AS source,
            count(*)::int AS form_fills,
            count(*) FILTER (WHERE booked_slot IS NOT NULL)::int AS booked,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM better_auth."user" u WHERE lower(u.email) = lower(leads.email)
            ))::int AS accounts
     FROM leads
     WHERE created_at > now() - $1 * interval '1 day'
       AND (utm_source IS NOT NULL OR fbclid IS NOT NULL)
     GROUP BY 1, 2
     ORDER BY form_fills DESC`,
    [d],
  )).rows;
  const organic = Number((await query(
    `SELECT count(*) n FROM leads
     WHERE created_at > now() - $1 * interval '1 day'
       AND utm_source IS NULL AND fbclid IS NULL`,
    [d],
  )).rows[0].n);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const lines = [
    `📣 **Ads funnel — last ${d}d** (web leads with paid attribution)`,
    ``,
    ...(rows.length
      ? rows.map((r) =>
          `${r.campaign} (${r.source}): ${r.form_fills} form-fill${r.form_fills === 1 ? "" : "s"} → ${r.booked} booked (${pct(r.booked, r.form_fills)}%) → ${r.accounts} account${r.accounts === 1 ? "" : "s"} (${pct(r.accounts, r.form_fills)}%)`,
        )
      : [`no paid-attributed leads in this window.`]),
    ``,
    `organic (unattributed) leads same window: ${organic}`,
    `cost per form-fill = campaign spend (Meta ads manager) ÷ form_fills above.`,
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function toolForgeDigest() {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { content: [{ type: "text", text: "❌ CRON_SECRET is not set in environment." }] };
  try {
    const resp = await fetch(`${APP_SITE_URL}/api/forge/digest`, { headers: { Authorization: `Bearer ${secret}` } });
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok) return { content: [{ type: "text", text: `❌ Digest failed (${resp.status}): ${d?.error || "unknown"}` }] };
    const { config: c, budget: b, throughput: t, buildQueue: bq, editQueue: eq } = d;
    const onoff = (v) => (v ? "on" : "OFF");
    const warn = b.pct >= 90 ? " ⚠️ OVER 90%" : b.pct >= 75 ? " ⚠️ 75%+" : "";
    const text = [
      `⚙️ **Forge digest** — ${c.masterEnabled ? "running" : "STOPPED"}`,
      ``,
      `spend: ${b.weekRunsUsed}/${b.weeklyRunBudget} runs this week (${b.pct}%, ${b.remaining} left)${warn}`,
      `switches: builds ${onoff(c.buildsEnabled)} · edits ${onoff(c.editsEnabled)} · idle-templates ${onoff(c.idleTemplatesEnabled)}`,
      ``,
      `queues: ${bq.total} build (${bq.building} building) · ${eq.total} edit`,
      `24h: ${t.built24h} built · ${t.edits24h} edited · ${t.outreachSent24h} outreach · ${t.previews24h} previews`,
      `7d:  ${t.built7d} built · ${t.edits7d} edited · ${t.outreachSent7d} outreach · ${t.templates7d} templates`,
    ];
    if (bq.total) {
      text.push(``, `queue: ${bq.items.slice(0, 6).map((q) => q.businessName + (q.status === "building" ? ` (▶ ${q.elapsedMin}m)` : "")).join(", ")}`);
    }
    if (eq.total) {
      text.push(`edits waiting: ${eq.items.slice(0, 6).map((e) => e.businessName).join(", ")}`);
    }
    return { content: [{ type: "text", text: text.join("\n") }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Digest request failed: ${err?.message || String(err)}` }] };
  }
}

// Read-only — answers "is money spend automatic, and who's waiting for a line?" Never audits (no
// state change). The switch itself is human-only (flip it in /command/engine), by design.
async function toolAutomationStatus() {
  const ap = (await query("SELECT enabled, weekly_line_budget, auto_build_enabled FROM auto_provision WHERE id=1")).rows[0] || {};
  const fe = (await query("SELECT enabled FROM forge_engine WHERE id=1")).rows[0] || {};
  const spend = (await query("SELECT count(*)::int AS n FROM voice_lines WHERE created_at > now() - interval '7 days'")).rows[0]?.n ?? 0;
  const qRows = (await query("SELECT status, count(*)::int AS n FROM voice_provision_queue GROUP BY status")).rows;
  const byStatus = Object.fromEntries(qRows.map((r) => [r.status, r.n]));
  const budget = ap.weekly_line_budget ?? 10;
  const pct = budget > 0 ? Math.round((spend / budget) * 100) : 0;
  const warn = pct >= 90 ? " ⚠️ OVER 90%" : pct >= 75 ? " ⚠️ 75%+" : "";
  const text = [
    `🤖 **Automation status**`,
    ``,
    `voice auto-provision: ${ap.enabled ? "AUTOMATIC (spending)" : "manual (queue-for-human)"} · auto-build-on-pay: ${ap.auto_build_enabled ? "on" : "OFF"}`,
    `forge builds: ${fe.enabled ? "on" : "OFF"}`,
    `line spend: ${spend}/${budget} numbers this week (${pct}%)${warn}`,
    `voice queue: ${byStatus.queued ?? 0} queued · ${byStatus.failed ?? 0} failed · ${byStatus.done ?? 0} done`,
  ];
  if ((byStatus.failed ?? 0) > 0) text.push(``, `⚠️ ${byStatus.failed} site(s) failed to provision — a human needs to look.`);
  return { content: [{ type: "text", text: text.join("\n") }] };
}

async function toolSetOutreachGoal({ daily_goal, enabled } = {}) {
  const sets = [];
  const vals = [];
  if (daily_goal != null) { vals.push(Math.max(0, Math.min(500, Number(daily_goal) || 0))); sets.push(`daily_goal=$${vals.length}`); }
  if (enabled != null) { vals.push(Boolean(enabled)); sets.push(`enabled=$${vals.length}`); }
  if (!sets.length) return { content: [{ type: "text", text: "Nothing to set — pass daily_goal and/or enabled." }] };
  await query(`UPDATE outreach_engine SET ${sets.join(", ")}, updated_at=now() WHERE id=1`, vals);
  const r = (await query("SELECT daily_goal,enabled FROM outreach_engine WHERE id=1")).rows[0];
  await audit("outreach_goal_set", `Outreach goal → ${r.daily_goal}/day (${r.enabled ? "on" : "off"})`, { detail: r });
  return { content: [{ type: "text", text: `✅ Outreach goal: ${r.daily_goal}/day, ${r.enabled ? "enabled" : "paused"}.` }] };
}

async function toolSetPreviewBudget({ daily_budget, enabled } = {}) {
  const sets = [];
  const vals = [];
  if (daily_budget != null) { vals.push(Math.max(0, Math.min(1000, Number(daily_budget) || 0))); sets.push(`daily_budget=$${vals.length}`); }
  if (enabled != null) { vals.push(Boolean(enabled)); sets.push(`enabled=$${vals.length}`); }
  if (!sets.length) return { content: [{ type: "text", text: "Nothing to set — pass daily_budget and/or enabled." }] };
  await query(`UPDATE preview_engine SET ${sets.join(", ")}, updated_at=now() WHERE id=1`, vals);
  const r = (await query("SELECT daily_budget,enabled FROM preview_engine WHERE id=1")).rows[0];
  await audit("preview_budget_set", `Preview budget → ${r.daily_budget}/day (${r.enabled ? "on" : "off"})`, { detail: r });
  return { content: [{ type: "text", text: `✅ Preview wave budget: ${r.daily_budget}/day, ${r.enabled ? "enabled" : "paused"}.` }] };
}

async function toolListExpiringPreviews() {
  const res = await query(
    `SELECT id, slug, business_name, email, claim_code, preview_expires_at,
            ceil(extract(epoch from (preview_expires_at - now()))/86400) AS days_left
     FROM forge_sites
     WHERE preview IS NOT NULL AND claimed_by_user_id IS NULL AND outreach_status='sent'
       AND preview_expires_at IS NOT NULL AND preview_expires_at < now() + interval '4 days'
     ORDER BY preview_expires_at ASC LIMIT 50`,
  );
  if (!res.rows.length) return { content: [{ type: "text", text: "No previews expiring in the next 4 days. Nothing to chase." }] };
  const lines = [`⏳ **${res.rows.length} preview(s) expiring soon** (sent, unclaimed) — final-push follow-up:`, ""];
  for (const r of res.rows) {
    lines.push(`#${r.id} ${r.business_name} · ${Math.max(0, Number(r.days_left))}d left · code ${r.claim_code}${r.email ? ` · ${r.email}` : ""} · ${APP_SITE_URL}/s/${r.slug}`);
  }
  lines.push("", "For each: draft a last-chance follow-up (save_forge_outreach_draft), or regenerate the preview (generate_forge_preview) to reset the 14-day clock.");
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// ---------------------------------------------------------------------------
// Design research reports (brand-lead). A report is the ACCUMULATING artifact
// of a design-research run: the vertical studied, the best-in-class sites it
// looked at (sources = how we verify the claims), the patterns it found, and
// the design-language spec it produced. list_design_reports lets the agent read
// its prior research before writing new — so each run compounds, not repeats.
// ---------------------------------------------------------------------------
async function toolSaveDesignReport(args = {}) {
  const {
    vertical,
    archetype = null,
    title,
    summary,
    findings = null,
    sources = null,
    language_id = null,
    spec = null,
  } = args;
  if (!vertical || !title || !summary) {
    return { content: [{ type: "text", text: "❌ vertical, title, and summary are required." }], isError: true };
  }
  // Require at least one cited source so every report is auditable (verification floor).
  const srcArr = Array.isArray(sources) ? sources.filter((s) => s && (s.url || s.label)) : [];
  if (srcArr.length === 0) {
    return { content: [{ type: "text", text: "❌ A report must cite at least one source (the site(s) you studied) so it can be verified. Add { label, url } entries to `sources`." }], isError: true };
  }
  const res = await query(
    `INSERT INTO design_reports (vertical, archetype, title, summary, findings, sources, language_id, spec, status)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb,'proposed') RETURNING id`,
    [
      vertical,
      archetype,
      title,
      summary,
      findings ? JSON.stringify(findings) : null,
      JSON.stringify(srcArr),
      language_id,
      spec ? JSON.stringify(spec) : null,
    ],
  );
  const id = res.rows[0].id;
  await audit("brand_design_proposed", `Design report #${id}: ${title} (${vertical})`, {
    detail: { report_id: id, vertical, language_id, sources: srcArr.length },
  });
  return { content: [{ type: "text", text: `✅ Design report #${id} saved for "${vertical}" with ${srcArr.length} cited source(s). It will appear in the Engine tab as "proposed" for Joe to verify.` }] };
}

async function toolListDesignReports(args = {}) {
  const { vertical = null, status = null, limit = 12 } = args;
  const where = [];
  const params = [];
  if (vertical) { params.push(vertical); where.push(`vertical = $${params.length}`); }
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  params.push(Math.min(Number(limit) || 12, 50));
  const res = await query(
    `SELECT id, vertical, archetype, title, summary, language_id, status, created_at,
            jsonb_array_length(COALESCE(sources,'[]'::jsonb)) AS source_count
       FROM design_reports
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
    params,
  );
  if (res.rows.length === 0) {
    return { content: [{ type: "text", text: vertical ? `No prior design reports for "${vertical}" yet — you're breaking new ground. Study best-in-class sites, then save_design_report.` : "No design reports yet." }] };
  }
  const lines = res.rows.map(
    (r) => `#${r.id} [${r.status}] ${r.vertical}${r.archetype ? " · " + r.archetype : ""} — ${r.title} (${r.source_count} sources${r.language_id ? ", lang=" + r.language_id : ""})\n   ${r.summary}`,
  );
  return { content: [{ type: "text", text: `Prior design research (${res.rows.length}), newest first — build on these, don't repeat:\n\n${lines.join("\n\n")}` }] };
}

// Best-effort US E.164 normalization (mirrors src/lib/sms.ts normalizePhone).
function normalizeUsPhone(raw) {
  if (!raw) return null;
  const t = String(raw).trim();
  if (t.startsWith("+")) return t.replace(/[^\d+]/g, "");
  const d = t.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d ? `+${d}` : null;
}

async function toolSendSms({ to, body, site_id, purpose } = {}) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const mgSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid || !token || !mgSid) {
    return { content: [{ type: "text", text: "❌ SMS isn't configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID in .env.local." }], isError: true };
  }
  const dest = normalizeUsPhone(to);
  const text = String(body || "").trim();
  if (!dest) return { content: [{ type: "text", text: "Need a valid US `to` phone number." }], isError: true };
  if (!text) return { content: [{ type: "text", text: "Need a non-empty `body`." }], isError: true };

  const form = new URLSearchParams({ MessagingServiceSid: mgSid, To: dest, Body: text.slice(0, 1600) });
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { content: [{ type: "text", text: `❌ Twilio rejected the text: ${data.message || `HTTP ${r.status}`}${data.code ? ` (code ${data.code})` : ""}` }], isError: true };
    }
    // When the agent tells us WHICH lead this text belongs to, log it into that lead's SMS thread
    // (the same activity_log events the Messages UI + sms-agent history read) and advance cadence
    // state — otherwise fall back to the generic sms_sent receipt.
    const sid2 = Number(site_id);
    if (Number.isFinite(sid2) && sid2 > 0) {
      const kind = purpose === "followup" ? "followup" : "reply";
      if (kind === "followup") {
        await audit("sms_outreach_sent", `🔁 SMS follow-up → ${dest}: ${text.slice(0, 80)}`, {
          detail: { siteId: sid2, to: dest, note: text, via: "followup" },
        });
        await query(
          `UPDATE forge_sites SET followup_count = followup_count + 1, contacted_at = now(),
                  outreach_status = CASE WHEN outreach_status IN ('none','drafted') THEN 'sent' ELSE outreach_status END,
                  updated_at = now() WHERE id = $1`,
          [sid2],
        );
      } else {
        await audit("sms_outbound", `🤖 Agent texted lead #${sid2}: ${text.slice(0, 80)}`, {
          detail: { siteId: sid2, to: dest, note: text, via: "agent" },
        });
      }
    } else {
      await audit("sms_sent", `📱 Texted ${dest}: ${text.slice(0, 80)}`, { target: dest, detail: data.sid || null });
    }
    return { content: [{ type: "text", text: `✅ Sent to ${dest} (sid ${data.sid || "?"}). Their reply forwards to Joe's phone automatically.` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Send failed: ${err?.message || err}` }], isError: true };
  }
}

// The public number leads text/call (the Twilio A2P sender). Calls to it hit Ivy.
const TBJ_PHONE_PRETTY = "760-262-0014";

// ── customer voice receptionist ──────────────────────────────────────────────────────────────
// Read tools over the calls the AI answered FOR A CUSTOMER'S BUSINESS (not TBJ's own line).
// Tenancy lives in voice_lines: a number maps to exactly one site. See docs/VOICE_TENANCY_SPEC.md.
//
// Deliberately NOT exposed as a tool: provisioning a line. That buys a Retell phone number and
// spends real money on every call — an agent must not be able to trigger it autonomously.
// Use `node scripts/retell/provision-line.mjs --site N --apply` by hand.

async function toolListFlaggedCalls({ limit = 20 } = {}) {
  const lim = Math.max(1, Math.min(100, Number(limit) || 20));
  const { rows } = await query(
    `SELECT c.id, c.site_id, f.business_name, c.started_at, c.caller_name, c.problem,
            c.owner_note, c.owner_rated_at
       FROM calls c JOIN forge_sites f ON f.id = c.site_id
       WHERE c.owner_rating = 'bad'
       ORDER BY c.owner_rated_at DESC NULLS LAST
       LIMIT $1`,
    [lim],
  );
  if (rows.length === 0) {
    return { content: [{ type: "text", text: "No calls flagged by customers. The agent is doing its job." }] };
  }
  const lines = rows.map((r) => {
    const when = r.owner_rated_at ? new Date(r.owner_rated_at).toLocaleString("en-US", { timeZone: "America/Phoenix" }) : "?";
    return `#${r.id} · ${r.business_name} · flagged ${when}\n    call: ${r.caller_name || "(no name)"} — ${r.problem || "(no detail)"}` +
      (r.owner_note ? `\n    they said: "${r.owner_note}"` : "\n    (no note left)");
  });
  return { content: [{ type: "text", text: `${rows.length} call(s) customers flagged as wrong — the signal to improve the agent:\n\n${lines.join("\n\n")}` }] };
}

async function toolListCalls({ site_id = null, limit = 20, only_real = false } = {}) {
  const lim = Math.max(1, Math.min(100, Number(limit) || 20));
  const where = [];
  const params = [];
  if (site_id) { params.push(Number(site_id)); where.push(`c.site_id = $${params.length}`); }
  if (only_real) where.push(`c.is_real_lead IS NOT FALSE`);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(lim);

  const { rows } = await query(
    `SELECT c.id, c.site_id, f.business_name, c.started_at, c.caller_name, c.callback_number,
            c.urgency, c.problem, c.is_real_lead, c.disposition, c.duration_sec, c.notified_at
       FROM calls c JOIN forge_sites f ON f.id = c.site_id
       ${clause}
       ORDER BY c.started_at DESC NULLS LAST, c.id DESC
       LIMIT $${params.length}`,
    params,
  );
  if (rows.length === 0) {
    return { content: [{ type: "text", text: site_id ? `No calls recorded for site ${site_id} yet.` : "No calls recorded yet." }] };
  }
  const lines = rows.map((r) => {
    const when = r.started_at ? new Date(r.started_at).toLocaleString("en-US", { timeZone: "America/Phoenix" }) : "—";
    const flags = [
      r.is_real_lead === false ? "spam/wrong-number" : null,
      r.urgency === "emergency" ? "🚨 EMERGENCY" : r.urgency === "urgent" ? "urgent" : null,
      // A call we could not text the owner about is the one they most need to know about.
      r.notified_at ? null : "⚠️ OWNER NOT NOTIFIED",
    ].filter(Boolean);
    return `#${r.id} · ${r.business_name} · ${when}\n    ${r.caller_name || "(no name)"} ${r.callback_number || ""} — ${r.problem || "(no detail)"}` +
      (flags.length ? `\n    ${flags.join(" · ")}` : "");
  });
  return { content: [{ type: "text", text: `${rows.length} call(s):\n\n${lines.join("\n\n")}` }] };
}

async function toolGetCall({ call_id } = {}) {
  const id = Number(call_id);
  if (!Number.isFinite(id)) return { content: [{ type: "text", text: "Pass the numeric call id from list_calls." }], isError: true };
  const { rows } = await query(
    `SELECT c.*, f.business_name FROM calls c JOIN forge_sites f ON f.id = c.site_id WHERE c.id = $1`, [id],
  );
  const c = rows[0];
  if (!c) return { content: [{ type: "text", text: `No call ${id}.` }], isError: true };
  const parts = [
    `Call #${c.id} — ${c.business_name} (site ${c.site_id})`,
    `when      : ${c.started_at || "—"}${c.duration_sec ? ` (${c.duration_sec}s)` : ""}`,
    `caller    : ${c.caller_name || "(no name)"} ${c.from_number || ""}`,
    `callback  : ${c.callback_number || "—"}`,
    `address   : ${c.address || "—"}`,
    `problem   : ${c.problem || "—"}`,
    `urgency   : ${c.urgency || "—"}${c.is_real_lead === false ? "  (flagged spam/wrong number)" : ""}`,
    `owner text: ${c.notified_at ? `sent ${c.notified_at}` : "NOT SENT — the owner never heard about this call"}`,
    c.summary ? `\nsummary:\n${c.summary}` : null,
    c.transcript ? `\ntranscript:\n${c.transcript}` : null,
  ].filter(Boolean);
  return { content: [{ type: "text", text: parts.join("\n") }] };
}

async function toolSetVoiceLineStatus({ site_id, status } = {}) {
  const id = Number(site_id);
  const allowed = ["active", "paused", "released"];
  if (!Number.isFinite(id) || !allowed.includes(status)) {
    return { content: [{ type: "text", text: `Pass site_id and status (${allowed.join(" | ")}).` }], isError: true };
  }
  const { rows } = await query(
    `UPDATE voice_lines SET status = $2, updated_at = now() WHERE site_id = $1 RETURNING phone_number, status`, [id, status],
  );
  if (rows.length === 0) return { content: [{ type: "text", text: `Site ${id} has no provisioned voice line.` }], isError: true };
  const r = rows[0];
  await audit("voice_line_status_set", `📞 Voice line ${r.phone_number} for site ${id} set to ${status}`, { target: r.phone_number, detail: status });
  const note = status === "active"
    ? "Calls to that number will resolve to this business again."
    : "That number will stop answering as this business — callers get the generic fallback greeting. The customer's own forwarding is unaffected; they should dial ##61# to send calls back to themselves.";
  return { content: [{ type: "text", text: `✅ ${r.phone_number} → ${status}. ${note}` }] };
}

async function toolIssueCallbackCode({ phone, name = null, expires_hours = 720 } = {}) {
  const dest = normalizeUsPhone(phone);
  const hrs = Math.max(1, Math.min(24 * 60, Number(expires_hours) || 720)); // cap 60 days
  // 4-digit code, unique among ACTIVE codes (partial unique index enforces it too).
  let code = null;
  for (let attempt = 0; attempt < 8 && !code; attempt++) {
    const candidate = String(1000 + Math.floor(Math.random() * 9000)); // 1000–9999
    const { rows } = await query(`SELECT 1 FROM callback_codes WHERE code=$1 AND status='active' LIMIT 1`, [candidate]);
    if (rows.length === 0) code = candidate;
  }
  if (!code) return { content: [{ type: "text", text: "Couldn't mint a free code — try again." }], isError: true };

  try {
    await query(
      `INSERT INTO callback_codes (code, contact_phone, lead_name, status, issued_by, expires_at)
       VALUES ($1, $2, $3, 'active', 'venus', now() + ($4 || ' hours')::interval)`,
      [code, dest, name, String(hrs)],
    );
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Couldn't save code: ${err?.message || err}` }], isError: true };
  }
  await audit("callback_code_issued", `🎟️ Issued priority callback code ${code}${name ? ` for ${name}` : ""}${dest ? ` (${dest})` : ""}`, { target: dest, detail: code });

  const days = Math.round(hrs / 24);
  const snippet = `Call ${TBJ_PHONE_PRETTY} and give code ${code} to reach Joe directly.`;
  return {
    content: [{
      type: "text",
      text: `✅ Callback code **${code}**${name ? ` for ${name}` : ""}${dest ? ` (${dest})` : ""}, valid ~${days} day(s).\n\nDrop this in your text or voicemail:\n"${snippet}"\n\nWhen they call ${TBJ_PHONE_PRETTY} and give ${code}, Ivy verifies it and transfers them straight to Joe. Random callers without a code stay with Ivy.`,
    }],
  };
}

async function toolDropVoicemail({ site_id, text = true } = {}) {
  const id = Number(site_id);
  if (!Number.isFinite(id)) return { content: [{ type: "text", text: "Need a numeric `site_id`." }], isError: true };
  const secret = process.env.CRON_SECRET;
  if (!secret) return { content: [{ type: "text", text: "❌ CRON_SECRET is not set in environment." }], isError: true };
  try {
    const resp = await fetch(`${APP_SITE_URL}/api/dropcowboy/drop`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ siteId: id, text: text !== false }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      return { content: [{ type: "text", text: `❌ ${data.message || `HTTP ${resp.status}`}` }], isError: true };
    }
    return { content: [{ type: "text", text: `✅ ${data.message || "Voicemail dropped."}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Drop failed: ${err?.message || err}` }], isError: true };
  }
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------
const server = new Server(
  { name: "tbj-mcp", version: "2.56.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_status",
      description: "Get current ThinkBigJoe pipeline status: prospects in DB, drafts awaiting review, approved connections ready to send, sent this week, and follow-ups due today.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_pending_replies",
      description: "List LinkedIn reply drafts waiting for Joe's approval. Each draft shows who replied, their message, and the AI-suggested response.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "handle_reply",
      description: "Approve, pause, or edit a pending reply draft. Action: 'send' or 'yes' to approve the AI draft as-is; 'pause' or 'stop' to mute the thread; any other text to send your own version instead.",
      inputSchema: {
        type: "object",
        properties: {
          draft_id: { type: "number", description: "The draft ID from list_pending_replies." },
          action: { type: "string", description: "'send', 'pause', or your own reply text." },
        },
        required: ["draft_id", "action"],
      },
    },
    {
      name: "save_inbound_reply",
      description: "Record an inbound LinkedIn message from a prospect. Saves it to the conversation thread, sets the prospect's status to 'replied', and returns the full conversation history so you can draft a contextual response. Call this FIRST when you detect a reply in the LinkedIn inbox, BEFORE drafting anything.",
      inputSchema: {
        type: "object",
        properties: {
          prospect_id: { type: "number", description: "Prospect DB id if known." },
          prospect_name: { type: "string", description: "Full name of the person who replied." },
          message: { type: "string", description: "Exact text of their message." },
          platform: { type: "string", description: "Platform (default: linkedin)." },
        },
        required: ["prospect_name", "message"],
      },
    },
    {
      name: "save_reply_draft",
      description: "Store your drafted response to a LinkedIn reply for Joe to review in the Leads page (thinkbigjoe.com/command/leads) before it's sent. Do NOT send the message yourself — Joe approves it in the UI first. Call this after save_inbound_reply and after you have written a draft reply.",
      inputSchema: {
        type: "object",
        properties: {
          prospect_id: { type: "number", description: "Prospect DB id." },
          prospect_name: { type: "string", description: "Full name of the prospect." },
          their_message: { type: "string", description: "Their original message text." },
          draft: { type: "string", description: "Your drafted response." },
        },
        required: ["prospect_name", "their_message", "draft"],
      },
    },
    {
      name: "add_prospect",
      description: "Add a researched prospect to the review queue. Call this after researching someone online. Creates a prospect record and a draft connection note ready for Joe's approval.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Full name of the prospect." },
          title: { type: "string", description: "Job title." },
          company: { type: "string", description: "Company name." },
          vertical: {
            type: "string",
            enum: ["insurance", "mortgage", "wealth", "msp", "law", "other"],
            description: "Industry vertical.",
          },
          location: { type: "string", description: "City, state or region." },
          profile_url: { type: "string", description: "LinkedIn profile URL (used as unique key)." },
          website_url: { type: "string", description: "Company website URL found during research." },
          photo_url: { type: "string", description: "LinkedIn or Google profile photo URL." },
          email: { type: "string", description: "Email address found on website, LinkedIn, or Google." },
          phone: { type: "string", description: "Phone number found on website or Google Business." },
          fit_score: { type: "number", description: "Fit score 1–10." },
          fit_reason: { type: "string", description: "Why this prospect is a good fit." },
          website_status: { type: "string", description: "Short status summary of the company website." },
          website_rating: { type: "number", description: "Website quality/opportunity rating from 1–10." },
          website_notes: { type: "string", description: "Specific notes from reviewing the website." },
          sales_opportunities: {
            type: "array",
            items: { type: "string" },
            description: "Sales opportunities uncovered through website and deeper research.",
          },
          hook: { type: "string", description: "The personalized LinkedIn connection note Venus will send." },
          source: { type: "string", description: "How the prospect was found. Defaults to 'venus_scout'." },
        },
        required: ["name", "title", "company", "vertical", "location", "profile_url", "fit_score", "fit_reason", "hook"],
      },
    },
    {
      name: "add_forge_prospect",
      description: "Add a local service business with no/bad website to the site-building forge queue. Call this after researching a business online. Creates a forge_sites record with status='discovered', awaiting Joe's approval before any site gets built.",
      inputSchema: {
        type: "object",
        properties: {
          business_name: { type: "string", description: "The business's name (used to derive a unique slug)." },
          niche: { type: "string", description: "Trade/niche, e.g. 'HVAC — heating & cooling', 'Roofing', 'Electrical'." },
          city: { type: "string", description: "City the business operates in." },
          service_area: { type: "string", description: "Broader service area/region, if known." },
          phone: { type: "string", description: "Phone number found during research." },
          email: { type: "string", description: "Email address found during research, if any." },
          existing_website_url: { type: "string", description: "Their current site URL, if they have one (even a bad one)." },
          owner_name: { type: "string", description: "The owner / decision-maker's name, if you can find it (from the site's about page, Google, or socials)." },
          instagram_url: { type: "string", description: "Their Instagram profile URL, if they have one — often the best way to reach a local business." },
          facebook_url: { type: "string", description: "Their Facebook page URL, if they have one." },
          brand_color: { type: "string", description: "A guessed brand hex color from their signage/logo/branding, if visible." },
          google_rating: { type: "string", description: "Their Google star rating, e.g. \"4.9\" (from the Google Maps listing). Omit if they have none." },
          review_count: { type: "string", description: "Their Google review count, e.g. \"79\" or \"1,100+\"." },
          google_maps_url: { type: "string", description: "Link to their Google Maps / Google Business listing (maps.google.com or g.page URL)." },
          linkedin_url: { type: "string", description: "Link to their LinkedIn company page, if they have one (often none for local trades)." },
          fit_reason: { type: "string", description: "One line on why this business is a good forge candidate (no site, dated site, etc.)." },
          notes: { type: "string", description: "Any other useful research notes." },
          source: { type: "string", description: "How this business was found. Defaults to 'venus_forge_scout'." },
        },
        required: ["business_name", "niche", "city", "fit_reason"],
      },
    },
    {
      name: "generate_forge_preview",
      description: "Generate the cheap pre-sale 'showroom' preview for a prospect (Gemini hero copy + a claim code + a 14-day reserved window). NO site is built — this is the personalized page you send in outreach so the owner can claim it, which then triggers the real build. Pass site_id (preferred) or slug.",
      inputSchema: {
        type: "object",
        properties: {
          site_id: { type: "number", description: "forge_sites.id of the prospect to generate a preview for." },
          slug: { type: "string", description: "The prospect's slug (alternative to site_id)." },
        },
      },
    },
    {
      name: "list_forge_queue",
      description: "List businesses in the forge queue, optionally filtered by status (discovered, approved, denied, building, built, build_failed). Use with no status to see everything, or check before add_forge_prospect to avoid duplicates.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["discovered", "approved", "denied", "building", "built", "build_failed"],
            description: "Filter by status. Omit to list all.",
          },
        },
      },
    },
    {
      name: "apify_find_businesses",
      description: "Find local businesses via Apify's Google Maps Scraper — clean structured JSON (name, category, city/state, website OR none, phone, rating, reviews, maps link) instead of browsing Maps. Primary scouting source: a business with NO website is a strong lead.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The trade/category to search, e.g. 'plumber', 'roofer', 'landscaper'." },
          location: { type: "string", description: "City + state, e.g. 'Denver, CO'." },
          max: { type: "number", description: "Max results (default 30, cap 120)." },
        },
        required: ["query", "location"],
      },
    },
    {
      name: "apify_find_instagram",
      description: "Find business Instagram accounts via Apify's Instagram Scraper — spot local businesses that run off Instagram with NO website (prime leads). Returns handle, name, follower count, the website link in their bio (or none), and bio email/phone.",
      inputSchema: {
        type: "object",
        properties: {
          search: { type: "string", description: "A trade + city ('phoenix plumber') or a hashtag." },
          max: { type: "number", description: "Max accounts (default 20, cap 50)." },
        },
        required: ["search"],
      },
    },
    {
      name: "apify_extract_contacts",
      description: "Scrape a business website for contact info via Apify's Contact Details Scraper — returns all emails, phones, and social profile URLs found across the site. Use during enrichment to dig an owner email + socials without reading pages yourself.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", description: "The business's website URL." } },
        required: ["url"],
      },
    },
    {
      name: "list_forge_needs_contact",
      description: "List forge sites still missing an owner name or email — the ones to enrich. Also includes leads whose email BOUNCED (dead address, flagged ⚠️ BOUNCED and listed first): for those, find a DIFFERENT email or a social profile (IG/FB/LinkedIn) — never reuse the dead one. Returns what contact info exists and where to dig (their website, Google Maps, socials). Call this to start a contact-enrichment run, then write findings with enrich_forge_contact.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "enrich_forge_contact",
      description: "Save contact info found for a forge site: the owner's name, an email, phone, and social profile URLs (Instagram/Facebook/LinkedIn). Gap-fill only — blank fields on the record get filled, existing values are kept. Pass only the fields you actually found. Appends anything useful to contact_notes.",
      inputSchema: {
        type: "object",
        properties: {
          site_id: { type: "number", description: "The forge_sites id (from list_forge_needs_contact)." },
          owner_name: { type: "string", description: "The owner/decision-maker's name, if found." },
          email: { type: "string", description: "A real contact email for the business/owner." },
          phone: { type: "string", description: "Phone number, if a better one than what's on file was found." },
          instagram_url: { type: "string", description: "Instagram profile URL." },
          facebook_url: { type: "string", description: "Facebook page URL." },
          linkedin_url: { type: "string", description: "LinkedIn company/owner URL." },
          notes: { type: "string", description: "Any other useful contact context (best way to reach, hours, gatekeeper, etc.)." },
        },
        required: ["site_id"],
      },
    },
    {
      name: "list_forge_needs_callprep",
      description: "List leads with no call-prep yet — research these before Joe calls. Returns each business + where to look (Maps/Facebook/Instagram) so you can gather the rating, a few review quotes, and follower counts. Call this to start a call-prep run, then write findings with save_forge_callprep. Free browser research — no paid scraping.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "save_forge_callprep",
      description: "Save call-prep intelligence you researched for a lead: Google rating, review count, a few real review quotes, social follower counts, and a talking-points script for the call. Powers the Call-prep card in /command/prospects. Pass only what you found.",
      inputSchema: {
        type: "object",
        properties: {
          site_id: { type: "number", description: "The forge_sites id (from list_forge_needs_callprep)." },
          google_rating: { type: "string", description: "Google star rating, e.g. \"4.9\"." },
          review_count: { type: "string", description: "Number of Google reviews, e.g. \"199\"." },
          review_quotes: {
            type: "array",
            description: "2–3 real review quotes. Each: { stars, name, text }.",
            items: {
              type: "object",
              properties: {
                stars: { type: "number" },
                name: { type: "string" },
                text: { type: "string" },
              },
            },
          },
          social_stats: {
            type: "object",
            description: "Follower counts, e.g. { facebook: { followers: 1100 }, instagram: { followers: 2300 } }.",
          },
          call_prep: { type: "string", description: "A short talking-points script for the call: a strength to praise + a review to reference → the gap (no website) → how our plan gets them more sales + organizes lead flow → a warm close." },
          photo_url: { type: "string", description: "A direct image URL for the business — their Google Maps business photo (lh3.googleusercontent.com…) or Facebook profile photo. Shows as the lead's thumbnail on the calling screen." },
        },
        required: ["site_id"],
      },
    },
    {
      name: "list_forge_blacklist",
      description: "List businesses Joe has DENIED — never research, crawl, or add these to the forge queue. Call this at the start of a forge scouting run and skip any match (by name+city or website domain). add_forge_prospect also hard-blocks them as a backstop.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_forge_outreach_queue",
      description: "List BUILT, unclaimed forge sites that still need an outreach email to the owner. Returns each site's business, live-site URL, contact email/phone, and its CLAIM CODE, plus the claim/sign-in/book-a-call links to include. Call this at the start of the forge-outreach job, then write each message with save_forge_outreach_draft.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["none", "drafted", "sent", "replied", "scheduled"],
            description: "Which outreach stage to list. Default 'none' = built sites not yet drafted.",
          },
        },
      },
    },
    {
      name: "list_forge_preview_outreach",
      description: "SHOWROOM (sell-first) outreach queue. Lists prospects that have a personalized PREVIEW ready (not yet built or claimed) — each with its preview URL (/s/<slug>), CLAIM CODE, reserved-days, contact email/phone, and socials. The pitch is: you built them a free preview, invite them to CLAIM it — claiming triggers the real build. Call this at the start of the forge-outreach job, then write each message with save_forge_outreach_draft.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["none", "drafted", "sent", "replied", "scheduled"],
            description: "Which outreach stage to list. Default 'none' = preview-ready prospects not yet drafted.",
          },
        },
      },
    },
    {
      name: "forge_funnel_stats",
      description: "The showroom funnel at a glance: stage counts (discovered → preview → sent → claimed → built → paid), conversion rates, today's generated/drafted vs the goal, the current dials, and how many previews are expiring soon. Call at the start of the marketing-manager run.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "ads_funnel_report",
      description: "Paid-ads funnel from the site's side, per campaign: form-fills → booked calls → accounts, for web leads carrying utm/fbclid attribution (captured on ad landing, stored on the lead). Also shows organic lead volume for contrast. Combine with Meta's spend numbers to get cost per form-fill. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          days: { type: "number", description: "Lookback window in days (default 7, max 90)." },
        },
      },
    },
    {
      name: "forge_digest",
      description: "The forge ops digest — instantly answers 'where are we at with the forge, usage, and spend?'. Returns master + per-capability switch states (builds/edits/idle-templates), the weekly RUN-budget used vs remaining (with 75/90% warnings), build + edit queue depth, and throughput (built/edited/outreach/previews over 24h + 7d).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "automation_status",
      description: "The auto-provision pipeline state — answers 'is money spend automatic right now, and who's waiting for a voice line?'. Returns whether voice auto-provision + auto-build-on-payment + forge builds are on, phone-number spend vs the weekly cap (with 75/90% warnings), and the voice-provision queue (queued / failed / done). Read-only; the switches are flipped by a human in /command/engine.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "set_outreach_goal",
      description: "Set the daily OUTREACH goal (first-touches/day — the pacing + token dial) and/or enable/pause outreach. Raise to scale sends, lower to protect deliverability or token budget.",
      inputSchema: { type: "object", properties: { daily_goal: { type: "number", description: "First-touch drafts per day (0-500)." }, enabled: { type: "boolean", description: "Turn outreach drafting on/off." } } },
    },
    {
      name: "set_preview_budget",
      description: "Set the daily PREVIEW wave budget (how many previews generated/day — keep ~1.5× the outreach goal so inventory stays ahead) and/or enable/pause preview generation.",
      inputSchema: { type: "object", properties: { daily_budget: { type: "number", description: "Previews to generate per day (0-1000)." }, enabled: { type: "boolean", description: "Turn preview generation on/off." } } },
    },
    {
      name: "list_expiring_previews",
      description: "List previews that were SENT but not yet claimed and expire within ~4 days — the warm inventory to chase with a final-push follow-up (or regenerate to reset the 14-day clock) before it's lost.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_forge_followup_due",
      description: "List built sites that got an initial outreach email, haven't claimed or replied, and are overdue for a FOLLOW-UP (>3 days since the last touch, under 3 emails total). Returns which touch is next and the prior subject so you can write a fresh angle. Draft each with save_forge_outreach_draft; Joe reviews + sends. Stop after touch 3.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_forge_reschedule_due",
      description: "List near-won clients Joe marked 'Reschedule' — they got most of the way (often a live/claimed site) but bailed on the SETUP + PAYMENT call and need to rebook. These are your highest-priority, warmest leads. For each, reach out warmly to get them back on the calendar to finish setup and pay: reference their site is ready and waiting, keep it short and low-pressure, and include the book-a-call link. Only clients with the AI enabled are returned. Draft with save_forge_outreach_draft or text via send_sms.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "save_forge_outreach_draft",
      description: "Draft the FIRST-TOUCH message for a built site, on the best channel you have. Warm + personal: (1) their new site is live (include the live URL), (2) the claim code to sign in and claim it, (3) an invite to talk. For channel='email', Joe reviews and sends it. For a social DM (instagram/facebook/linkedin), Joe reviews it, then YOU send it by messaging on that platform and call mark_forge_outreach_sent afterward. This is the AI's first touch — Joe calls them as the second touch.",
      inputSchema: {
        type: "object",
        properties: {
          site_id: { type: "number", description: "The forge_sites id (from list_forge_outreach_queue)." },
          channel: { type: "string", enum: ["email", "instagram", "facebook", "linkedin", "sms"], description: "Which channel this message is for. Default 'email'. Use a social DM channel when there's no email but a social profile." },
          subject: { type: "string", description: "Subject line (required for email; ignored for DMs)." },
          body: { type: "string", description: "The message. Include the claim code, the live-site link, and an invite to talk. Keep DMs shorter than emails." },
        },
        required: ["site_id", "body"],
      },
    },
    {
      name: "mark_forge_outreach_sent",
      description: "Mark a built site as first-touched after YOU sent a social DM yourself (Instagram/Facebook/LinkedIn). Sets outreach_status='sent', records the channel + a touch, and cues Joe to CALL them next. Email sends do NOT use this — those go through Joe's approve-&-send in the UI.",
      inputSchema: {
        type: "object",
        properties: {
          site_id: { type: "number", description: "The forge_sites id." },
          channel: { type: "string", enum: ["instagram", "facebook", "linkedin", "sms", "email"], description: "The channel you messaged them on." },
          note: { type: "string", description: "Optional note (what you said / their handle / anything useful for the call)." },
        },
        required: ["site_id", "channel"],
      },
    },
    {
      name: "list_needs_enrichment",
      description: "List prospects missing photo, email, or Google My Business URL. Returns 50 at a time — use offset to page through ALL prospects. Keep calling with offset+50 until you get the 'enrichment complete' message.",
      inputSchema: {
        type: "object",
        properties: {
          offset: { type: "number", description: "Pagination offset (0, 50, 100...). Default 0." },
        },
      },
    },
    {
      name: "check_outreach_window",
      description: "Check whether the outreach automation is currently allowed to send. Reads automation_settings: enabled flag, working days, working hours, daily goal, and sends today. Returns {allowed, reason, sentToday, target, remaining}. Call this FIRST before every outreach session — if allowed is false, stop immediately.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "update_prospect",
      description: "Enrich an existing prospect with photo, email, phone, or website recon. Use this when you find additional data about someone already in the DB.",
      inputSchema: {
        type: "object",
        properties: {
          prospect_id: { type: "number", description: "The prospect's DB id." },
          photo_url: { type: "string", description: "LinkedIn or Google profile photo URL." },
          email: { type: "string", description: "Email address found during research." },
          phone: { type: "string", description: "Phone number found on website or Google Business." },
          website_url: { type: "string", description: "Company website URL." },
          google_my_business_url: { type: "string", description: "Google My Business listing URL (maps.google.com/... or g.page/...)." },
          source: { type: "string", description: "Where this prospect was found: 'linkedin', 'google', 'google_maps', 'referral', etc." },
          website_status: { type: "string", description: "Short summary of the website." },
          website_rating: { type: "number", description: "Website quality 1–10." },
          website_notes: { type: "string", description: "Notes from reviewing the site." },
          sales_opportunities: { type: "array", items: { type: "string" }, description: "Discovered sales angles." },
        },
        required: ["prospect_id"],
      },
    },
    {
      name: "list_approved_for_outreach",
      description: "List prospects whose connection requests have been approved by Joe and are ready to send on LinkedIn. Returns up to 5, oldest-approved first.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "mark_sent",
      description: "Record that a LinkedIn connection request was successfully sent. Updates the outreach status to 'sent' and moves the prospect to 'connected'.",
      inputSchema: {
        type: "object",
        properties: {
          outreach_id: { type: "number", description: "The outreach_id from list_approved_for_outreach." },
          notes: { type: "string", description: "Optional notes about the send." },
        },
        required: ["outreach_id"],
      },
    },
    {
      name: "list_my_directives",
      description: "ANY AGENT: direct instructions Joe has given YOU personally — 'go after this company', 'draft a reply to that', 'look into this lender'. CALL THIS FIRST, at the very top of every run, before your own loop. These outrank everything else you were going to do, and while one is open your daily budget cap is LIFTED (a request from Joe is never the waste that cap exists to stop). Pass your own agent id.",
      inputSchema: {
        type: "object",
        properties: { agent: { type: "string", description: "Your own agent id (e.g. 'whitney', 'edward')." } },
        required: ["agent"],
      },
    },
    {
      name: "complete_directive",
      description: "ANY AGENT: mark one of Joe's direct instructions finished, with what you ACTUALLY did — he reads this. Complete it even if you could not do what he asked: say plainly what blocked you. Leaving it open keeps your budget cap lifted and makes him think you're still working.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "number", description: "Directive id from list_my_directives." },
          result: { type: "string", description: "What you did, or why you couldn't. One or two sentences, concrete." },
        },
        required: ["id"],
      },
    },
    {
      name: "record_found_job",
      description: "Whitney: post a candidate job to Joe's review board (/command/applications) at status 'found'. Only surface roles that clear the fit-gate (~60% of the CORE requirements) per the target profile. Dedups on company+role. Joe then Approves or Dismisses each card — that approval is the trigger for you to actually apply. RESEARCH THE ROLE BEFORE POSTING: Joe wants a card he can decide on without leaving the page — capture the full job description, the company (what they do, HQ address, website), REAL sourced reviews of the company (Glassdoor/Indeed/Google — with rating + source URL), a point of contact, and BOTH a skills-fit and a personal-interest read. Missing data is fine (pass what you can find), but the more complete the card, the better Joe can approve. PRIORITY EMPLOYERS: if the role is at an employer Joe named in his target profile, pass directed: true — those bypass the general review-board cap.",
      inputSchema: {
        type: "object",
        properties: {
          company: { type: "string", description: "Employer / company name." },
          role: { type: "string", description: "Job title as posted." },
          platform: { type: "string", description: "Where it lives: 'linkedin' | 'indeed' | 'greenhouse' | 'lever' | 'workday' | 'direct' | other." },
          url: { type: "string", description: "Posting or apply URL." },
          location: { type: "string", description: "JOB location + arrangement, e.g. 'Remote (US)' or 'Phoenix, AZ · hybrid'." },
          pay: { type: "string", description: "Comp as posted, if any (freeform, e.g. '$170k–200k')." },
          job_description: { type: "string", description: "The FULL job description (or a faithful, substantial summary) — responsibilities, requirements, must-haves. This is what Joe reviews to decide." },
          company_about: { type: "string", description: "1–3 sentences on what the company does — industry, size, what they build." },
          company_address: { type: "string", description: "The company's HQ / office address (street, city, state) — separate from the job's work arrangement." },
          company_website: { type: "string", description: "The company's own website (not the job board)." },
          company_reviews: { type: "array", description: "REAL sourced reviews of the company as an employer. Each: { source (e.g. 'Glassdoor'), rating (number, e.g. 4.1), count (number of reviews), url, summary (what employees say — pros/cons in a sentence) }. Source these by searching; do not invent. Empty array if none found.", items: { type: "object", properties: { source: { type: "string" }, rating: { type: "number" }, count: { type: "number" }, url: { type: "string" }, summary: { type: "string" } } } },
          directed: { type: "boolean", description: "TRUE only when this role is at one of the PRIORITY EMPLOYERS in Joe's target profile (USER.md) — an employer he named himself. Directed finds have their own review lane, so they are still allowed when the general board is full. Never set it to sneak an ordinary find past the cap; the point is that Joe already chose these employers." },
          contact_info: { type: "object", description: "A way to reach the company/recruiter: { recruiter_name, email, phone, careers_url, linkedin }. Whatever you can find from the posting or the company site.", properties: { recruiter_name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, careers_url: { type: "string" }, linkedin: { type: "string" } } },
          fit_reason: { type: "string", description: "One line: why Joe fits against the CORE requirements (skills/experience)." },
          fit_score: { type: "number", description: "0–100 skills/experience fit against the CORE requirements." },
          interest_match: { type: "string", description: "One line: why this matches JOE'S PERSONAL INTERESTS (mission, domain, tech, culture) per his target profile — not just whether he's qualified." },
          interest_score: { type: "number", description: "0–100 how well the role matches Joe's stated personal interests." },
        },
        required: ["company", "role"],
      },
    },
    {
      name: "list_approved_jobs",
      description: "Whitney's PRIORITY QUEUE: jobs Joe approved that haven't been applied to yet, top-of-queue first (priority, then oldest approval). CHECK THIS FIRST every turn — if it returns any job, apply to the TOP one to completion this turn; only if it's empty do you fall back to finding new jobs.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "job_board_count",
      description: "Whitney: how many found roles are waiting on Joe's review board, and whether there's room under the cap. CALL THIS BEFORE ANY JOB SEARCHING — it is cheap, and if the board is full you must stop immediately without browsing, scraping, or calling record_found_job. Searching while the board is full wastes tokens and puts needless traffic on Joe's LinkedIn/Indeed identity.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "update_application_status",
      description: "Whitney: advance a job through its stages so the board shows live progress. Stages: found → approved/dismissed → account_created → verified → applied → interview → (rejected/closed). Call it at EACH step as you work an approved job (account_created after signup, verified after the email link, applied after submit).",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "number", description: "The job_applications row id (from list_approved_jobs)." },
          status: { type: "string", enum: ["found", "approved", "dismissed", "account_created", "verified", "applied", "interview", "rejected", "closed"], description: "New stage." },
          notes: { type: "string", description: "Optional note (e.g. why stopped, what was tailored, interview time)." },
        },
        required: ["id", "status"],
      },
    },
    {
      name: "inbox_search",
      description: "Whitney: read joe@thinkbigjoe.com for a SPECIFIC purpose — the verification link/code for an account you just created, or an interview invite. Returns matching messages newest-first with sender, subject, a snippet, and any links extracted (the verification link is usually among them). BODY.PEEK: never marks mail read. Not for browsing his mail.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to match in subject/sender/body, e.g. the company name, 'verify', 'confirm your email', 'interview'." },
          from: { type: "string", description: "Optional: only messages whose sender contains this (e.g. 'greenhouse.io', 'workday')." },
          since_minutes: { type: "number", description: "How far back to look, in minutes (default 1440 = 24h). Use a small number right after triggering a verification email." },
          limit: { type: "number", description: "Max messages to return (default 10, cap 25)." },
        },
      },
    },
    {
      name: "inbox_sweep",
      description: "Edward: everything new in joe@thinkbigjoe.com's INBOX since the last sweep, newest first — uid, sender, subject, Message-ID, and a snippet per message. Read-only (BODY.PEEK, never marks mail read). Classify each per your SOP, then act (draft / junk / flag pressing).",
      inputSchema: {
        type: "object",
        properties: {
          since_minutes: { type: "number", description: "How far back to look, in minutes (default 480 = 8h, covering the gap between scheduled sweeps)." },
          limit: { type: "number", description: "Max messages (default 30, cap 50)." },
        },
      },
    },
    {
      name: "email_create_draft",
      description: "Edward: save a reply/new-mail DRAFT into the mailbox's Drafts folder, written in Joe's voice — it appears in his Apple Mail automatically. This never sends anything. Pass in_reply_to (the Message-ID from inbox_sweep) when replying so the thread connects.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient address." },
          subject: { type: "string", description: "Subject line (for replies: 'Re: <original subject>')." },
          body: { type: "string", description: "Plain-text body in Joe's voice. Unknowns become bracketed [Joe: …?] questions, never guesses." },
          in_reply_to: { type: "string", description: "Optional Message-ID of the message being replied to (from inbox_sweep)." },
        },
        required: ["to", "subject", "body"],
      },
    },
    {
      name: "email_move_spam",
      description: "Edward: move spam/phishing messages (by uid from inbox_sweep) out of INBOX into the Spam folder. Recoverable — nothing is ever permanently deleted. Never use this on anything you're not certain is junk; when unsure, leave it and ask Venus.",
      inputSchema: {
        type: "object",
        properties: {
          uid: { type: "number", description: "A single message uid." },
          uids: { type: "array", items: { type: "number" }, description: "Or several uids at once." },
        },
      },
    },
    {
      name: "inbox_unanswered",
      description: "Edward: WHO IS STILL OWED A REPLY — every human message in the mailbox (any folder, ANY AGE) with no answer in Sent, most overdue first. inbox_sweep only sees a time window, so anything nobody answered silently ages out of view; this is the backstop that makes sure a recruiter or client never goes dark again. Run it EVERY sweep, right after inbox_sweep. Machine mail (no-reply, DMARC, bounces) is excluded automatically.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max rows (default 40, cap 100)." },
          include_machine: { type: "boolean", description: "Include no-reply/automated senders too. Default false — normally you want only mail a person is actually waiting on." },
        },
      },
    },
    {
      name: "email_file",
      description: "Edward: file message(s) into a folder, creating it if needed — e.g. move ATS/recruiter mail into \"Job Alerts\" so the job hunt has its own lane. Filing ORGANISES, it does not hide: swept folders are all still read every run. Use it to clear things that genuinely need no reply so inbox_unanswered stays honest. Never file real correspondence that still owes a reply.",
      inputSchema: {
        type: "object",
        properties: {
          uid: { type: "number", description: "A single message uid." },
          uids: { type: "array", items: { type: "number" }, description: "Or several uids at once." },
          folder: { type: "string", description: "Destination folder, e.g. \"Job Alerts\". Created if it doesn't exist." },
          from_folder: { type: "string", description: "Folder the uids came from (default INBOX). uids are per-folder — pass the folder inbox_sweep showed in brackets." },
        },
        required: ["folder"],
      },
    },
    {
      name: "get_gig_report",
      description: "VENUS: the gig pipeline for Joe's debrief — Destiny's latest report, the board counts, and (most important) any proposal she has DRAFTED that is waiting on Joe to actually send. Destiny cannot submit on Upwork, so a drafted proposal stalls until Joe acts; surface those by name.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_gig_alerts",
      description: "Destiny: new Upwork saved-search ALERT EMAILS from the 'Upwork' mail folder — the only compliant source of gigs. Returns each alert's raw text plus the upwork.com posting URLs it contains, flagged against what is already on the board. It deliberately does NOT parse gigs for you: reading the post is your judgement, not the tool's. NOTE: nothing here logs into Upwork, scrapes, or submits — Upwork pushes these emails to Joe and we read our own mailbox.",
      inputSchema: {
        type: "object",
        properties: {
          since_minutes: { type: "number", description: "How far back (default 1440 = 24h)." },
          limit: { type: "number", description: "Max alert emails (default 15, cap 40)." },
        },
      },
    },
    {
      name: "record_found_gig",
      description: "Destiny: put a scored gig on Joe's board at /command/gigs. BOTH scores are required — fit_score (can Joe do this well?) and win_score (can a profile with NO reviews and no Job Success Score realistically WIN it?). win_score is the one that matters: Joe's alerts arrive 15-60 min late by design, so he can never win a speed race, and at 14-25 Connects a proposal a bad bid costs real money. Duplicate URLs are skipped automatically.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "The gig title as posted." },
          client: { type: "string", description: "Client name/company if the alert shows one." },
          url: { type: "string", description: "The upwork.com posting URL — the dedupe key. Always pass it when you have it." },
          budget: { type: "string", description: "Budget or rate as posted, verbatim." },
          scope: { type: "string", description: "Size/duration as posted (e.g. 'small, under 1 month')." },
          description: { type: "string", description: "The posting text, enough for you to write a proposal from later." },
          lane: { type: "string", enum: ["ai-agent", "engineering", "web-design"], description: "Which offer this belongs to. Default ai-agent." },
          proposals_so_far: { type: "number", description: "Proposal count shown on the posting — high counts crush win_score." },
          client_hires: { type: "number", description: "Client's prior hires. Zero hires + unverified payment is where Connects go to die." },
          client_verified: { type: "boolean", description: "Is the client's payment method verified?" },
          fit_score: { type: "number", description: "0-100: can Joe genuinely deliver this well?" },
          win_score: { type: "number", description: "0-100: can an empty profile actually win it?" },
          fit_reason: { type: "string", description: "One line on the fit." },
          win_reason: { type: "string", description: "One line on why he can or can't win it — the honest read." },
        },
        required: ["title", "fit_score", "win_score"],
      },
    },
    {
      name: "list_approved_gigs",
      description: "Destiny: gigs Joe APPROVED on /command/gigs, oldest approval first — your work queue for writing proposals. Returns the posting text and both scores so you can write from the source. Max 3 proposals per run.",
      inputSchema: { type: "object", properties: { limit: { type: "number", description: "Max rows (default 10, cap 25)." } } },
    },
    {
      name: "save_gig_proposal",
      description: "Destiny: attach your drafted proposal to an approved gig. It appears on /command/gigs for Joe to review, edit, and submit HIMSELF on Upwork. This never sends anything and never spends a Connect — that human step is what keeps the account compliant. Use a bracketed [Joe: ...?] for any gap rather than inventing a rate, a timeline, or availability.",
      inputSchema: {
        type: "object",
        properties: {
          gig_id: { type: "number", description: "The gig id from list_approved_gigs." },
          proposal: { type: "string", description: "The proposal text, ready for Joe to paste." },
          note: { type: "string", description: "Optional note for Joe — an assumption you made, or what you'd want confirmed." },
        },
        required: ["gig_id", "proposal"],
      },
    },
    {
      name: "update_gig_status",
      description: "Destiny: move a gig through its stages (found → approved/dismissed → drafted → submitted → won/lost). You may NOT set 'submitted' — only Joe marks that, because only Joe sends.",
      inputSchema: {
        type: "object",
        properties: {
          gig_id: { type: "number" },
          status: { type: "string", enum: ["found", "approved", "dismissed", "drafted", "won", "lost"] },
          note: { type: "string", description: "Why — appended to the gig's notes." },
        },
        required: ["gig_id", "status"],
      },
    },
    {
      name: "list_followup_due",
      description: "Edward: applications that have gone SILENT — submitted N+ days ago with no employer response recorded and no follow-up already sent, oldest first. 'Applied' looks like success, so a dead application is invisible until someone asks this question. Use it on the follow-up run; draft one short nudge per row into the existing ATS thread.",
      inputSchema: {
        type: "object",
        properties: {
          days: { type: "number", description: "Silence threshold in days (default 7). Below ~5 is too eager for most employers." },
          limit: { type: "number", description: "Max rows (default 15, cap 40)." },
        },
      },
    },
    {
      name: "record_employer_reply",
      description: "Edward: write an employer's emailed reply back onto the job application. Whitney only records what SHE does, so an interview invite that arrives by email is invisible to Joe's board and to Venus's debrief until you record it here. Call it for any real employer response: interview/next-step invite, offer, or rejection. This is what puts an interview in front of Joe.",
      inputSchema: {
        type: "object",
        properties: {
          application_id: { type: "number", description: "The job_applications id, when you know it." },
          company: { type: "string", description: "Or the company name — matches the most recently updated application for that employer." },
          kind: { type: "string", enum: ["interview", "offer", "rejected", "info"], description: "interview/offer advance the application to 'interview'; rejected sets 'rejected'; info records a note without changing status." },
          summary: { type: "string", description: "One line on what they actually said, including any DEADLINE (e.g. 'take-home assignment, due within 7 days of Aug 26')." },
        },
        required: ["kind", "summary"],
      },
    },
    {
      name: "email_request_send",
      description: "Edward: queue an email send (immediate, or scheduled via send_at) for VENUS'S APPROVAL. Nothing sends until she approves — this is the only path to sending, with no exceptions. Returns the outbox id; report it to Venus with one line of context.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient address." },
          cc: { type: "string", description: "Optional CC address(es), comma-separated." },
          subject: { type: "string" },
          body: { type: "string", description: "Plain-text body in Joe's voice, final and send-ready." },
          in_reply_to: { type: "string", description: "Optional Message-ID being replied to, so the send threads correctly." },
          context: { type: "string", description: "One line for Venus: why this should send (e.g. 'reply to interview invite from Acme — Whitney's application #42')." },
          send_at: { type: "string", description: "Optional ISO datetime to schedule the send (e.g. 2026-08-27T09:00:00-07:00). Omit to send as soon as Venus approves." },
        },
        required: ["to", "subject", "body"],
      },
    },
    {
      name: "email_list_pending_sends",
      description: "The email outbox queue by status (default 'pending'). Edward: check what's awaiting Venus. Venus: review pending sends here, then email_approve_send / email_reject_send each by id.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", description: "'pending' (default), 'approved', 'sent', 'rejected', or 'failed'." },
        },
      },
    },
    {
      name: "email_approve_send",
      description: "VENUS ONLY: approve outbox send #id. Immediate sends fire right now over Zoho SMTP (as Joe); future-scheduled ones are marked approved and fired at their send_at by the outbox drain. Approve only drafts that read like Joe and commit him to nothing he hasn't agreed to — when unsure, ask Joe instead.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "number", description: "Outbox id from email_list_pending_sends." },
          note: { type: "string", description: "Optional decision note." },
        },
        required: ["id"],
      },
    },
    {
      name: "send_telegram_update",
      description: "VENUS: send a message you composed to Joe's Telegram. This is how your debriefs actually reach him — OpenClaw's cron delivery can't route your main session, so nothing you write is delivered unless you call this. Compose the full update first, then send it once. **bold** and _italic_ are translated for you. If it returns an error, Joe did NOT get it — say so rather than assuming.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", description: "The complete message for Joe, exactly as he should read it." } },
        required: ["text"],
      },
    },
    {
      name: "get_job_hunt_report",
      description: "VENUS: the job-hunt rollup for Joe's Telegram debrief — what Whitney APPLIED to in the window (with job titles + companies, not just a count), anything at interview stage, what's mid-application, and every question still PENDING on Joe (with the question text). Computed from the tables, so it's what actually happened, not Whitney's self-report. Use it at the top of each job-hunt debrief run, then write Joe's update from it.",
      inputSchema: {
        type: "object",
        properties: {
          since_hours: { type: "number", description: "Look-back window for 'applied' (default 12, max 168). Match it to the gap since your last debrief." },
        },
      },
    },
    {
      name: "get_inbox_report",
      description: "VENUS: Edward's latest filed inbox report plus every send awaiting your approval, in one call. Use at the top of each inbox-update run (6:00/12:00/18:00) — review pending sends (approve/reject each), then compose Joe's Telegram update from the report.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "email_reject_send",
      description: "VENUS ONLY: reject outbox send #id with a reason. The email does not send; tell Edward the reason so his next draft is better.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "number", description: "Outbox id from email_list_pending_sends." },
          note: { type: "string", description: "Why it's rejected — this feeds Edward's next attempt." },
        },
        required: ["id"],
      },
    },
    {
      name: "record_question",
      description: "Whitney: when you can't proceed truthfully — a form field you can't answer from Joe's profile/facts, a judgment call — post a QUESTION for Joe instead of guessing or stopping. It shows on /command/applications AND pings Joe's Telegram immediately, so he sees it while you're still working. He can ANSWER it, or DECLINE to answer — declining CANCELS that application, which is a legitimate outcome you should expect. You read his decision next run (list_answered_questions) and either resume or move on. Never block a whole turn waiting on him. For RECURRING facts (work authorization, sponsorship, relocation, security clearance, notice period), pass a `topic` slug: Joe's answer becomes a permanent fact you'll reuse — and if you pass a topic you ALREADY know, this refuses and hands you the known fact so you never ask twice. For multiple-choice, pass `options` and Joe answers with a radio button.",
      inputSchema: {
        type: "object",
        properties: {
          application_id: { type: "number", description: "The job_applications id this question is about (omit for a general question)." },
          question: { type: "string", description: "The specific question for Joe — concrete so he can answer fast." },
          options: { type: "array", items: { type: "string" }, description: "For a multiple-choice question, the answer choices (Joe picks one via radio buttons)." },
          topic: { type: "string", description: "A short slug for a DURABLE fact about Joe (e.g. 'work_authorization', 'relocation', 'security_clearance'). When set, Joe's answer is remembered permanently and you never ask it again. Check get_candidate_facts / get_candidate_profile first." },
        },
        required: ["question"],
      },
    },
    {
      name: "remember_fact",
      description: "Whitney: permanently remember a fact about Joe so you can answer recurring screening questions truthfully without asking again (e.g. topic 'work_authorization' → 'US citizen, no sponsorship needed'). Upserts by topic. Realize when a question is a durable fact and store it.",
      inputSchema: {
        type: "object",
        properties: {
          topic: { type: "string", description: "Short slug, e.g. 'work_authorization', 'relocation', 'notice_period'." },
          fact: { type: "string", description: "The durable answer, in Joe's truth (e.g. 'US citizen — authorized to work in the US, no visa sponsorship needed')." },
        },
        required: ["topic", "fact"],
      },
    },
    {
      name: "get_candidate_facts",
      description: "Whitney: everything you've remembered about Joe (work authorization, relocation, etc.). CHECK THIS before asking any recurring screening question — if the answer is here, use it and don't ask. Also included in get_candidate_profile.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_answered_questions",
      description: "Whitney: Joe's DECISIONS on your open questions — both the ones he ANSWERED and the ones he DECLINED to answer. Check this at the start of every run. An answer is how you resume a blocked application. A DECLINE means that application is cancelled (the job is already closed) — acknowledge it, don't re-ask, don't rephrase, don't apply anyway, just move to the next job. Call mark_question_resolved on each either way.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "mark_question_resolved",
      description: "Whitney: close a question after you've used Joe's answer, so it doesn't come back next run.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "number", description: "The question id from list_answered_questions." } },
        required: ["id"],
      },
    },
    {
      name: "get_candidate_profile",
      description: "Whitney: Joe's resume + LinkedIn — your SOURCE OF TRUTH for his work history. Call this before tailoring, filling an application, or scoring fit, and never claim anything about Joe not backed by it. Returns his resume text + LinkedIn URL (from .env.local RESUME_PATH / LINKEDIN_URL).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_signup_credentials",
      description: "Whitney: the email + password to CREATE accounts on job sites, when applying to an approved job. Call this right before signing up. If it returns 'no password set', do NOT invent one — record_question for Joe and hold the application.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "log_activity",
      description: "Log a cron/agent activity to the activity_log table. Call this when a job finishes to record what happened. Pass actor to attribute it (e.g. 'whitney'); defaults to 'venus'.",
      inputSchema: {
        type: "object",
        properties: {
          event_type: { type: "string", description: "Event type slug, e.g. 'outreach_sent', 'scout_complete', 'followup_sent', 'booking_made', 'enrichment_complete', 'inbox_checked'." },
          summary: { type: "string", description: "Human-readable summary of what happened." },
          metadata: { type: "object", description: "Optional structured data about the event (counts, names, etc.)." },
          actor: { type: "string", description: "Who did the work — the agent id (e.g. 'whitney'). Defaults to 'venus'." },
        },
        required: ["event_type", "summary"],
      },
    },
    {
      name: "schedule_followup",
      description: "Schedule a follow-up touch for a prospect who has connected on LinkedIn. Use touch_number 1 (7 days), 2 (30 days), or 3 (75 days).",
      inputSchema: {
        type: "object",
        properties: {
          prospect_id: { type: "number", description: "The prospect's DB id." },
          touch_number: { type: "number", enum: [1, 2, 3], description: "Which touch in the sequence (1, 2, or 3)." },
          days_from_now: { type: "number", description: "How many days from now to schedule this follow-up." },
          body: { type: "string", description: "The message body to send on this touch." },
        },
        required: ["prospect_id", "touch_number", "days_from_now", "body"],
      },
    },
    {
      name: "list_incomplete_followup_sequences",
      description: "List connected prospects who have SOME follow-up touches scheduled but are missing touches from the full 3-touch sequence (touch 1 at 1 day, touch 2 at 30 days, touch 3 at 75 days). Use this in the scheduler to backfill missing touches.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_connected_without_followups",
      description: "List prospects who are in 'connected' status but have no follow-up touches scheduled at all. Use this in the inbox check and scheduler crons to find silent acceptances that need a follow-up queued.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_due_followups",
      description: "List follow-up touches that are due today or overdue. Returns up to 10, oldest first. Use this to drive the daily follow-up drip cron.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "mark_followup_sent",
      description: "Mark a follow-up touch as sent after you've sent the message on LinkedIn.",
      inputSchema: {
        type: "object",
        properties: {
          followup_id: { type: "number", description: "The follow-up id from list_due_followups." },
          notes: { type: "string", description: "Optional notes about the interaction." },
        },
        required: ["followup_id"],
      },
    },
    {
      name: "book_appointment",
      description: "Book a strategy call for a prospect who has agreed to meet. Posts to the venus-book API endpoint to create the Google Calendar event and upsert the lead.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Prospect's full name." },
          email: { type: "string", description: "Prospect's email address." },
          start_time: { type: "string", description: "ISO 8601 start time for the call." },
          end_time: { type: "string", description: "ISO 8601 end time for the call." },
          phone: { type: "string", description: "Optional phone number." },
          company: { type: "string", description: "Optional company name." },
          notes: { type: "string", description: "Optional notes about the prospect or call context." },
        },
        required: ["name", "email", "start_time", "end_time"],
      },
    },
    {
      name: "save_design_report",
      description: "Save a design-research report (brand-lead). Call this at the END of a design-research run to record what you studied and produced, so the research compounds and Joe can review it in the Engine tab. A report MUST cite the actual sites you studied in `sources` (that's how we verify it). If you also authored a design-language spec, pass language_id + spec.",
      inputSchema: {
        type: "object",
        properties: {
          vertical: { type: "string", description: "The business type / vertical studied, e.g. 'plumber', 'med spa', 'roofer'." },
          archetype: { type: "string", description: "Optional dominant brand archetype/personality this design serves, e.g. 'Caregiver', 'Hero', 'Sage'." },
          title: { type: "string", description: "Short report title, e.g. 'What great plumber sites do — trust-first, dispatch-fast'." },
          summary: { type: "string", description: "1-3 sentence plain-English summary of the key insight, for the Engine tab." },
          findings: { type: "object", description: "Structured findings: e.g. { layout, color, type, sections, conversion, distinct_from }. What separates great from generic." },
          sources: { type: "array", description: "REQUIRED. The sites you studied — [{ label, url }]. This is how the report is verified. At least one.", items: { type: "object", properties: { label: { type: "string" }, url: { type: "string" } } } },
          language_id: { type: "string", description: "If you authored/refined a design-language in factory/design-languages.json, its id (so Joe can build it from this report)." },
          spec: { type: "object", description: "Optional copy of the design-language spec you wrote (for the record)." },
        },
        required: ["vertical", "title", "summary", "sources"],
      },
    },
    {
      name: "list_design_reports",
      description: "Read prior design-research reports (brand-lead). ALWAYS call this before authoring a new report so you build on existing research instead of repeating it. Filter by vertical to see everything learned for one business type.",
      inputSchema: {
        type: "object",
        properties: {
          vertical: { type: "string", description: "Optional: only reports for this vertical." },
          status: { type: "string", description: "Optional: 'proposed' | 'verified' | 'rejected'." },
          limit: { type: "number", description: "Max reports (default 12, cap 50)." },
        },
      },
    },
    {
      name: "send_sms",
      description: "Send an SMS to a lead/prospect through the ThinkBigJoe Twilio number (A2P-registered Messaging Service). Use for quick text touches — booking confirmations, 'saw your business, built you a preview site', reply nudges. Their reply comes back to Joe's phone automatically (forwarded to his Google Voice). Keep it short, identify as ThinkBigJoe, and never text someone who replied STOP. US numbers only.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient phone, US format (e.g. '480-555-1212' or '+14805551212')." },
          body: { type: "string", description: "The message text. Short, plain, identify as ThinkBigJoe. Include a soft opt-out hint (e.g. \"reply 'No thanks' and I'll stop\") for cold/promo texts — prefer this over 'STOP' so we don't rack up carrier opt-out records." },
          site_id: { type: "number", description: "The forge_sites lead this text belongs to. ALWAYS pass it when texting a known lead — it logs the message into their thread and advances cadence state." },
          purpose: { type: "string", description: "'followup' = a cadence touch (bumps followup_count + counts against the daily follow-up cap) · 'reply' = answering their inbound text. Only meaningful with site_id." },
        },
        required: ["to", "body"],
      },
    },
    {
      name: "list_email_replies_pending",
      description: "Prospects who REPLIED to an outreach email and are waiting on a response, with their full message + the lead's facts. Answer with ACA and save a draft (save_forge_outreach_draft) — email stays Joe-approved, never auto-sent.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_sms_followup_due",
      description: "Leads due for their next SMS cadence touch (~2×/week until they reply, claim, or book; 6-month cap; 15/day number-warming cap). Pre-filtered for every human safeguard — ai_paused, opted-out, declined, claimed are already excluded, so everything returned is cleared to text. Write each touch with a fresh angle and send via send_sms(..., purpose:'followup').",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_sms_replies_pending",
      description: "Inbound SMS threads where the lead spoke last and is waiting on a reply — with the full thread, the lead's real facts (trade, town, owner, reviews, call prep) and claim code. Safeguard-filtered (ai_paused/opted-out/declined excluded). Answer each with the SMS doctrine and send via send_sms(..., purpose:'reply').",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "issue_callback_code",
      description: "Mint a PRIORITY CALLBACK CODE for a warm lead. Returns a short code + a ready-to-send line (e.g. \"Call 760-262-0014 and give code 7788 to reach Joe directly\") to drop into your outreach text or a voicemail. When that lead calls the ThinkBigJoe number and gives the code, the AI receptionist (Ivy) verifies it and transfers them straight to Joe — while random callers without a code stay with Ivy. Use this for leads you want to give a direct line to Joe (hot prospects, follow-ups you promised). Cheap: you only pay for a live call when an interested lead actually calls back.",
      inputSchema: {
        type: "object",
        properties: {
          phone: { type: "string", description: "The lead's phone (US format), so we can note who the code is for and confirm the caller. Optional but recommended." },
          name: { type: "string", description: "The lead's name/business, so Ivy can greet them and Joe knows who's transferring in." },
          expires_hours: { type: "number", description: "How long the code stays valid (default 720 = 30 days, cap 60 days)." },
        },
        required: [],
      },
    },
    {
      name: "drop_voicemail",
      description: "Drop a ringless voicemail (Drop Cowboy) into a lead's inbox WITHOUT ringing their phone — a pre-recorded message from ThinkBigJoe — then (by default) send the first-touch text with their site link right after. The 'call, then follow up with a text' opener. Callbacks route to the ThinkBigJoe number → Ivy. Pass the forge site id. Both touches land on the lead's timeline. Never voicemail someone who opted out (STOP).",
      inputSchema: {
        type: "object",
        properties: {
          site_id: { type: "number", description: "The forge_sites lead id to voicemail." },
          text: { type: "boolean", description: "Also send the first-touch text with the site link right after the drop (default true)." },
        },
        required: ["site_id"],
      },
    },
    {
      name: "list_flagged_calls",
      description: "Calls a CUSTOMER marked as 'got it wrong' from their receptionist dashboard, newest first, with the note they left about what should have happened. This is the feedback loop: it's the real signal for improving the shared agent prompt or a customer's config. Read-only.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number", description: "How many (default 20, max 100)." } },
        required: [],
      },
    },
    {
      name: "list_calls",
      description: "Recent calls the AI receptionist answered FOR CUSTOMER BUSINESSES (not TBJ's own line). Shows caller, callback number, what they needed, urgency, and whether the owner was actually texted. Use this to check a customer is getting value, to spot emergencies that were missed, or to see what a line filtered out as spam. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          site_id: { type: "number", description: "Limit to one customer (forge_sites id). Omit for all customers." },
          limit: { type: "number", description: "How many (default 20, max 100)." },
          only_real: { type: "boolean", description: "Hide calls the agent flagged as spam/wrong number." },
        },
        required: [],
      },
    },
    {
      name: "get_call",
      description: "One call in full, including the summary and the transcript, plus whether the owner was ever texted about it. Pass the numeric id from list_calls. Read-only.",
      inputSchema: {
        type: "object",
        properties: { call_id: { type: "number", description: "Numeric call id from list_calls." } },
        required: ["call_id"],
      },
    },
    {
      name: "set_voice_line_status",
      description: "Pause, release, or re-activate a customer's receptionist line. Paused/released lines stop resolving, so callers hear the generic fallback instead of that business — use when a customer cancels or is being moved to a different number. Does NOT touch the customer's own phone forwarding. Cannot buy or delete numbers.",
      inputSchema: {
        type: "object",
        properties: {
          site_id: { type: "number", description: "The customer's forge_sites id." },
          status: { type: "string", description: "active | paused | released" },
        },
        required: ["site_id", "status"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  switch (name) {
    case "get_status": return toolGetStatus();
    case "list_pending_replies": return toolListPendingReplies();
    case "handle_reply": return toolHandleReply(args);
    case "save_inbound_reply": return toolSaveInboundReply(args);
    case "save_reply_draft": return toolSaveReplyDraft(args);
    case "list_needs_enrichment": return toolListNeedsEnrichment(args);
    case "check_outreach_window": return toolCheckOutreachWindow();
    case "add_prospect": return toolAddProspect(args);
    case "add_forge_prospect": return toolAddForgeProspect(args);
    case "generate_forge_preview": return toolGenerateForgePreview(args);
    case "list_forge_queue": return toolListForgeQueue(args);
    case "apify_find_businesses": return toolApifyFindBusinesses(args);
    case "apify_find_instagram": return toolApifyFindInstagram(args);
    case "apify_extract_contacts": return toolApifyExtractContacts(args);
    case "list_forge_outreach_queue": return toolListForgeOutreachQueue(args);
    case "list_forge_preview_outreach": return toolListForgePreviewOutreach(args);
    case "forge_funnel_stats": return toolForgeFunnelStats();
    case "ads_funnel_report": return toolAdsFunnelReport(args);
    case "forge_digest": return toolForgeDigest();
    case "automation_status": return toolAutomationStatus();
    case "set_outreach_goal": return toolSetOutreachGoal(args);
    case "set_preview_budget": return toolSetPreviewBudget(args);
    case "list_expiring_previews": return toolListExpiringPreviews();
    case "save_forge_outreach_draft": return toolSaveForgeOutreachDraft(args);
    case "mark_forge_outreach_sent": return toolMarkForgeOutreachSent(args);
    case "list_forge_followup_due": return toolListForgeFollowupDue(args);
    case "list_forge_reschedule_due": return toolListForgeRescheduleDue(args);
    case "list_forge_needs_contact": return toolListForgeNeedsContact(args);
    case "enrich_forge_contact": return toolEnrichForgeContact(args);
    case "list_forge_needs_callprep": return toolListForgeNeedsCallprep(args);
    case "save_forge_callprep": return toolSaveForgeCallprep(args);
    case "list_forge_blacklist": return toolListForgeBlacklist(args);
    case "update_prospect": return toolUpdateProspect(args);
    case "list_approved_for_outreach": return toolListApprovedForOutreach();
    case "mark_sent": return toolMarkSent(args);
    case "list_my_directives": return toolListMyDirectives(args);
    case "complete_directive": return toolCompleteDirective(args);
    case "record_found_job": return toolRecordFoundJob(args);
    case "list_approved_jobs": return toolListApprovedJobs();
    case "job_board_count": return toolJobBoardCount();
    case "update_application_status": return toolUpdateApplicationStatus(args);
    case "inbox_search": return toolInboxSearch(args);
    case "inbox_sweep": return toolInboxSweep(args);
    case "email_create_draft": return toolEmailCreateDraft(args);
    case "email_move_spam": return toolEmailMoveSpam(args);
    case "inbox_unanswered": return toolInboxUnanswered(args);
    case "email_file": return toolEmailFile(args);
    case "get_gig_report": return toolGetGigReport();
    case "list_gig_alerts": return toolListGigAlerts(args);
    case "record_found_gig": return toolRecordFoundGig(args);
    case "list_approved_gigs": return toolListApprovedGigs(args);
    case "save_gig_proposal": return toolSaveGigProposal(args);
    case "update_gig_status": return toolUpdateGigStatus(args);
    case "list_followup_due": return toolListFollowupDue(args);
    case "record_employer_reply": return toolRecordEmployerReply(args);
    case "email_request_send": return toolEmailRequestSend(args);
    case "email_list_pending_sends": return toolEmailListPendingSends(args);
    case "email_approve_send": return toolEmailApproveSend(args);
    case "email_reject_send": return toolEmailRejectSend(args);
    case "get_inbox_report": return toolGetInboxReport();
    case "get_job_hunt_report": return toolGetJobHuntReport(args);
    case "send_telegram_update": return toolSendTelegramUpdate(args);
    case "record_question": return toolRecordQuestion(args);
    case "list_answered_questions": return toolListAnsweredQuestions();
    case "mark_question_resolved": return toolMarkQuestionResolved(args);
    case "get_candidate_profile": return toolGetCandidateProfile();
    case "get_candidate_facts": return toolGetCandidateFacts();
    case "remember_fact": return toolRememberFact(args);
    case "get_signup_credentials": return toolGetSignupCredentials();
    case "log_activity": return toolLogActivity(args);
    case "schedule_followup": return toolScheduleFollowup(args);
    case "list_incomplete_followup_sequences": return toolListIncompleteFollowupSequences();
    case "list_connected_without_followups": return toolListConnectedWithoutFollowups();
    case "list_due_followups": return toolListDueFollowups();
    case "mark_followup_sent": return toolMarkFollowupSent(args);
    case "book_appointment": return toolBookAppointment(args);
    case "save_design_report": return toolSaveDesignReport(args);
    case "list_design_reports": return toolListDesignReports(args);
    case "send_sms": return toolSendSms(args);
    case "list_email_replies_pending": return toolListEmailRepliesPending();
    case "list_sms_followup_due": return toolListSmsFollowupDue();
    case "list_sms_replies_pending": return toolListSmsRepliesPending();
    case "list_flagged_calls": return toolListFlaggedCalls(args);
    case "list_calls": return toolListCalls(args);
    case "get_call": return toolGetCall(args);
    case "set_voice_line_status": return toolSetVoiceLineStatus(args);
    case "issue_callback_code": return toolIssueCallbackCode(args);
    case "drop_voicemail": return toolDropVoicemail(args);
    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
