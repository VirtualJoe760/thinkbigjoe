---
name: create-team
description: Create a team of OpenClaw agents that collaborate on a job — a manager agent plus worker agents, with a defined pipeline (handoffs + review/test gates). Use when Joe wants a crew (e.g. a dev team — backend, frontend, PM/review, QA). Defines the team, then runs /create-agent for each member one at a time, each pre-loaded with its slot. Do NOT use for the thinkbigjoe Next.js app/UI, or for a single agent (use /create-agent).
argument-hint: <team-name> <goal>
---

# Create a team of OpenClaw agents

A team is a **solution to a job too big for one agent.** It has a goal, a **manager**, worker
agents, a **pipeline** (who hands to whom, who reviews, who tests), and a **human gate**.

## The hierarchy
**Joe → Venus → team manager → workers.**
- **Venus** — top operating agent over all teams; the manager reports up to her.
- **Manager** (per team) — talks to the team's agents *and* to Venus. Plans, sequences, routes
  handoffs, runs the review gates / decides, and surfaces blockers + decisions to Joe. **Does not do
  the worker tasks itself.** (Can be a dedicated manager agent, or a designated member.)
- **Workers** — each owns one job and hands off per the pipeline.
- **Human gate** — Joe approves at the single riskiest step (e.g. merge/ship).

## Invocation
`/create-team <name> <goal>` — e.g. `/create-team devteam "ship features end to end"`.
First token = team name; the rest = goal.

## Process

### 1. Define the team (small intake)
Run [`questionnaire.md`](questionnaire.md): the **manager**, the **roster** (members + one-line
roles), the **pipeline** (handoffs + review + test + where Joe approves), whether to **create all
members now**, and any **shared context** the whole team must know.

### 2. Write TEAM.md (source of truth)
Goal · manager · roster table · the pipeline (ordered steps + handoff contracts) · the human gate ·
the link up to Venus. This is the team's blueprint; each member's files derive their handoffs from it.

### 3. Build the members — one at a time, via /create-agent
Order: **manager first** (so it knows its team), then workers in pipeline order. Each `/create-agent`
run is **pre-loaded with that member's slot** — receives‑from / hands‑to / reviewed‑by / manager — so
its `AGENTS.md` carries a short **"Team & handoffs"** block. Research each role as usual.

### 4. Keep the team cold
All members' crons disabled, autonomy at draft, until Joe brings them online — one at a time.

## Craft + pitfalls (from the research)
- **One-sentence role per member; no overlap.** If you can't describe it in a sentence, it's over-scoped.
- **Explicit handoff contracts** — each member receives a defined input and produces a defined output.
  Vague handoffs are the #1 cause of cascade failures.
- **Hard exit conditions on review loops** (e.g. manager↔dev "fix → re-review"): cap iterations / set a
  pass bar, or it burns budget without converging.
- **Keep teams small (2–4).** Reliability compounds downward (5 agents × 95% ≈ 77%); lean on the
  review gates and the human gate.
- **Define the pipeline first — the workflow controls the agents, not the other way around.**

## Example (Joe's dev team)
Goal: ship features. Manager: Mark (PM). Pipeline: **Jack (backend) → Sam (frontend) → Mark (code
review) → Katie (QA: screenshots + uses the site) → Joe approves/ships.** Venus oversees the team
through Mark.
