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
async function audit(action, summary, { prospectId = null, target = null, detail = null } = {}) {
  try {
    await query(
      `INSERT INTO activity_log (actor, event_type, summary, metadata)
       VALUES ('venus', $1, $2, $3::jsonb)`,
      [action, summary, JSON.stringify({ auto: true, prospectId, target, detail })],
    );
  } catch (err) {
    console.error(`[audit] failed to log ${action}:`, err?.message || err);
  }
}

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
  const cfg = (await query(`SELECT daily_goal, enabled FROM outreach_engine WHERE id = 1`)).rows[0] || { daily_goal: 15, enabled: true };
  if (!cfg.enabled) {
    return { content: [{ type: "text", text: "Outreach is paused (outreach_engine.enabled=false). Nothing to draft." }] };
  }
  const goal = Number(cfg.daily_goal) || 15;
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
            existing_website_url, live_url, google_maps_url, linkedin_url, instagram_url, facebook_url, status, outreach_status
     FROM forge_sites
     WHERE status IN ('built','approved','discovered')
       AND (email IS NULL OR email = '' OR owner_name IS NULL OR owner_name = '' OR outreach_status = 'bounced')
     ORDER BY (outreach_status = 'bounced') DESC, (status = 'built') DESC, created_at DESC
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
const SMS_FOLLOWUP_DAILY_CAP = 15;

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
async function toolLogActivity({ event_type, summary, metadata }) {
  const res = await query(
    `INSERT INTO activity_log (actor, event_type, summary, metadata) VALUES ('venus', $1, $2, $3::jsonb) RETURNING id`,
    [event_type, summary, metadata ? JSON.stringify(metadata) : null],
  );
  const id = res.rows[0].id;
  return { content: [{ type: "text", text: `✅ Activity logged (#${id}).` }] };
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
  { name: "tbj-mcp", version: "2.30.0" },
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
      name: "log_activity",
      description: "Log a Venus cron activity to the activity_log table. Call this when a cron job finishes to record what happened.",
      inputSchema: {
        type: "object",
        properties: {
          event_type: { type: "string", description: "Event type slug, e.g. 'outreach_sent', 'scout_complete', 'followup_sent', 'booking_made', 'enrichment_complete', 'inbox_checked'." },
          summary: { type: "string", description: "Human-readable summary of what happened." },
          metadata: { type: "object", description: "Optional structured data about the event (counts, names, etc.)." },
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
