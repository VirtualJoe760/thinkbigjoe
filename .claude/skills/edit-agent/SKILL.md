---
name: edit-agent
description: Change or recreate an existing OpenClaw agent. Use when Joe wants to tweak an agent's personality/rules/tools, fix a behavior, refresh it from new research, or rewrite its files (SOUL/IDENTITY/USER/AGENTS/TOOLS). For a brand-new agent use /create-agent; for a team use /create-team. Not for the thinkbigjoe Next.js app.
argument-hint: <name> [what to change]
---

# Edit an OpenClaw agent

Change or recreate an agent that already exists — same craft as `/create-agent`, applied to its live
files. One file at a time, shown for review, nothing saved without Joe's nod.

## Invocation
`/edit-agent <name> [what to change]` — e.g. `/edit-agent venus "make her orchestrate teams"` or
`/edit-agent sam "more opinionated about accessibility"`. First token = agent name/id; the rest =
the change (optional — if omitted, ask what's changing).

## Process

### 1. Load the agent
Read its current files from its workspace — `~/.openclaw/workspace` for **main/Venus**, or
`~/.openclaw/agents/<id>/` (its workspace) for others: SOUL / IDENTITY / USER / AGENTS / TOOLS. Show
Joe the relevant current content so we're editing reality, not memory.

### 2. Scope the change → route it to the right file
Decide what's changing and **which file owns it** (routing test): character/voice → SOUL · a
rule/workflow → AGENTS · who it serves/talks to → USER · name/card → IDENTITY · environment → TOOLS.
Three modes:
- **Tweak** — adjust a specific trait / rule / tool in place.
- **Refresh / recreate** — re-run the job research (as in `/create-agent`) and regenerate the affected
  file(s) so they reflect the sharper/updated understanding.
- **Fix** — the agent misbehaved; route the fix to the right file, add/adjust the *minimal* rule or
  trait, and prune whatever caused the problem.

### 3. Propose, then apply
Show the edited file (full or as a clear before/after), **one file at a time**, for Joe's nod. Keep
the governing principles: one concern per file, **lean — prune stale lines, don't just pile on**,
routing test, SOUL = character not rules. Re-check size with `wc -m` after.

### 4. Make it live
- Files take effect next session (they're injected each session).
- If you changed `openclaw.json` config → `openclaw gateway restart`.
- If the agent is a team manager/member and the change touches handoffs → update the team's `TEAM.md`
  and any teammate whose handoff references it.
- Leave crons/autonomy as they were unless Joe says otherwise.

## Notes
- **Editing ≠ adding.** Prefer sharpening and cutting; stale rules accumulate and cost tokens every session.
- Don't carry our chat's framing into the files — write the agent on its own terms.
- Per-file craft + the Prediction Test live in [`../create-agent/SKILL.md`](../create-agent/SKILL.md).
