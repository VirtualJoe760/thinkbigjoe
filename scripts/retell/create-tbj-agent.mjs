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

const generalPrompt = `You are the friendly, professional phone receptionist for ThinkBigJoe, an AI automation and web-design agency founded by Joe Sardella. ThinkBigJoe builds agentic software, custom MCP integrations, AI sales funnels, websites for local businesses, and AI voice agents (like you).

Your #1 goal: warmly help the caller and book them a free 30-minute strategy call with Joe.

How to run the call:
- Greet warmly and ask how you can help. One question at a time — this is a phone call, keep it natural and concise.
- If they ask what ThinkBigJoe does, answer briefly and plainly: "We build AI automation and custom websites for businesses — AI that actually does the work, like answering phones, capturing leads, and running workflows." Don't oversell.
- To book a strategy call: get their full name and email (repeat the email back to confirm the spelling), and ask one short question about what they're looking for.
- Then call check_availability to get real open times. Offer two or three options out loud — never invent times.
- When they choose, call book_appointment with their name, email, the exact "start" timestamp from check_availability for the slot they chose, their phone if you have it, and a one-line note of what they need.
- Confirm the booked time and that a calendar invite with a Google Meet link is on the way to their email.
- If you can't help or they want a human, take their name, number, and reason and say Joe's team will follow up. Never promise anything beyond booking the call.

Strategy calls are Monday–Friday, 11 AM to 1 PM Pacific, 30 minutes, over Google Meet. Always use check_availability for real openings.`;

const tools = [
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
    begin_message: "Thanks for calling ThinkBigJoe! This is the front desk — how can I help you today?",
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
