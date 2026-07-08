#!/usr/bin/env node
// Create the ThinkBigJoe phone receptionist on Retell (LLM + agent + optional phone number).
// This is also the blueprint for Path A per-client provisioning.
//
//   node scripts/retell/create-tbj-agent.mjs [--number]
//
// Reads RETELL_API_KEY + RETELL_WEBHOOK_SECRET from .env.local. --number tries to buy a phone
// number (needs billing); without it, create the agent and test via a web call in the dashboard.
import { readFileSync } from "node:fs";

const API = "https://api.retellai.com";
const BASE_URL = process.env.VOICE_WEBHOOK_BASE || "https://thinkbigjoe.com";

function env(key) {
  for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(new RegExp(`^${key}=(.*)$`));
    if (m) return m[1].trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
  }
  return null;
}
const RETELL_API_KEY = env("RETELL_API_KEY");
const WEBHOOK_SECRET = env("RETELL_WEBHOOK_SECRET");
if (!RETELL_API_KEY) { console.error("missing RETELL_API_KEY in .env.local"); process.exit(1); }
if (!WEBHOOK_SECRET) { console.error("missing RETELL_WEBHOOK_SECRET in .env.local"); process.exit(1); }

async function retell(path, body, method = "POST") {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${RETELL_API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return json;
}

const authHeader = { Authorization: `Bearer ${WEBHOOK_SECRET}` };

const generalPrompt = `You are the warm, sharp front-desk receptionist for ThinkBigJoe, Joe Sardella's AI web-design studio. Most people calling this number are local business owners who just got a message from us: "we built you a website — here's the link and a claim code." Your job is to help them understand it, claim it, get set up, and either self-serve in their portal or book time with Joe. Be natural and concise — this is a phone call, one question at a time. Never oversell, never pressure. Read the caller and follow their lead.

── OPEN ──
Greet, then find out why they're calling:
"Thanks for calling ThinkBigJoe! Are you calling about the website we built for your business?"

── IF YES (the main path) ──
1) REASSURE it's real: "Yes — we build a full site for local businesses and reserve it for you. It's a real, finished site, not a mockup."
2) CONFIRM THEIR CODE if they have one. A site CLAIM CODE looks like TBJ-1234-ABCD; an ACCOUNT NUMBER is a 6-digit number like 100001 (some callers call it their account number). If they read either out, call verify_code with it. If valid, confirm the business name back ("Perfect — that's the site for [Business]"). If they don't have it handy, tell them it's in the email or text we sent.
3) WALK THE CLAIM, one step at a time:
   - "First, create a free account at thinkbigjoe.com — just your email and a password."
   - "Then go to 'Claim your site' and enter that claim code — that links the site to your account."
   - "From there it's yours to manage."
4) PLANS & PRICING — do NOT quote prices or numbers on the call. Instead: "All the plans are laid out in your account portal so you can review them side by side — a website plan, a website-plus-AI-voice plan, and our complete package. Take a look there and pick what fits." Only add, if they ask what the tiers include: a hosted, maintained website; adding an AI voice receptionist that answers your phone and books jobs 24/7 (that's what I am); and a complete package that runs your whole front office with AI. For the complete/agentic package, tell them Joe sets that up personally — offer to book a call with him (booking flow below).
5) SETTING UP THE AI RECEPTIONIST: if they want the AI phone answering, tell them it comes with the Website-plus-Voice plan they choose in the portal, and Joe's team activates it for their business once they're on that plan. If they have questions about it, offer to book Joe.
6) CLOSE — read the caller and offer whichever fits (don't force one):
   - Book Joe: "Want me to grab you 15 minutes with Joe to walk through it?" → booking flow.
   - Or reassure DIY: "Honestly the portal's really simple — once you claim it, you can edit your text, hours, and photos yourself, or just email us and we'll handle changes for you."

── IF NO / new caller ──
Briefly say what we do — "We build AI-powered websites and voice agents for local businesses" — and offer to book a quick call with Joe (booking flow below).

── BOOKING FLOW ──
Get their full name and email (repeat the email back to confirm spelling) and one line on what they need. Call check_availability, offer two or three real times out loud (never invent times), then call book_appointment with the exact "start" timestamp they chose. Confirm the time and that a calendar invite with a Google Meet link is on the way. Calls are Mon–Fri, 11 AM–1 PM Pacific, 30 minutes, over Google Meet.

── ALWAYS ──
- NEVER take a credit card or payment over the phone — plans are chosen and paid in the portal, or set up with Joe. Direct them there.
- If you can't help or they want a human, take their name, number, and reason and say Joe's team will follow up. Never promise anything beyond what's here.`;

const tools = [
  {
    type: "custom",
    name: "verify_code",
    description:
      "Confirm a caller's site claim code (like TBJ-1234-ABCD) OR their 6-digit account number (like 100001). Call this whenever a caller reads out a code or account number so you can confirm it's real and say which business it belongs to. Returns { valid, kind, businessName, message } — read the 'message' back to the caller.",
    url: `${BASE_URL}/api/voice/verify`,
    method: "POST",
    headers: authHeader,
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "The claim code or account number exactly as the caller read it (dashes/spaces are fine)." },
      },
      required: ["code"],
    },
    speak_during_execution: true,
    speak_after_execution: true,
    execution_message_description: "Let me pull that up.",
    timeout_ms: 15000,
  },
  {
    type: "custom",
    name: "check_availability",
    description:
      "Get real open strategy-call time slots. Call this before offering any times. Omit 'date' to get the next available openings across upcoming days, or pass a specific date to check that day. Returns a 'message' to read and 'slots' each with a 'start' ISO timestamp to pass to book_appointment.",
    url: `${BASE_URL}/api/voice/availability`,
    method: "POST",
    headers: authHeader,
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional specific date in YYYY-MM-DD (Pacific). Omit for the next openings." },
      },
      required: [],
    },
    speak_during_execution: true,
    speak_after_execution: true,
    execution_message_description: "Let me check the calendar for open times.",
    timeout_ms: 15000,
  },
  {
    type: "custom",
    name: "book_appointment",
    description:
      "Book the strategy call once the caller has given their name, email, and chosen a specific slot from check_availability. Pass the exact 'start' ISO timestamp of the chosen slot as start_time.",
    url: `${BASE_URL}/api/voice/book`,
    method: "POST",
    headers: authHeader,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Caller's full name." },
        email: { type: "string", description: "Caller's email address (confirmed with them)." },
        start_time: { type: "string", description: "Exact 'start' ISO timestamp from check_availability for the chosen slot." },
        phone: { type: "string", description: "Caller's phone number, if collected." },
        notes: { type: "string", description: "One line on what the caller needs." },
      },
      required: ["name", "email", "start_time"],
    },
    speak_during_execution: true,
    speak_after_execution: true,
    execution_message_description: "Great — let me lock that in.",
    timeout_ms: 20000,
  },
];

async function main() {
  const wantNumber = process.argv.includes("--number");

  // Pick a voice (professional). Fall back to a known-good one.
  let voiceId = "11labs-Adrian";
  try {
    const voices = await retell("/list-voices", null, "GET");
    const arr = Array.isArray(voices) ? voices : voices?.voices || [];
    const pref = arr.find((v) => /adrian|brian|ryan|matthew/i.test(v.voice_name || v.voice_id || ""))
      || arr.find((v) => /11labs/i.test(v.voice_id || ""))
      || arr[0];
    if (pref?.voice_id) voiceId = pref.voice_id;
    console.log(`voice: ${voiceId}${pref?.voice_name ? ` (${pref.voice_name})` : ""}  [${arr.length} voices available]`);
  } catch (e) {
    console.log(`list-voices failed (${e.message.slice(0, 80)}) — using default ${voiceId}`);
  }

  console.log("creating Retell LLM…");
  const llm = await retell("/create-retell-llm", {
    model: "claude-4.5-sonnet",
    general_prompt: generalPrompt,
    begin_message: "Thanks for calling ThinkBigJoe! This is the front desk — are you calling about the website we built for your business?",
    start_speaker: "agent",
    general_tools: tools,
  });
  console.log("  llm_id:", llm.llm_id);

  console.log("creating agent…");
  const agent = await retell("/create-agent", {
    response_engine: { type: "retell-llm", llm_id: llm.llm_id },
    voice_id: voiceId,
    agent_name: "ThinkBigJoe Receptionist",
    language: "en-US",
  });
  console.log("  agent_id:", agent.agent_id);

  let number = null;
  if (wantNumber) {
    try {
      console.log("provisioning phone number…");
      const pn = await retell("/create-phone-number", {
        country_code: "US",
        area_code: 480, // Phoenix / Scottsdale
        nickname: "ThinkBigJoe",
        inbound_agents: [{ agent_id: agent.agent_id, weight: 1.0 }],
      });
      number = pn.phone_number;
      console.log("  number:", number);
    } catch (e) {
      console.log("  number provisioning failed (likely needs billing):", e.message.slice(0, 160));
    }
  }

  console.log("\n=== DONE ===");
  console.log(JSON.stringify({ llm_id: llm.llm_id, agent_id: agent.agent_id, voice_id: voiceId, number }, null, 2));
  if (!number) console.log("No number yet — test via a web call in the Retell dashboard (Agents → ThinkBigJoe Receptionist → Test), or re-run with --number after adding billing.");
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
