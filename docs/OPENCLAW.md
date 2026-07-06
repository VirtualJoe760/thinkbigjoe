# OpenClaw — how Venus and the agent org actually work

OpenClaw is the self-hosted agent runtime on **Joe's Mac** (not Vercel, not this repo's
deploy target). It runs a **gateway** process that hosts a roster of named agents, each with
its own persona files, its own scheduled crons, and its own model. This doc is the field guide —
read it before touching an agent, a cron, or the gateway.

---

## The roster (role-named, not human-named)

Agents are named for **what they do**, with one exception:

| id | role | notes |
|---|---|---|
| `main` | **Venus** | The orchestrator Joe talks to directly. **Keep the name "Venus"** — it's a wake-word Joe texts ("Hey Venus…") and she has a persona built around it. Her files live at `~/.openclaw/workspace/` (NOT `~/.openclaw/agents/main/` — main is special-cased). |
| `marketing-manager` | digest | Reads pipeline + team activity, rolls it up to Venus. Doesn't do the work itself. |
| `prospector` | find + enrich | Finds local businesses needing a website (`add_forge_prospect`), and now also does contact enrichment + call-prep research (`enrich_forge_contact`, `save_forge_callprep`) — see [FORGE.md](FORGE.md). |
| `outreach` | draft | Drafts the "we built you a site" first-touch and follow-up emails. Never sends — Joe approves & sends. |
| `researcher` | solo | Studies how other AI agents make money, for agency positioning. Not part of the marketing pipeline. |

Every worker's persona is 5 files at `~/.openclaw/agents/<id>/`:
`IDENTITY.md` (the card — name/vibe/emoji) · `SOUL.md` (character, no rules) · `USER.md`
(who it serves — Joe + the business) · `AGENTS.md` (the SOP — owns/hands-off/tools/autonomy/workflow)
· `TOOLS.md` (environment notes — tool names, quirks, paths).

**Renaming an agent** has no native command — write new persona files under a new id, delete the
old one (`openclaw agents delete <oldid> --force`), the display name always comes from `IDENTITY.md`
at list time. Use the `/create-agent` and `/edit-agent` skills for this — they encode the research-first
process (job profile → per-file plan → build) rather than hand-editing files from scratch.

---

## The gateway

A LaunchAgent-managed process on Joe's Mac. If crons stop firing or `/command/crons` shows every
"last ran" as stale, **the gateway is down** — that's the first thing to check, before touching
any code. Restart after a `openclaw config set` model/agent change:
```
openclaw gateway restart
```

---

## Model routing — read this before assuming an agent is "broken"

Two providers are in play, and mixing them up wastes a debugging session:

- **`claude-cli/<model>`** — rides **Joe's existing Claude Max subscription login** (macOS Keychain,
  zero extra setup). This is what `prospector`, `marketing-manager`, and `outreach` run on
  (`claude-cli/claude-sonnet-4-6` as of this writing — sonnet, not opus, to protect budget).
- **`ollama-cloud/glm-4.7`** — a separate free-tier model. `researcher` and (historically) all workers
  ran on this. **Known bad**: `glm-4.7`'s browser tool calls error
  (`action targetId must match request targetId`) and it socket-fails intermittently
  (`UND_ERR_SOCKET`). Don't put a browser-driving agent back on glm without re-testing.
- **AVOID `anthropic/*` model strings** — that API key is drained/dead. The bare `opus`/`sonnet`
  aliases also silently resolve to that dead key, not to `claude-cli`. Always spell out
  `claude-cli/claude-sonnet-4-6` explicitly.

Set a worker's model:
```
openclaw config set "agents.list[<i>].model" "claude-cli/claude-sonnet-4-6"
openclaw gateway restart
```

**⚠️ Shared quota with the forge.** Agents on `claude-cli` and the forge's `claude -p` site
builds ([FORGE.md](FORGE.md)) draw from the **same Claude Max weekly cap**. Running both hard at
once can throttle each other. This is the reason a **dedicated Claude subscription for
forge + nanocrew** (separate from Joe's personal one) is worth doing as usage grows — see
FORGE.md's cost section for the subscription-vs-API tradeoff.

---

## Crons-as-code (how Venus's schedule is version-controlled)

Venus's crons are **declared in this repo**, not edited ad-hoc on the Mac:

```
src/lib/venus-crons.mjs   ← SOURCE OF TRUTH (schedule, prompt, tools, agent, uiSurface per cron)
      │
      ├── npm run venus:sync           ── reconciles OpenClaw (add/edit by name)
      ├── npm run venus:sync -- --dry  ── preview only, touches nothing
      │
      └── imported by /command/crons ── dashboard: schedule/tools/prompt/last-run (activity_log)
```

- **Never** hand-edit a running cron with `openclaw cron edit` — that drift is invisible and gets
  silently overwritten by the next sync. Change the manifest, then sync.
- Each entry can set `agent: "<id>"` to run **as that worker** (not a system-event on Venus's
  `main` session). **Gotcha:** a `main`-session cron cannot hold an agent-turn payload
  (`"main cron jobs require payload.kind=systemEvent"`) — converting requires delete + re-add
  with `--agent`, not `cron edit`.
- Delivery: a cron with no configured delivery channel silently no-ops on completion — always set
  `--channel telegram --to <chat-id>` (or equivalent) so a run's outcome actually reaches Joe.

Useful CLI:
```
openclaw cron list                    # schedule + last status + delivery route, per cron
openclaw cron get <id>                # full config incl. the exact prompt
openclaw cron run <id>                # trigger one manually, right now
openclaw agents add/delete <id>       # roster management
```

---

## MCP tools — how agents actually touch the database

Agents don't get raw DB access. They call **named tools** in `mcp-server/tbj-mcp.mjs` (stdio,
auto-picked-up per session — no restart needed for a new tool version, just bump `SERVER_VERSION`).
Every state-changing tool **must** call `audit(action, summary, {...})` as a side effect of its real
write — this is what makes `/command/jobs` a trustworthy audit log independent of whatever an agent
*says* it did in its end-of-run summary. See [VENUS_UI_MAPPING.md](VENUS_UI_MAPPING.md) for the
full tool ↔ UI surface map and the "ship full-stack" rule.

**For the full wiring** (how `openclaw.json` spawns the MCP server, why Claude Code sessions
don't call these tools at runtime, and the duplicated-`DATABASE_URL` gotcha) see
[MCP_TOOLS.md](MCP_TOOLS.md).

---

## Skills that manage the org itself

- **`/create-agent <id> <job>`** — research-first agent creation (mandate/craft/temperament/
  standards/toolchain/failure-modes → per-file plan → build). Never hand-write persona files cold.
- **`/edit-agent <id> [change]`** — same craft, applied to a live agent's existing files.
- **`/create-team <name> <goal>`** — for multi-agent pipelines with a manager + explicit handoffs
  (used historically for the webdev-team, since retired in favor of the forge).

---

## Memory

Claude's own cross-session memory about this project lives OUTSIDE this repo, at
`~/.claude/projects/-Users-macdaddyjoe-code-thinkbigjoe/memory/` (indexed by `MEMORY.md`). That's
where operational trivia (exact agent ids, gotchas fixed, dates things changed) accumulates —
this doc is the stable reference; memory is the changelog. When in doubt about *current* state,
verify against `openclaw cron list` / the live roster rather than trusting a memory note's date.
