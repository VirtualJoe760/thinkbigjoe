#!/usr/bin/env node
// Apply the current receptionist config (scripts/retell/agent-config.mjs) to the LIVE Retell
// agent — WITHOUT creating a duplicate. Updates the agent's Retell LLM in place: general_prompt,
// begin_message, and general_tools. Use this whenever the prompt or tools change.
//
//   node scripts/retell/update-tbj-agent.mjs            # find the agent by name, update it
//   node scripts/retell/update-tbj-agent.mjs --dry      # show what would change, send nothing
//   node scripts/retell/update-tbj-agent.mjs --llm llm_xxx   # target a specific LLM id
//
// Reads RETELL_API_KEY + RETELL_WEBHOOK_SECRET from .env.local. See docs/VOICE.md.
import { readFileSync } from "node:fs";

import { generalPrompt, beginMessage, buildTools } from "./agent-config.mjs";

const API = "https://api.retellai.com";
const BASE_URL = process.env.VOICE_WEBHOOK_BASE || "https://thinkbigjoe.com";
const AGENT_NAME = "ThinkBigJoe Receptionist";

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

async function main() {
  const dry = process.argv.includes("--dry");
  const llmFlagIdx = process.argv.indexOf("--llm");
  let llmId = llmFlagIdx >= 0 ? process.argv[llmFlagIdx + 1] : null;
  let agentName = AGENT_NAME;

  if (!llmId) {
    const agents = await retell("/list-agents", null, "GET");
    const arr = Array.isArray(agents) ? agents : agents?.agents || [];
    const agent = arr.find((a) => a.agent_name === AGENT_NAME)
      || arr.find((a) => /thinkbigjoe|receptionist/i.test(a.agent_name || ""));
    if (!agent) { console.error(`no agent named "${AGENT_NAME}" found. Agents: ${arr.map((a) => a.agent_name).join(", ")}`); process.exit(1); }
    llmId = agent.response_engine?.llm_id;
    agentName = agent.agent_name;
    if (!llmId) { console.error(`agent "${agentName}" isn't backed by a Retell LLM (engine: ${JSON.stringify(agent.response_engine)}) — can't update a conversation-flow this way.`); process.exit(1); }
    console.log(`target: ${agentName}  (agent_id ${agent.agent_id}, llm_id ${llmId})`);
  } else {
    console.log(`target llm_id: ${llmId}`);
  }

  const transferTo = env("CALLBACK_TRANSFER_TO") || "+17602976966";
  const authHeader = { Authorization: `Bearer ${WEBHOOK_SECRET}` };
  const tools = buildTools(BASE_URL, authHeader, transferTo);
  const payload = { general_prompt: generalPrompt, begin_message: beginMessage, general_tools: tools };

  console.log(`\nwill set:\n  • general_prompt  (${generalPrompt.length} chars)\n  • begin_message   "${beginMessage.slice(0, 60)}…"\n  • general_tools   [${tools.map((t) => t.name).join(", ")}]  (webhooks → ${BASE_URL})`);

  if (dry) { console.log("\n--dry: nothing sent."); return; }

  console.log("\nupdating Retell LLM…");
  const updated = await retell(`/update-retell-llm/${llmId}`, payload, "PATCH");
  console.log(`✓ updated llm ${updated.llm_id || llmId}. Test it via a web call in the Retell dashboard (Agents → ${agentName} → Test).`);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
