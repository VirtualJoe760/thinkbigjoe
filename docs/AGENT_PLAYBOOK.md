# Agent playbook — create, update, and scale the OpenClaw org

The **operational runbook** for the agent org: how to *change* it. For the conceptual overview
(the roster, why role-named, how the gateway/model routing work), see [OPENCLAW.md](OPENCLAW.md).
This doc is the "how do I actually do X" — updating an agent, giving it a tool, adding a new one,
and the gotchas that bite every time.

The agents are **self-hosted on Joe's Mac** via the OpenClaw gateway (a LaunchAgent). The `openclaw`
CLI drives everything; the gateway must be running (`openclaw gateway status`).

---

## Anatomy — where an agent lives

Each worker is a directory of hand-written markdown at `~/.openclaw/agents/<id>/`:

| File | What it is |
|---|---|
| `IDENTITY.md` | Name / theme / who this agent *is* (the roster reads the display name from here). |
| `SOUL.md` | Personality + voice. |
| `USER.md` | Who it works for (Joe) and what he wants. |
| `AGENTS.md` | **How it works — its job, flow, and rules.** This is the agent's brain; the behavior you change most. |
| `TOOLS.md` | **The exact tools it may call, hand-listed.** An agent will not use a tool that isn't written here, even if the MCP server exposes it. |
| `HEARTBEAT.md` | Idle/heartbeat behavior. |

- **Venus (`main`) is special:** her persona lives at `~/.openclaw/workspace/` (NOT `agents/main`),
  and **do not rename her** — "Venus"/"Hey Venus" is a text wake-word.
- **Team blueprint:** `~/.openclaw/teams/<team>/TEAM.md` (e.g. `marketing-team`).
- **Registration:** `~/.openclaw/openclaw.json` — `agents.list`, `mcp.servers`, `cron`.

---

## Golden rule: use the skills, don't hand-hack

Slash-command skills encode the correct process (and the gotchas below). Reach for them first:

- **`/create-agent`** — research a job, then scaffold a new agent (all 5 files).
- **`/edit-agent`** — change an existing agent's rules/tools/persona, or refresh it from new research.
- **`/create-team`** — a crew (a manager + workers with a defined pipeline).

Only drop to raw CLI + file edits when a skill genuinely can't do it.

---

## Update an existing agent (the common case)

1. **`/edit-agent`** on the target agent → it rewrites the files. (Or edit `AGENTS.md` for its
   job/flow and `TOOLS.md` for its tool list directly.)
2. If you changed **which MCP tools** it uses: make sure the tool exists in
   `mcp-server/tbj-mcp.mjs` (both `ListTools` + `CallTool`, version bumped) **and restart the
   gateway** so the MCP server re-spawns with the new code: `openclaw gateway restart`.
3. If you changed a **cron** it runs: update `src/lib/venus-crons.mjs` → `npm run venus:sync`.
4. **Trigger-test:** `openclaw agent --agent <id> -m "do your job once"` and read the transcript.

---

## Give an agent a new tool

1. **Write the tool** in `mcp-server/tbj-mcp.mjs` — a `ListTools` entry **and** a `CallTool` case;
   call `audit()` if it changes state; **bump the server `version`**.
2. **List it in the agent's `TOOLS.md`** — the agent won't call a tool it hasn't been told about.
3. **`openclaw gateway restart`** — the MCP server (`mcp.servers.tbj` in `openclaw.json`) re-spawns;
   agents now see the tool.
4. **Trigger-test** the agent.

> **Gotcha:** the tool being in `tbj-mcp.mjs` is NOT enough. Two more things are required: the
> **gateway restart** (to reload the MCP server) **and** the tool listed in the agent's `TOOLS.md`.
> Skip either and the agent silently never uses it.

---

## Add a brand-new agent

Prefer **`/create-agent`**. Under the hood it does roughly:

```bash
openclaw agents add <id> --workspace ~/.openclaw/agents/<id> \
  --model claude-cli/claude-sonnet-4-6 --non-interactive
# → write IDENTITY/SOUL/USER/AGENTS/TOOLS.md, then:
rm ~/.openclaw/agents/<id>/BOOTSTRAP.md
openclaw gateway restart
```

Then give it: a role (`AGENTS.md`), its tools (`TOOLS.md`), and — if it runs on a schedule — a cron
in `src/lib/venus-crons.mjs` + `npm run venus:sync`. (There is **no native rename**; to rename, add
a new agent and `openclaw agents delete <old> --force`.)

---

## Crons: running a cron AS an agent (the big gotcha)

- Manifest: `src/lib/venus-crons.mjs` (source of truth) → apply with `npm run venus:sync`
  (`-- --dry` to preview). The sync **matches crons by NAME**.
- A cron with an **`agent: "<id>"`** field runs **as that worker** (`--agent <id> --message …`,
  `payload.kind=agentTurn`, top-level `agentId`) instead of a system event on Venus's `main` session.
- **⚠️ GOTCHA:** a cron on Venus's `main` session **cannot be edit-converted** to an agent-turn
  (`"main cron jobs require payload.kind=systemEvent"`). To move a job onto a worker you must
  **delete + re-add** it with `--agent`. The sync script reads `payload.message` for agent crons vs
  `payload.text` for system-event crons — a mismatch shows up as perpetual "drift."

---

## Model routing + the QUOTA rule (the real scaling ceiling)

- Marketing workers (`prospector`, `marketing-manager`, `outreach`) run on
  **`claude-cli/claude-sonnet-4-6`** — it rides Joe's `claude` CLI **Max login** (no API key, no
  OAuth). Set a worker's model with
  `openclaw config set "agents.list[<i>].model" "claude-cli/claude-sonnet-4-6"` + `openclaw gateway restart`.
- **AVOID `anthropic/*` and the bare `opus`/`sonnet` aliases** — they point at a **drained API key**.
  Use the `claude-cli/*` model IDs.
- **⚠️ SHARED WEEKLY CAP — the #1 scaling constraint.** Every `claude-cli` agent draws the **same
  Max weekly limit** as the forge's `claude -p` site builds *and* interactive Claude Code. Adding
  agents or raising their volume spends the same pool. Sonnet is used (not Opus) on the workers to
  stretch it. Before scaling the org (e.g. per-client sales agents), budget this cap or move heavy
  agents to a **dedicated subscription / API billing** — see [FORGE.md](FORGE.md)'s cost model.

---

## Command reference

| Do this | Command |
|---|---|
| Restart the gateway (reload MCP tools / model changes) | `openclaw gateway restart` |
| Is the gateway up? | `openclaw gateway status` · `openclaw health` |
| List the roster | `openclaw agents list` |
| Run one agent turn (trigger-test) | `openclaw agent --agent <id> -m "…"` |
| Add / delete an agent | `openclaw agents add <id> …` · `openclaw agents delete <id> --force` |
| Preview / apply cron changes | `npm run venus:sync -- --dry` · `npm run venus:sync` |
| Inspect scheduled jobs | `openclaw cron list` |
| Diagnose / repair | `openclaw doctor` |

---

## Scaling to per-client sales agents (the future)

When we start selling sales plans to companies, each client likely gets its own worker (or a small
crew via `/create-team`) that runs *their* outreach against *their* slice of the pipeline.

- **Build them with `/create-agent` / `/create-team`** — same file anatomy, same tool-wiring rule.
- **Isolate per-client state** in the DB (the shared `forge_sites` / prospect tables are the state
  every agent reads/writes) — scope queries by client, don't fork the schema per client.
- **Mind the shared weekly cap** (above) — N client agents × their daily volume all draw one pool.
  This is what forces a dedicated subscription (or metered API) once we're past a handful of clients.
- Keep the discipline: **crons in `venus-crons.mjs`, tools in `tbj-mcp.mjs`, personas in
  `~/.openclaw/agents/`** — version-controlled where it can be, so a new client agent is a
  repeatable recipe, not a snowflake.
