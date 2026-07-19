#!/usr/bin/env node
// Take a paid customer's voice receptionist LIVE — the ~12 manual steps, in one idempotent script.
//
//   node scripts/retell/provision-line.mjs --site 42                  # DRY RUN (default)
//   node scripts/retell/provision-line.mjs --site 42 --area-code 602  # DRY RUN, different area code
//   node scripts/retell/provision-line.mjs --site 42 --apply          # actually spends money
//
// What it does, in order:
//   1. read forge_sites + receptionist_config from Postgres
//   2. validate the config is provisionable (fails loudly, listing every missing field)
//   3. ensure the ONE shared receptionist agent exists (never one per customer)
//   4. buy a number in the area code, bind it to the shared agent, set its inbound webhook
//   5. upsert the voice_lines row (reactivating a released/paused row for the same number)
//   6. print the forwarding instructions to read to the customer
//
// SAFETY: --dry-run is the DEFAULT. Steps 3-5 mutate Retell / spend money and only run under
// --apply. Retell numbers are pay-as-you-go — a stray re-run that bought a second number would
// bill monthly, forever, for a line nothing dials. Hence the idempotency checks up front: an
// existing active line for the site short-circuits everything.
//
// Spec: docs/VOICE_TENANCY_SPEC.md. Prompt/tools: ./receptionist-config.mjs.
import { readFileSync } from "node:fs";

import pg from "pg";

import { generalPrompt, beginMessage, buildReceptionistTools } from "./receptionist-config.mjs";

const API = "https://api.retellai.com";
const BASE_URL = process.env.VOICE_WEBHOOK_BASE || "https://thinkbigjoe.com";

// There is exactly ONE of these, shared by every customer. Looked up by name, created once.
// Changing this string orphans the live agent and the next run will create a duplicate — don't.
const SHARED_AGENT_NAME = "TBJ Shared Receptionist";

// Shared secret appended to the webhook URLs we register with Retell. Unset is tolerated (the routes
// warn-and-allow so a half-configured deploy never drops live calls) but leaves both endpoints open.
const VOICE_WEBHOOK_KEY = env("VOICE_WEBHOOK_KEY");
const DEFAULT_AREA_CODE = 480; // Phoenix / Scottsdale
const VOICE_ID = "11labs-Adrian";

function env(key) {
  for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(new RegExp(`^${key}=(.*)$`));
    if (m) return m[1].trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
  }
  return null;
}

const RETELL_API_KEY = env("RETELL_API_KEY");
const WEBHOOK_SECRET = env("RETELL_WEBHOOK_SECRET");
// Unpooled first: this is a short-lived script, and the pooler adds a failure mode we don't need.
const DATABASE_URL = env("DATABASE_URL_UNPOOLED") || env("DATABASE_URL");

function die(msg) {
  console.error(`\nFAILED: ${msg}\n`);
  process.exit(1);
}

if (!RETELL_API_KEY) die("missing RETELL_API_KEY in .env.local");
if (!WEBHOOK_SECRET) die("missing RETELL_WEBHOOK_SECRET in .env.local");
if (!DATABASE_URL) die("missing DATABASE_URL (or DATABASE_URL_UNPOOLED) in .env.local");

async function retell(path, body, method = "POST") {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${RETELL_API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return json;
}

/** Strict E.164. Deliberately strict: this number is dialled by a transfer on a live call. */
function isE164(v) {
  return typeof v === "string" && /^\+[1-9]\d{7,14}$/.test(v.trim());
}

// The next two are hand-ports of src/lib/sms.ts#normalizePhone and src/lib/voice-tenant.ts's
// phoneFromProse. This script is plain node and cannot import the Next app's "@/..." aliases, so
// the logic is duplicated rather than shared. It MUST stay behaviourally identical: provisioning
// deciding a config is unusable while runtime happily derives a number (or vice versa) is exactly
// the mismatch that made this script reject every real customer.

/** Best-effort E.164 normalization for US numbers. Mirror of src/lib/sms.ts#normalizePhone. */
function normalizePhone(raw) {
  if (!raw) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("+")) return trimmed.replace(/[^\d+]/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : undefined;
}

/** First plausible phone number in free text — last resort for the legacy `forwardTo` field. */
function phoneFromProse(s) {
  if (!s) return undefined;
  const m = String(s).match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  return m ? normalizePhone(m[0]) : undefined;
}

/**
 * Resolve the two numbers the receptionist actually needs, exactly the way runtime does
 * (src/lib/voice-tenant.ts): structured keys first, then a phone parsed out of the free-text
 * `forwardTo` the portal form actually writes, and notify falls back to escalate.
 */
function deriveRouting(c) {
  const escalateTo = normalizePhone(c.escalationPhone) ?? phoneFromProse(c.forwardTo);
  const notifyTo = normalizePhone(c.notifyPhone) ?? escalateTo;
  return { escalateTo, notifyTo };
}

/** Pretty-print a payload the way we'd send it, for --dry-run. */
function preview(label, method, path, body) {
  console.log(`  ${method} ${API}${path}`);
  if (body) console.log(String(JSON.stringify(body, null, 2)).split("\n").map((l) => `    ${l}`).join("\n"));
  if (label) console.log(`    → ${label}`);
}

function args() {
  const a = process.argv.slice(2);
  const get = (flag) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const siteId = parseInt(get("--site") ?? "", 10);
  if (!Number.isInteger(siteId) || siteId <= 0) {
    die("--site <siteId> is required, e.g. node scripts/retell/provision-line.mjs --site 42");
  }
  const areaRaw = get("--area-code");
  const areaCode = areaRaw ? parseInt(areaRaw, 10) : DEFAULT_AREA_CODE;
  if (!Number.isInteger(areaCode) || String(areaCode).length !== 3) {
    die(`--area-code must be a 3-digit US area code (got "${areaRaw}")`);
  }
  // --dry-run is the default; only an explicit --apply spends money.
  const apply = a.includes("--apply");
  return { siteId, areaCode, apply };
}

// ── step 1: read the site ────────────────────────────────────────────────────────────────────

async function loadSite(sql, siteId) {
  const { rows } = await sql.query(
    `select id, slug, business_name, booking_timezone, claimed_by_user_id, receptionist_config
       from forge_sites where id = $1`,
    [siteId],
  );
  if (!rows[0]) die(`no forge_sites row with id=${siteId}`);
  return rows[0];
}

async function existingLine(sql, siteId) {
  const { rows } = await sql.query(
    `select phone_number, status, retell_agent_id, created_at
       from voice_lines where site_id = $1 order by created_at desc`,
    [siteId],
  );
  return rows;
}

// ── step 2: validate ─────────────────────────────────────────────────────────────────────────

/**
 * Fail LOUDLY and completely: list every problem at once, not the first one. A half-configured
 * line that provisions anyway is worse than no line — the agent answers a real customer's phone
 * with literal {{braces}} in its mouth, or takes a message it has nowhere to send.
 */
function validateConfig(site) {
  const c = site.receptionist_config && typeof site.receptionist_config === "object" ? site.receptionist_config : {};
  const problems = [];

  // The portal form at /portal/receptionist writes free text — {services, hours, greeting, booking,
  // forwardTo, faqs, doNot} — and nothing in the codebase ever writes escalationPhone/notifyPhone.
  // Demanding those keys rejected every real customer. So gate on what runtime can actually DERIVE
  // (deriveRouting), not on the shape we wish the form had. Only a config from which no number can
  // be extracted at all is unprovisionable — that one is fatal, because with no escalation number
  // transfer_to_human dials nothing and with no notify number a taken message goes nowhere.
  const { escalateTo, notifyTo } = deriveRouting(c);
  if (!escalateTo || !isE164(escalateTo)) {
    problems.push(
      "no usable phone number in receptionist_config — the receptionist would have nowhere to " +
      "transfer an emergency and nowhere to text a message.\n" +
      `      looked at: escalationPhone=${JSON.stringify(c.escalationPhone ?? null)}, ` +
      `notifyPhone=${JSON.stringify(c.notifyPhone ?? null)}, forwardTo=${JSON.stringify(c.forwardTo ?? null)}\n` +
      '      FIX: put the owner\'s mobile in the "Where should we send messages?" field, e.g. ' +
      '"text me at 480-555-1234" — or set receptionist_config.escalationPhone to "+14805551234".',
    );
  } else if (!isE164(notifyTo)) {
    // notifyTo falls back to escalateTo, so this only fires on a malformed explicit notifyPhone.
    problems.push(
      `notifyPhone: "${c.notifyPhone}" did not normalize to E.164 — it is where take_message texts ` +
      'the owner (expected e.g. "+14805551234"). Clear it to fall back to the escalation number.',
    );
  }
  const hasServices = typeof c.services === "string" && c.services.trim().length > 0;
  const hasGreeting = typeof c.greeting === "string" && c.greeting.trim().length > 0;
  if (!hasServices && !hasGreeting) {
    problems.push("services / greeting: both empty — at least one must be filled in or the agent has nothing to say about the business");
  }
  if (!site.business_name || !String(site.business_name).trim()) {
    problems.push("forge_sites.business_name is empty — it is spoken on every call");
  }

  if (problems.length) {
    console.error(`\nSite ${site.id} (${site.slug}) is NOT provisionable. Fix at /portal/receptionist:\n`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error("\nNothing was changed and no number was bought.\n");
    process.exit(1);
  }

  if (!c.bookingMode) console.log("  note: bookingMode unset — the line will run message-taking only (tier 1).");
  if (!site.claimed_by_user_id) console.log("  note: site is unclaimed — booking stays off regardless of bookingMode.");
  if (!isE164(c.escalationPhone) || !isE164(c.notifyPhone)) {
    console.log(`  note: routing derived from free text — escalate ${escalateTo}, notify ${notifyTo}.`);
    console.log("        Confirm those are right before reading the forwarding codes to the customer.");
  }
  return { config: c, escalateTo, notifyTo };
}

// ── step 3: the ONE shared agent ─────────────────────────────────────────────────────────────

/**
 * Agent-level defaults for every {{variable}} in the prompt.
 *
 * Retell does NOT substitute an empty string for a dynamic variable it wasn't given — the literal
 * `{{business_name}}` survives into the prompt and the agent reads the braces aloud to a caller.
 * The inbound webhook normally supplies these per call, but it can time out, 500, or be pointed at
 * a stale deploy; these defaults are the floor under that. Mirrors fallbackVariables() in
 * src/lib/voice-vars.ts — keep the two in sync (a plain node script can't import "@/lib/...").
 */
const AGENT_DEFAULT_VARIABLES = {
  business_name: "this business",
  greeting: "Thanks for calling — the office is closed right now, but I can take a message.",
  services: "Take the caller's details and pass them along. Do not guess at what this business does.",
  service_area: "the local area",
  hours_text: "Regular business hours.",
  emergency_definition: "Treat anything involving danger or active damage as urgent.",
  faq_text: "No information on file — do not guess. Say someone will call them back.",
  do_not_say: "Never promise a specific arrival time, price, or service. You do not have details about this business.",
  escalation_phone: "", // empty is meaningful: the prompt must not offer a transfer we can't perform
  booking_enabled: "false",
  timezone_label: "local",
};

/**
 * Audit an agent we did NOT just create. "A row with the right name exists" is not the same as
 * "it works": an agent left over from a previous BASE_URL points its tool calls at a dead host
 * (every take_message 404s mid-call, silently), and an agent whose LLM was deleted in the
 * dashboard answers nothing at all. Both fail only when a real customer is on the line, so check
 * them here where the cost is a script exit.
 */
async function auditSharedAgent(agent, apply) {
  const llmId = agent.response_engine?.llm_id;
  if (!llmId) {
    die(
      `shared agent ${agent.agent_id} has no response_engine.llm_id ` +
      `(engine: ${JSON.stringify(agent.response_engine ?? null)}). It cannot answer a call. ` +
      "Recreate it in the Retell dashboard, or delete it and re-run this script.",
    );
  }

  let llm;
  try {
    llm = await retell(`/get-retell-llm/${encodeURIComponent(llmId)}`, null, "GET");
  } catch (e) {
    die(
      `shared agent ${agent.agent_id} references llm ${llmId}, which could not be fetched: ` +
      `${e.message.slice(0, 200)}\n  If it was deleted, the agent is dead — delete the agent too ` +
      "and re-run so this script rebuilds both.",
    );
  }

  // Tool URLs live on the LLM (general_tools), not the agent. transfer_call tools have no url.
  const toolUrls = (llm.general_tools || []).filter((t) => typeof t?.url === "string");
  const wrongBase = toolUrls.filter((t) => !t.url.startsWith(`${BASE_URL}/`));
  if (wrongBase.length) {
    die(
      `shared agent ${agent.agent_id} (llm ${llmId}) has tool URLs pointing somewhere other than ` +
      `${BASE_URL}:\n` +
      wrongBase.map((t) => `    ${t.name}: ${t.url}`).join("\n") +
      "\n  Every customer on this agent would fail their tool calls mid-call. Either re-run with " +
      "VOICE_WEBHOOK_BASE set to the host those tools already use, or update the LLM's tools in " +
      "the Retell dashboard to the current base. Nothing was changed and no number was bought.",
    );
  }

  // Missing defaults are repairable in place, unlike the two failures above.
  const missing = Object.keys(AGENT_DEFAULT_VARIABLES).filter(
    (k) => typeof agent.default_dynamic_variables?.[k] !== "string",
  );
  if (missing.length) {
    const patch = { default_dynamic_variables: { ...AGENT_DEFAULT_VARIABLES, ...(agent.default_dynamic_variables || {}) } };
    console.log(`  ! agent is missing default_dynamic_variables: ${missing.join(", ")}`);
    console.log("    Without them Retell leaves the literal {{braces}} in the prompt and the agent reads them aloud.");
    if (apply) {
      await retell(`/update-agent/${encodeURIComponent(agent.agent_id)}`, patch, "PATCH");
      console.log("  ✓ backfilled agent-level defaults");
    } else {
      preview("backfill the missing defaults", "PATCH", `/update-agent/${agent.agent_id}`, patch);
    }
  }

  console.log(`  ✓ tools point at ${BASE_URL}, llm ${llmId} exists`);
}

/**
 * Find the shared receptionist agent, creating it once if this is the first customer ever.
 *
 * There must be exactly one. If a name collision ever produces two, this bails rather than
 * silently picking one — two agents means a prompt fix ships to half the customers.
 */
async function ensureSharedAgent(apply) {
  const agents = await retell("/list-agents", null, "GET");
  const arr = Array.isArray(agents) ? agents : agents?.agents || [];
  const matches = arr.filter((a) => a.agent_name === SHARED_AGENT_NAME);

  if (matches.length > 1) {
    die(
      `${matches.length} agents are named "${SHARED_AGENT_NAME}" (${matches.map((a) => a.agent_id).join(", ")}). ` +
      `Delete the duplicates in the Retell dashboard — every customer must share exactly one.`,
    );
  }
  if (matches.length === 1) {
    console.log(`  ✓ shared agent exists: ${matches[0].agent_id} (llm ${matches[0].response_engine?.llm_id ?? "n/a"})`);
    await auditSharedAgent(matches[0], apply);
    return matches[0].agent_id;
  }

  // buildReceptionistTools takes the Authorization VALUE as a string (it wraps it in a headers
  // object itself) — unlike agent-config.mjs's buildTools, which takes the object. Easy to get
  // backwards; the symptom is a 401 on every tool call at runtime.
  const tools = buildReceptionistTools(BASE_URL, `Bearer ${WEBHOOK_SECRET}`);
  const llmPayload = {
    model: "claude-4.5-sonnet",
    general_prompt: generalPrompt,
    begin_message: beginMessage,
    start_speaker: "agent",
    general_tools: tools,
  };
  const agentPayload = {
    response_engine: { type: "retell-llm", llm_id: "<llm_id from the previous call>" },
    voice_id: VOICE_ID,
    agent_name: SHARED_AGENT_NAME,
    language: "en-US",
    // See AGENT_DEFAULT_VARIABLES: an unsupplied dynamic variable is left as literal {{braces}},
    // not blanked, so the agent would speak them if the inbound webhook ever misses.
    default_dynamic_variables: AGENT_DEFAULT_VARIABLES,
    // Where call_started / call_ended / call_analyzed are delivered. Without this nothing ever
    // persists a call, /portal/calls stays empty forever, and the history is unrecoverable —
    // Retell's retention is not our database. Set on the agent so it covers every customer's number.
    webhook_url: callWebhookUrl(),
  };

  if (!apply) {
    console.log(`  … no agent named "${SHARED_AGENT_NAME}" — would create it (once, for everyone):`);
    preview("returns llm_id", "POST", "/create-retell-llm", {
      ...llmPayload,
      general_prompt: `<${generalPrompt.length} chars from receptionist-config.mjs>`,
      general_tools: tools.map((t) => t.name),
    });
    preview("returns agent_id", "POST", "/create-agent", agentPayload);
    return null;
  }

  console.log(`  … no agent named "${SHARED_AGENT_NAME}" — creating it (once, for everyone)`);
  const llm = await retell("/create-retell-llm", llmPayload);
  console.log(`    llm_id: ${llm.llm_id}`);
  const agent = await retell("/create-agent", { ...agentPayload, response_engine: { type: "retell-llm", llm_id: llm.llm_id } });
  console.log(`  ✓ shared agent created: ${agent.agent_id}`);
  return agent.agent_id;
}

// ── step 4: the number ───────────────────────────────────────────────────────────────────────

/**
 * The URLs we register with Retell carry the shared secret as a query param, because Retell's
 * inbound-call webhook auth mechanism is not documented and it POSTs to exactly the URL we configure.
 * The routes compare `?k=` against VOICE_WEBHOOK_KEY in constant time.
 *
 * THESE MUST STAY IN LOCKSTEP WITH THE ROUTES. If VOICE_WEBHOOK_KEY is set in the app's environment
 * but a number was registered with a keyless URL, every inbound call is rejected and the caller hears
 * the generic fallback greeting instead of the business — a silent, total product failure that looks
 * like "the AI forgot who it works for". Re-run this script for every live line after rotating the key.
 */
const webhookKeySuffix = () => (VOICE_WEBHOOK_KEY ? `?k=${encodeURIComponent(VOICE_WEBHOOK_KEY)}` : "");

const inboundWebhookUrl = () => `${BASE_URL}/api/voice/inbound${webhookKeySuffix()}`;

/** Call-lifecycle events (call_started / call_ended / call_analyzed) — set on the shared agent. */
const callWebhookUrl = () => `${BASE_URL}/api/voice/webhook${webhookKeySuffix()}`;

/**
 * Buy a number and wire it up.
 *
 * Two calls, not one: /create-phone-number is the only step that costs money, and the live
 * phone-number object we inspected has no inbound_webhook_url key, so we set it with an explicit
 * update rather than gambling that create accepts the field and silently drops it. Without that
 * URL the inbound webhook never fires and every call gets the fallback greeting.
 */
async function buyNumber(siteId, slug, areaCode, agentId, apply) {
  const createPayload = {
    country_code: "US",
    area_code: areaCode,
    nickname: `TBJ site ${siteId} — ${slug}`,
    inbound_agents: [{ agent_id: agentId ?? "<shared agent_id>", weight: 1.0 }],
  };
  const webhookPayload = { inbound_webhook_url: inboundWebhookUrl() };

  if (!apply) {
    console.log("  … would buy a number (THIS IS THE STEP THAT COSTS MONEY):");
    preview("returns { phone_number }", "POST", "/create-phone-number", createPayload);
    preview("binds tenant resolution to the dialled number", "PATCH", "/update-phone-number/<phone_number>", webhookPayload);
    return null;
  }

  const pn = await retell("/create-phone-number", createPayload);
  const number = pn.phone_number;
  if (!number) die(`create-phone-number returned no phone_number: ${JSON.stringify(pn).slice(0, 300)}`);
  console.log(`  ✓ bought ${number} (area code ${areaCode})`);

  await retell(`/update-phone-number/${encodeURIComponent(number)}`, webhookPayload, "PATCH");
  console.log(`  ✓ inbound webhook → ${inboundWebhookUrl()}`);
  return number;
}

/**
 * A number we already own, nicknamed for this site — the recovery path when a previous run bought
 * a number and then died before writing voice_lines. Reusing it is what stops the retry from
 * billing us twice.
 */
async function orphanNumberForSite(siteId, apply) {
  try {
    const list = await retell("/list-phone-numbers", null, "GET");
    const arr = Array.isArray(list) ? list : list?.phone_numbers || [];
    return arr.find((n) => typeof n.nickname === "string" && n.nickname.startsWith(`TBJ site ${siteId} —`)) || null;
  } catch (e) {
    // Null here means "no orphan exists", and the caller answers that by BUYING a number. A
    // transient 500 from Retell must not be allowed to mean that — it would bill us monthly,
    // forever, for a duplicate line. Only a dry run, which cannot spend, may degrade to null.
    if (apply) {
      die(
        `could not list existing phone numbers: ${e.message.slice(0, 200)}\n  ` +
        "Refusing to buy a number without confirming we don't already own one for this site — a " +
        "false 'no orphan' here bills us monthly for a duplicate line. Nothing was changed. " +
        "Re-run once the Retell API answers.",
      );
    }
    console.log(`  (couldn't list existing numbers: ${e.message.slice(0, 120)})`);
    console.log("  (dry run — continuing as if none exists; under --apply this would abort rather than risk a duplicate buy)");
    return null;
  }
}

// ── step 6: what to read to the customer ─────────────────────────────────────────────────────

// `routing` is the DERIVED {escalateTo, notifyTo} from validateConfig, not the raw config keys —
// the customer must be told the number we will actually text, which for a free-text config is the
// one parsed out of forwardTo.
function forwardingInstructions(site, number, routing) {
  const n = number ?? "<the number this run would buy>";
  return `
────────────────────────────────────────────────────────────────────────
READ THIS TO ${String(site.business_name).toUpperCase()}
────────────────────────────────────────────────────────────────────────
Your new receptionist line is:  ${n}

Nothing changes about your own number. You forward to us only when YOU
don't pick up, so we catch the calls you'd otherwise lose. Dial these
from the business phone, one at a time, and wait for the confirmation
tone after each:

  Forward when you don't answer (after ~20 seconds):
      *61*${n}*11*20#

  Forward when your line is busy:
      *67*${n}#

  Forward when your phone is off or has no signal:
      *62*${n}#

Test it: call your own number from another phone and let it ring out.
You should hear the receptionist pick up.

TURNING IT OFF — the kill switch. If you ever want your calls to stop
coming to us, dial:

      ##61#      (turns off the no-answer forward — this is the main one)
      ##67#      (turns off the busy forward)
      ##62#      (turns off the unreachable forward)

Or ##002# to clear every forwarding rule on the line at once. It takes
effect immediately, no call to us needed.

Messages will be texted to ${routing.notifyTo}.
Emergencies transfer to ${routing.escalateTo}.
Every call, with transcript, appears at ${BASE_URL}/portal/calls.

NOTE: these codes are the GSM standard and work on the major US mobile
carriers. Landlines and VoIP (Spectrum, Comcast, RingCentral, Ooma) use
their own settings page instead — check the carrier before reading these
out to a customer on a landline.
────────────────────────────────────────────────────────────────────────`;
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const { siteId, areaCode, apply } = args();

  console.log(apply ? "\n=== PROVISION (--apply: this will spend money) ===" : "\n=== DRY RUN (default — nothing will be changed; pass --apply to execute) ===");

  const sql = new pg.Client({ connectionString: DATABASE_URL });
  await sql.connect();

  let number = null;
  let site;
  let escalateTo;
  let notifyTo;
  try {
    console.log(`\n[1/6] site ${siteId}`);
    site = await loadSite(sql, siteId);
    console.log(`  ${site.business_name} (${site.slug}), tz ${site.booking_timezone}`);

    console.log("\n[2/6] validating receptionist_config");
    ({ escalateTo, notifyTo } = validateConfig(site));
    console.log("  ✓ provisionable");

    // Idempotency gate. Everything below this line either costs money or writes a row, so a
    // second run for a site that already has a line must stop HERE and say so.
    const lines = await existingLine(sql, siteId);
    const live = lines.find((l) => l.status === "active" || l.status === "provisioning");
    if (live) {
      console.log(`\n✓ ALREADY PROVISIONED — site ${siteId} has ${live.phone_number} (status: ${live.status}).`);
      console.log("  No number bought, no row written. To move this site to a different number, release the");
      console.log("  existing line first (set voice_lines.status='released' and delete the number in Retell).");
      console.log(forwardingInstructions(site, live.phone_number, { escalateTo, notifyTo }));
      return;
    }
    if (lines.length) {
      console.log(`  (${lines.length} released/paused line(s) on file — provisioning a fresh one)`);
    }

    console.log("\n[3/6] shared receptionist agent");
    const agentId = await ensureSharedAgent(apply);

    console.log("\n[4/6] phone number");
    const orphan = await orphanNumberForSite(siteId, apply);
    if (orphan) {
      // Previous run bought this and died before the insert. Adopt it instead of buying again.
      number = orphan.phone_number;
      console.log(`  ✓ reusing already-owned ${number} (nickname "${orphan.nickname}") — not buying a second one`);
      if (apply) {
        await retell(`/update-phone-number/${encodeURIComponent(number)}`, {
          inbound_webhook_url: inboundWebhookUrl(),
          inbound_agents: [{ agent_id: agentId, weight: 1.0 }],
        }, "PATCH");
        console.log("  ✓ re-bound to the shared agent + inbound webhook");
      } else {
        preview("re-bind the orphan", "PATCH", `/update-phone-number/${number}`, {
          inbound_webhook_url: inboundWebhookUrl(),
          inbound_agents: [{ agent_id: "<shared agent_id>", weight: 1.0 }],
        });
      }
    } else {
      number = await buyNumber(siteId, site.slug, areaCode, agentId, apply);
    }

    console.log("\n[5/6] voice_lines row");
    // Upsert, NOT "do nothing". A released/paused row for this number is exactly the case that
    // reaches here (the idempotency gate above only short-circuits on active/provisioning), and
    // "do nothing" left it dead — number re-bound in Retell, routing still refusing to resolve it,
    // so the line rings and tenantByNumber returns null. Reactivating is the whole point.
    //
    // The `where` clause on the update is the safety interlock: if the conflicting row belongs to
    // a DIFFERENT site, no row is updated and nothing is returned, so we bail below instead of
    // silently pointing one business's number at another business's site. Doing that check in SQL
    // rather than a prior SELECT keeps it atomic against a concurrent run.
    const insertSql =
      `insert into voice_lines (phone_number, site_id, status, retell_agent_id)
         values ($1, $2, 'active', $3)
         on conflict (phone_number) do update
           set status = 'active',
               retell_agent_id = excluded.retell_agent_id,
               updated_at = now()
           where voice_lines.site_id = excluded.site_id
         returning id, (xmax <> 0) as reactivated`;
    if (apply) {
      const { rows } = await sql.query(insertSql, [number, siteId, agentId]);
      if (!rows[0]) {
        // Number is on file for another site. Two businesses one dial away from each other's
        // callers is a data-integrity emergency, not something to paper over with a warning.
        const { rows: owner } = await sql.query(
          "select id, site_id, status from voice_lines where phone_number = $1",
          [number],
        );
        die(
          `CROSS-SITE COLLISION: ${number} is already in voice_lines for site ${owner[0]?.site_id} ` +
          `(row ${owner[0]?.id}, status ${owner[0]?.status}) — not site ${siteId}.\n  ` +
          "Refusing to re-point it: that would route one business's callers to another business. " +
          `The number IS now bound to the shared agent in Retell, so resolve this immediately — ` +
          "either release the other site's line and re-run, or unbind the number in the Retell dashboard.",
        );
      }
      console.log(
        rows[0].reactivated
          ? `  ✓ voice_lines id ${rows[0].id} — reactivated existing row for ${number} → site ${siteId}, status active`
          : `  ✓ voice_lines id ${rows[0].id} — ${number} → site ${siteId}, status active`,
      );
    } else {
      console.log("  would run:");
      console.log(insertSql.split("\n").map((l) => `    ${l.trim()}`).join("\n"));
      console.log(`    params: ["${number ?? "<new number>"}", ${siteId}, "<shared agent_id>"]`);
    }

    console.log("\n[6/6] summary");
    console.log(`  business : ${site.business_name} (site ${siteId}, ${site.slug})`);
    console.log(`  line     : ${number ?? "<not bought — dry run>"}`);
    console.log(`  agent    : ${agentId ?? "<shared agent — not created in dry run>"} (shared, ${SHARED_AGENT_NAME})`);
    console.log(`  webhook  : ${inboundWebhookUrl()}`);
    console.log(`  notify   : ${notifyTo}   escalate: ${escalateTo}`);
    console.log(forwardingInstructions(site, number, { escalateTo, notifyTo }));

    if (!apply) {
      console.log("\nDRY RUN — nothing above actually happened. Re-run with --apply to execute.\n");
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(`\nFAILED: ${e.message}`);
  console.error("If a number was bought before this failed, re-running is safe — the script adopts an");
  console.error("already-owned number nicknamed for this site instead of buying a second one.\n");
  process.exit(1);
});
