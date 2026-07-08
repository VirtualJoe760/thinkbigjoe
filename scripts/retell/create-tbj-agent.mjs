#!/usr/bin/env node
// Create the ThinkBigJoe phone receptionist on Retell (LLM + agent + optional phone number).
// This is also the blueprint for Path A per-client provisioning.
//
//   node scripts/retell/create-tbj-agent.mjs [--number]
//
// Reads RETELL_API_KEY + RETELL_WEBHOOK_SECRET from .env.local. --number tries to buy a phone
// number (needs billing); without it, create the agent and test via a web call in the dashboard.
import { readFileSync } from "node:fs";

import { generalPrompt, beginMessage, buildTools } from "./agent-config.mjs";

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
const tools = buildTools(BASE_URL, authHeader);

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
    begin_message: beginMessage,
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
