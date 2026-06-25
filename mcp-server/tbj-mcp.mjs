#!/usr/bin/env node
/**
 * tbj-mcp — ThinkBigJoe MCP server for Venus (OpenClaw)
 *
 * Exposes seven tools Venus can call:
 *   queue_job                — natural-language command → cowork_jobs row
 *   get_status               — queue + pipeline counts + recent jobs
 *   list_pending_replies     — reply_drafts awaiting Joe's approval
 *   handle_reply             — approve / pause / edit a pending reply draft
 *   add_prospect             — add a researched prospect to the review queue
 *   list_approved_for_outreach — find approved connection requests to send
 *   mark_sent                — record that a LinkedIn connection request was sent
 *
 * Reads DATABASE_URL from env (passed via OpenClaw mcp.servers config).
 * No Vercel deploy needed — runs locally on the Mac Mini.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import pg from "pg";

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
// Command parser (mirrors src/lib/cowork-commands.ts — keyword-based, no LLM)
// ---------------------------------------------------------------------------
const VERTICAL_KEYWORDS = [
  ["insurance", /\b(insurance|insurer|p&?c|underwrit|brokerage|agencies|agency)\b/i],
  ["mortgage", /\b(mortgage|loan officer|lending|lender|originat)\b/i],
  ["wealth", /\b(wealth|financial advisor|advisor|advisory|r\.?i\.?a\.?|investment manage|retirement plan)\b/i],
  ["msp", /\b(msp|managed service|it service|it provider|it consult|managed it)\b/i],
  ["law", /\b(law|lawyer|attorney|legal|litigation|counsel)\b/i],
];

function parseVertical(text) {
  for (const [v, re] of VERTICAL_KEYWORDS) if (re.test(text)) return v;
  return null;
}

function parseCount(text) {
  const m = text.match(/\b(\d{1,3})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : null;
}

function parseLocation(text) {
  const m = text.match(
    /\b(?:in|near|around|across)\s+([a-z][a-z .'-]{1,38}?)(?=\s*[.,]|\s+\b(?:that|who|which|with|for|and|to|so)\b|\s*$)/i,
  );
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

function parseCommand(raw) {
  const text = (raw || "").trim();
  const lower = text.toLowerCase();
  if (/^\/?(help|commands|\?)\b/.test(lower) || lower === "/start")
    return { intent: "help", vertical: null, location: null, count: null };
  if (/\b(status|queue|how many|what'?s queued|jobs?)\b/.test(lower))
    return { intent: "status", vertical: null, location: null, count: null };
  const vertical = parseVertical(lower);
  const location = parseLocation(text);
  const count = parseCount(lower);
  if (
    /\b(find|get|source|pull|add|expand|grab|look(?:ing)? for|search|scout|research|more)\b/.test(lower) &&
    /\b(lead|prospect|compan|owner|agenc|firm|advisor|broker|client)\b/.test(lower)
  ) return { intent: "find_leads", vertical, location, count };
  if (/\b(more leads|more prospects|find more|leads in|prospects in)\b/.test(lower))
    return { intent: "find_leads", vertical, location, count };
  if (
    /\b(start|begin|run|kick off|go|work)\b/.test(lower) &&
    /\b(prospect|outreach|session|queue|sequence|drafts?)\b/.test(lower)
  ) return { intent: "start_prospecting", vertical, location, count };
  if (vertical && /\b(lead|prospect|owner|agenc|firm|advisor)\b/.test(lower))
    return { intent: "find_leads", vertical, location, count };
  return { intent: "unknown", vertical, location, count };
}

const VERTICAL_LABEL = {
  insurance: "insurance agencies",
  mortgage: "mortgage / lending",
  wealth: "wealth management",
  msp: "MSP / IT services",
  law: "law firms",
  other: "general",
};

function describeCommand(p) {
  const parts = [p.count ? `${p.count}` : "more", p.vertical ? VERTICAL_LABEL[p.vertical] : "", "leads"];
  if (p.location) parts.push(`in ${p.location}`);
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------
async function toolQueueJob({ command }) {
  const cmd = parseCommand(command);
  if (cmd.intent === "help" || cmd.intent === "status" || cmd.intent === "unknown") {
    return {
      content: [{
        type: "text",
        text: cmd.intent === "unknown"
          ? `I couldn't parse that as a Cowork job. Try: "find 30 wealth leads in Texas" or "start prospecting insurance".`
          : `That looks like a '${cmd.intent}' request — use get_status instead of queue_job for that.`,
      }],
    };
  }
  const res = await query(
    `INSERT INTO cowork_jobs (source, raw_command, intent, vertical, location, target_count, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued')
     RETURNING id`,
    ["venus", command, cmd.intent, cmd.vertical, cmd.location, cmd.count],
  );
  const id = res.rows[0].id;
  return {
    content: [{
      type: "text",
      text: `✅ Queued job #${id} — ${cmd.intent === "find_leads" ? `find ${describeCommand(cmd)}` : `start prospecting${cmd.vertical ? ` (${VERTICAL_LABEL[cmd.vertical]})` : ""}`}.\n\nThe Mac mini runner will claim it within ~2 min and ping you on Telegram when done.`,
    }],
  };
}

async function toolGetStatus() {
  const [queued, prospects, drafts, pendingReview, approvedWaiting, recent] = await Promise.all([
    query(`SELECT count(*)::int AS n FROM cowork_jobs WHERE status = 'queued'`),
    query(`SELECT count(*)::int AS n FROM prospects`),
    query(`SELECT count(*)::int AS n FROM outreach WHERE status = 'draft'`),
    query(`SELECT count(*)::int AS n FROM prospects WHERE status = 'new'`),
    query(`SELECT count(*)::int AS n FROM outreach WHERE step = 'connection' AND status = 'approved'`),
    query(`SELECT id, intent, vertical, location, target_count, status, result_summary, created_at FROM cowork_jobs ORDER BY created_at DESC LIMIT 5`),
  ]);
  const lines = [
    `📊 ThinkBigJoe Status`,
    `• Jobs queued: **${queued.rows[0].n}**`,
    `• Prospects in DB: **${prospects.rows[0].n}**`,
    `• Outreach drafts pending: **${drafts.rows[0].n}**`,
    `• Prospects pending review: **${pendingReview.rows[0].n}**`,
    `• Approved connections waiting to send: **${approvedWaiting.rows[0].n}**`,
  ];
  if (recent.rows.length) {
    lines.push("", "**Recent jobs:**");
    for (const j of recent.rows) {
      const desc = j.intent === "find_leads"
        ? `find ${j.target_count || "more"} ${j.vertical ? VERTICAL_LABEL[j.vertical] || j.vertical : "leads"}${j.location ? ` in ${j.location}` : ""}`
        : j.intent;
      const summary = j.result_summary ? ` — ${j.result_summary}` : "";
      lines.push(`#${j.id} · ${desc} · *${j.status}*${summary}`);
    }
  }
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
    return { content: [{ type: "text", text: `⏸ Paused draft #${draft_id} for ${row.prospect_name} — nothing sent, that thread is muted.` }] };
  }
  const finalText = /^(send|yes|go|approve|ok|sure|send it)\b/.test(lower) ? row.draft : action;
  await query(
    `UPDATE reply_drafts SET status = 'approved', final_text = $1, updated_at = now() WHERE id = $2`,
    [finalText, draft_id],
  );
  return {
    content: [{
      type: "text",
      text: `✅ Approved reply for ${row.prospect_name}:\n_${finalText?.slice(0, 300)}_\n\nThe Windows sender will post it shortly.`,
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
  return { content: [{ type: "text", text: `✅ Added ${name} from ${company} to the review queue.` }] };
}

async function toolUpdateProspect({
  prospect_id, photo_url, email, phone, website_url,
  website_status, website_rating, website_notes, sales_opportunities,
}) {
  const existing = await query(`SELECT id, recon FROM prospects WHERE id = $1 LIMIT 1`, [prospect_id]);
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
    ...(website_status !== undefined && { websiteStatus: String(website_status).trim() }),
    ...(website_rating !== undefined && { websiteRating: Number.isFinite(rating) ? Math.max(1, Math.min(10, Math.round(rating))) : null }),
    ...(website_notes !== undefined && { websiteNotes: String(website_notes).trim() }),
    ...(sales_opportunities !== undefined && { salesOpportunities: opportunities }),
  };
  await query(
    `UPDATE prospects SET recon = $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify(updated), prospect_id],
  );
  const changes = Object.keys(updated).filter((k) => updated[k] !== current[k]);
  return { content: [{ type: "text", text: `✅ Updated prospect #${prospect_id} — enriched: ${changes.join(", ") || "no changes"}.` }] };
}

async function toolListNeedsEnrichment({ limit = 20 } = {}) {
  const res = await query(
    `SELECT id, name, title, company, vertical, profile_url,
            recon->>'photoUrl' AS photo_url,
            recon->>'email' AS email,
            recon->>'phone' AS phone,
            recon->>'websiteUrl' AS website_url
     FROM prospects
     WHERE paused = false
       AND (recon IS NULL
         OR recon->>'photoUrl' IS NULL OR recon->>'photoUrl' = ''
         OR recon->>'email' IS NULL OR recon->>'email' = '')
     ORDER BY created_at ASC
     LIMIT $1`,
    [Math.min(Number(limit) || 20, 50)],
  );
  if (!res.rows.length) {
    return { content: [{ type: "text", text: "All prospects already have photos and email — nothing to enrich." }] };
  }
  const lines = [`🔍 **${res.rows.length} prospects need enrichment (photo and/or email missing):**`, ""];
  for (const r of res.rows) {
    const missing = [!r.photo_url && "photo", !r.email && "email", !r.phone && "phone"].filter(Boolean).join(", ");
    lines.push(`**#${r.id} ${r.name}** · ${r.title || ""} at ${r.company || ""} · missing: ${missing}`);
    if (r.profile_url) lines.push(`LinkedIn: ${r.profile_url}`);
    if (r.website_url) lines.push(`Website: ${r.website_url}`);
    lines.push("");
  }
  lines.push("For each: visit their LinkedIn or website, find the missing data, call update_prospect with prospect_id and the fields found.");
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
  await query(
    `UPDATE outreach SET status = 'sent', sent_at = now() WHERE id = $1`,
    [outreach_id],
  );
  await query(
    `UPDATE prospects SET status = 'connected' WHERE id = (SELECT prospect_id FROM outreach WHERE id = $1)`,
    [outreach_id],
  );
  const extra = notes ? `\nNotes: ${notes}` : "";
  return { content: [{ type: "text", text: `✅ Marked as sent. Prospect moved to 'connected' status.${extra}` }] };
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------
const server = new Server(
  { name: "tbj-mcp", version: "1.4.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "queue_job",
      description: "Queue a ThinkBigJoe prospecting job. Use natural language: 'find 30 wealth leads in Texas', 'start prospecting insurance', etc. The Mac mini runner claims and works the job within ~2 min.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Natural-language Cowork command (same syntax as texting the Telegram bot)." },
        },
        required: ["command"],
      },
    },
    {
      name: "get_status",
      description: "Get current ThinkBigJoe pipeline status: queued jobs, prospect DB size, outreach drafts pending, prospects pending review, approved connections waiting to send, and recent job history.",
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
      name: "list_needs_enrichment",
      description: "List existing prospects that are missing a profile photo, email, or phone number. Returns up to 50, oldest first. Use this to drive the weekly enrichment pass — then call update_prospect for each one after finding the data.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max prospects to return (1–50, default 20)." },
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
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  switch (name) {
    case "queue_job": return toolQueueJob(args);
    case "get_status": return toolGetStatus();
    case "list_pending_replies": return toolListPendingReplies();
    case "handle_reply": return toolHandleReply(args);
    case "list_needs_enrichment": return toolListNeedsEnrichment(args);
    case "check_outreach_window": return toolCheckOutreachWindow();
    case "add_prospect": return toolAddProspect(args);
    case "update_prospect": return toolUpdateProspect(args);
    case "list_approved_for_outreach": return toolListApprovedForOutreach();
    case "mark_sent": return toolMarkSent(args);
    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
