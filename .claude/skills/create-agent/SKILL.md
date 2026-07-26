---
name: create-agent
description: Create a new OpenClaw agent as a research-grounded solution to a job. Use when Joe wants to add or define an OpenClaw agent (a specialist like Research / Communication / Meeting strategist, or any role). Flow — Joe fills a tiny intake, you RESEARCH the job, you report findings + how each of the five files (IDENTITY/SOUL/USER/AGENTS/TOOLS) will be written, then on his OK you build them and scaffold the agent. Do NOT use for the thinkbigjoe Next.js app or its UI.
argument-hint: <name> <job>
---

# Create an OpenClaw agent

An agent is a **solution to a job**. So we reverse-engineer it from what world-class performance
at that job looks like — research first, then build. One agent at a time; nothing goes live without
Joe's nod.

## Invocation
`/create-agent <name> <job>` — e.g. `/create-agent communication "relationship-first SDR"` or
`/create-agent frontend "front end developer"`.

Parse `args`: the **first token = the agent's name/id**, **everything after = the job/role**.
- Both present → confirm them in one line, then jump to Phase 1 with name + job pre-filled and ask
  only the *remaining* intake questions.
- Missing/partial → ask for the missing piece, then proceed.
Then run Phases 2–4 (research → report → execute).

## Process

### 1. Small intake — define the job
Name + job come from the command args. Then run the rest of [`questionnaire.md`](questionnaire.md):
the outcome Joe wants, non-negotiables, optional personality lean. Keep it tiny — research does the
rest. (Joe can also answer "just go" and you proceed on the job alone.)

**Team?** Ask if this agent is solo or part of a team. If part of a team, capture its slot —
receives‑from / hands‑to / reviewed‑by / its manager. (When invoked by `/create-team`, this slot is
pre‑loaded from `TEAM.md`.) Every agent coordinates with **Venus** regardless; that's a constant.

### 2. Research the job
Produce a short **job profile** (with sources). Triangulate six angles:
- **Mandate** — what a senior version of this role is responsible for, day to day.
- **Craft & taste** — the opinions/standards that separate great from competent.
- **Temperament of the greats** — how elite practitioners actually think, what they sweat, their pet peeves.
- **Standards & conventions** — the real rules of the domain.
- **Toolchain** — the tools/environment the job runs on.
- **Failure modes / anti-patterns** — exactly how people at this job go wrong.

Hunt hardest for the two highest-value things: **(a) what distinguishes elite from average** (the
expertise / ceiling) and **(b) the failure modes** (the guardrails / floor).

### 3. Report back — findings + the per-file plan
Bring Joe: a brief, sourced summary of what makes this role world-class, **plus a one-paragraph plan
for each of the five files** — what will go in IDENTITY / SOUL / USER / AGENTS / TOOLS, grounded in
the research + his intake. Get his approval/tweaks before writing anything.

### 4. Execute
Build the five files (one at a time, shown for review), each lean and single-concern per the craft
below. Then `openclaw agents add <id>`, place the files in its workspace, `wc -m` to check sizes, and
**keep it cold** — crons disabled, autonomy at draft — until Joe says to turn it on.

---

## How each file gets written (the craft)

**Governing principles (every file):** one concern per file, no duplication; everything is injected
every session so keep each lean (~300 words per persona file; AGENTS the workhorse, < ~150 lines);
high-priority lines near the top; prune stale rules. Routing test for any line:
*who they are* → SOUL · *their name/card* → IDENTITY · *who they serve/talk to* → USER ·
*a rule/workflow* → AGENTS · *an environment fact* → TOOLS.

- **IDENTITY.md** — the card: name, what it is, vibe, emoji, one-line role. Tiny; no behavior logic.
- **SOUL.md** — who they are: first-person character drawn from the *temperament of great
  practitioners* (backstory, voice texture, emotional range, humor, opinions, quirks, negative space).
  No rules. *Bar — Prediction Test:* a reader can predict how it reacts to something it's never seen.
- **USER.md** — who it serves: Joe (how to represent him, voice, timezone) + the business (what we
  sell, offer, mission) + a tight "who we talk to" block (audience/ICP). Frequently-needed only;
  deep/rare facts → MEMORY.md. About the user/world, never the agent.
- **AGENTS.md** — the SOP, drawn from the *mandate + standards + failure modes*: owns / hands off ·
  named tools/channels · autonomy (always / ask first / never) with hard blocks · workflow · quality
  bar · output format. Specific & testable ("would removing this line change behavior? if no, cut it").
  **If the agent is in a team, add a short "Team & handoffs" block** — receives‑from / hands‑to /
  reviewed‑by / manager — derived from the team's `TEAM.md`.
- **TOOLS.md** — environment notes: tools/MCP, channels, logins, caps, paths, quirks. Notes, not
  rules ("always use X" → AGENTS; "X base = …" → TOOLS).

## Organization + dashboard registration (always, after scaffolding)
Every agent belongs to an **organization** — the company it works for (`organizations` table; TBJ =
org #1). After registering the agent with OpenClaw, run
`node ~/code/thinkbigjoe/scripts/sync-openclaw-agents.mjs` to mirror the roster into the `agents`
table so the agent appears on the agent dashboard. New agents default to the TBJ org; an agent built
FOR A CUSTOMER (e.g. a roofing company's own crew) belongs to that customer's org — create/confirm
its `organizations` row and set `agents.org_id` accordingly (extend the sync's mapping if needed).
Consider adding the agent's human-readable role line to the ROLES map in that script.

## Notes
- Keep the intake + job profile with the agent so files can be regenerated/sharpened later.
- Don't carry our chat's framing into the files — write the agent on its own terms.
