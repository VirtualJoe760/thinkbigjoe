# OpenClaw — how Venus and the agent org actually work

OpenClaw is the self-hosted agent runtime on **Joe's Mac** (not Vercel, not this repo's
deploy target). It runs a **gateway** process that hosts a roster of named agents, each with
its own persona files, its own scheduled crons, and its own model. This doc is the field guide —
read it before touching an agent, a cron, or the gateway.

**Need the step-by-step how-to** (update an agent, give it a tool, add a new one, the restart +
cron gotchas, scaling to per-client agents)? See the **[Agent playbook](AGENT_PLAYBOOK.md)** — this
doc is the *concepts*, the playbook is the *procedures*.

---

## The roster (role-named, not human-named)

> ### ⏸ FLEET NARROWED TO THREE — 2026-08-28 (Joe)
> **Only `whitney`, `edward`, and `main` (Venus) operate.** Prospecting, brand, marketing, outreach,
> research, and `tom` are **stood down**: their crons are disabled and their `agents` rows are
> `enabled=false, status='off', paused=true` (those three columns survive
> `sync-openclaw-agents.mjs`, which only overwrites name/role/org/model/workspace/archived).
> Registration and persona files are **untouched** — this is reversible: re-enable the cron in
> `venus-crons.mjs`, re-run `npm run venus:sync`, and flip the row back.
>
> Exactly three crons are enabled: `TBJ Whitney — Job Applications`, `TBJ Edward — Inbox Sweep`,
> `TBJ Venus — Org Debrief`. Anything else showing as enabled is drift.
>
> ⚠️ **This did not free any Ollama quota.** The stood-down agents were either on `claude-cli`
> (dead anyway — see below) or on ollama-cloud *with no cron*, so they were spending nothing.
> The only ollama consumers are Whitney and Venus, and both are being kept.


Agents are named for **what they do**, with one exception:

| id | role | notes |
|---|---|---|
| `main` | **Venus** | The orchestrator Joe talks to directly. **Keep the name "Venus"** — it's a wake-word Joe texts ("Hey Venus…") and she has a persona built around it. Her files live at `~/.openclaw/workspace/` (NOT `~/.openclaw/agents/main/` — main is special-cased). |
| `marketing-manager` | digest | Reads pipeline + team activity, rolls it up to Venus. Doesn't do the work itself. |
| `prospector` | find + enrich | Finds local businesses needing a website (`add_forge_prospect`), and now also does contact enrichment + call-prep research (`enrich_forge_contact`, `save_forge_callprep`) — see [FORGE.md](FORGE.md). |
| `outreach` | draft | Drafts the "we built you a site" first-touch and follow-up emails. Never sends — Joe approves & sends. |
| `researcher` | solo | Studies how other AI agents make money, for agency positioning. Not part of the marketing pipeline. |
| `whitney` | apply | **Joe's personal job-application agent** (📮), not part of the marketing pipeline. Priority-queue worker: applies to jobs Joe approved (creates the account, verifies it via `inbox_search` on joe@thinkbigjoe.com, tailors + submits), and *fills* by finding new roles. Human gate + live pipeline at **`/command/applications`**, which also has a **Pause/Resume control** (writes `agents.paused`; her `list_approved_jobs`/`record_found_job` tools stand down when paused — survives roster sync). **LIVE** — her cron in `venus-crons.mjs` is `enabled:true` (`*/15 * * * *`), and her apply-gate (target profile, `RESUME_PATH`, `LINKEDIN_URL`, `JOB_SIGNUP_PASSWORD`) is set. **When she's blocked she escalates, never guesses**: `record_question` posts to the board *and* pings Joe's Telegram on the spot (her cron itself has no delivery channel — the ping rides the MCP tool). Joe answers, **or clicks Decline to answer** — a decline cancels that application (`job_applications.status='closed'`) and frees her to move on, which she reads back via `list_answered_questions`. Tools: `record_found_job`, `list_approved_jobs`, `update_application_status`, `inbox_search`, `book_appointment`, `record_question`, `list_answered_questions`, `mark_question_resolved`, `remember_fact`. |

| `edward` | inbox | **Joe's email manager** (📬) for joe@thinkbigjoe.com (Zoho IMAP/SMTP — never drives Apple Mail; drafts/moves sync there on their own). Sweeps 3×/day (5:45a/11:45a/5:45p Phoenix): classifies (employer/investor/client vs newsletter/promo/spam), junks spam (→ Spam folder, never deletes), drafts replies in Joe's voice, and queues sends in `email_outbox`. **Venus is his approval gate** — `email_approve_send`/`email_reject_send`; nothing sends without her. She reads his filed report (`get_inbox_report`) and briefs Joe on **Telegram** at 6/12/6. Other agents email *through* him (Venus relays, e.g. Whitney's applications). Queue + activity at **`/command/inbox`**; scheduled sends fire via `scripts/email-outbox-drain.mjs` (launchd, ships cold). **Cold** — both crons in `venus-crons.mjs` are `enabled:false`. Tools: `inbox_sweep`, `email_create_draft`, `email_move_spam`, `email_request_send`, `email_list_pending_sends`, `log_activity`. |

Every worker's persona is 5 files at `~/.openclaw/agents/<id>/`:
`IDENTITY.md` (the card — name/vibe/emoji) · `SOUL.md` (character, no rules) · `USER.md`
(who it serves — Joe + the business) · `AGENTS.md` (the SOP — owns/hands-off/tools/autonomy/workflow)
· `TOOLS.md` (environment notes — tool names, quirks, paths).

**Renaming an agent** has no native command — write new persona files under a new id, delete the
old one (`openclaw agents delete <oldid> --force`), the display name always comes from `IDENTITY.md`
at list time. Use the `/create-agent` and `/edit-agent` skills for this — they encode the research-first
process (job profile → per-file plan → build) rather than hand-editing files from scratch.

---

## Organizations — who an agent works for

Every agent belongs to an **organization** (`organizations` table; TBJ = org #1, slug
`thinkbigjoe`). `agents.org_id` + `forge_sites.org_id` carry the linkage; future customer orgs
(e.g. a roofing company buying its own agents) get their own org row, their agents live in the
same OpenClaw install, and their dashboard shows only their org's roster. The DB `agents` table
is the **display mirror** of the live roster — `node scripts/sync-openclaw-agents.mjs` upserts
`~/.openclaw/openclaw.json` → `agents` (model, workspace) and archives rows that left the
roster (never deletes; activity history stays joinable). Re-run it after any roster/model change.

## The gateway

A LaunchAgent-managed process on Joe's Mac. If crons stop firing or `/command/crons` shows every
"last ran" as stale, **the gateway is down** — that's the first thing to check, before touching
any code. Restart after a `openclaw config set` model/agent change:
```
openclaw gateway restart
```

**⚠️ In-app "Update now" is what broke it on 2026-07-24**: the control UI's updater pulled
2026.7.1-2, which requires Node ≥24.15 (Mac has 24.13) — half-applied swap, gateway dead. Pinned
back with `npm install -g openclaw@2026.6.10`. Don't click Update until Node is upgraded.

**The agent bridge (dashboard chat).** The web app can't reach 127.0.0.1:18789, so `/portal/agents`
chat queues rows in `agent_messages`; `scripts/agent-bridge.mjs` (launchd
`com.thinkbigjoe.agentbridge`, every 60s, pidfile-guarded) delivers each with
`openclaw agent --agent <id> -m <text> --json` and writes the reply back. Log: /tmp/tbj-agent-bridge.log.

---

## Model routing — read this before assuming an agent is "broken"

Two providers are in play, and mixing them up wastes a debugging session:

- **`claude-cli/<model>`** — rides **Joe's existing Claude Max subscription login** (macOS Keychain,
  zero extra setup). This is what `prospector`, `marketing-manager`, and `outreach` run on
  (`claude-cli/claude-sonnet-4-6` as of this writing — sonnet, not opus, to protect budget).
- **`ollama-cloud/glm-5.2`** — the free-tier model. **No longer used by any operating agent.**
  `researcher`/`incubator`/`angel-scout`/`nc-social` still point at it but are stood down.
  > ⚠️ **It has a WEEKLY usage limit, and the gateway hides which one.** OpenClaw surfaces only
  > `FailoverError: ⚠️ API rate limit reached`. POST `https://ollama.com/v1/chat/completions` with
  > `OLLAMA_API_KEY` from `.env.local` to see the real message — on 2026-08-28 it returned HTTP 429
  > *"you (josephsardella) have reached your **weekly** usage limit"*. Weekly, not daily: waiting a
  > day does nothing, and no reset headers are returned. Top-up: https://ollama.com/settings.
  > What burned it: Whitney's old `*/15` 24/7 cron — 96 wakes/day of which ~70% only logged
  > "board full, standing down". **A stand-down still costs a full model call.**

- **2026-08-29 — Whitney, Edward and Venus all moved to `claude-cli/claude-sonnet-4-6`** (Joe's
  call, to get off the exhausted Ollama tier and onto one backend). Confirm a model switch actually
  took effect by the ERROR CHANGING, not by the config: the startup log's `agent model:` line is the
  global default, not the per-agent model. An ollama agent fails with "rate limit reached"; a
  claude-cli one fails with "OAuth session expired" — that swap is the proof.
  ⚠️ **They now draw the shared Max weekly cap** — same pool as interactive Claude Code and the
  forge's `claude -p` builds. Whitney at ~34 runs/day is ~238 agent turns/week against it.
  **`glm-4.7` was RETIRED by Ollama Cloud on 2026-07-15** (the API 410s) — if an ollama agent errors
  with `FailoverError: 410 … retired`, bump its model to a live one (`openclaw config set` +
  gateway restart, then `node scripts/sync-openclaw-agents.mjs`). Historical glm-4.7 gotchas
  (browser targetId errors, intermittent `UND_ERR_SOCKET`) — re-test before giving any glm agent
  browser-driving work.
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

## Budget — two independent controls, and why both exist

Since all three operating agents moved to `claude-cli/claude-sonnet-4-6` (2026-08-29) they draw the
**shared Max weekly cap** — the same pool as Joe's interactive Claude Code and the forge's
`claude -p` builds. An agent overspending doesn't just cost money; it takes Joe's own tooling away
from him. Two separate controls, because neither is sufficient alone:

**1. Cadence — how often they WAKE** (`venus-crons.mjs`). Cut 67% on 2026-08-29:

| Agent | Schedule | Turns/week |
|---|---|---|
| `whitney` | `0 7-19 * * 1-5` Phoenix — hourly, 7am–7pm, **weekdays only** | 238 → **65** |
| `edward` | `45 6,15 * * *` — 2×/day, all 7 days | 21 → **14** |
| `main` (Venus) | `30 12,18 * * *` — 2×/day | 21 → **14** |
| | | **280 → 93** |

Two cuts were nearly free. Whitney's **weekends**: an application submitted Saturday sits in a queue
until Monday, so those runs cost full price for nothing. And Venus's **6:30am** debrief: Whitney no
longer works overnight, so it was paying to report that nothing had happened.

**2. Daily caps — how much they can SPEND once awake** (`tbj-mcp.mjs`, enforced server-side at each
agent's loop entry, NOT left to the prompt). Cadence is not a cap: one pathological day of long
turns can still burn a week of quota.

- `DAILY_TURN_CAP = { whitney: 15, edward: 4, main: 4 }` — a **backstop**, deliberately set above
  the cadence ceiling (13/2/2) so it only fires on runaway or heavy manual triggering.
- `DAILY_APPLY_CAP = 5` — Whitney's real-world ceiling. This one is a **business** limit, not a cost
  one: more than ~5 applications/day reads as automated and is what gets Joe's job-board accounts
  flagged.

Turn counts come from `activity_log` (Phoenix day boundary), which slightly **undercounts** — a turn
that dies before logging isn't seen. That's why the caps sit above the cadence rather than at it.
The check is **fail-open**: a counting error must never wedge an agent.

⚠️ **Remember the structural cost that made this necessary:** a *stand-down is still a full model
call*. In a 24h sample Whitney logged 96 runs of which ~69 did nothing but say "board full,
standing down" — that alone exhausted an entire weekly tier. Cheap-out gates belong **before** the
wake (schedule, or a command-payload pre-check), not inside the turn. The gates below are damage
control, not the real fix.

---

## Cron delivery — why a cron "runs fine" and Joe still hears nothing

Getting a scheduled message to actually reach Joe's Telegram has **four** independent traps.
All three were hit live on 2026-08-27 building the Job Hunt Debrief; `cron list` reported
healthy-looking rows the whole time. Check this section before debugging an agent.

**1. An agentless cron on Venus's main session never runs a turn.**
A manifest entry with no `agent:` makes `sync-venus-crons.mjs` emit `--system-event`, which
targets Venus's `main` session. That cron is accepted, appears in `cron list`, and reports
`ok` — but `openclaw cron get <id>` shows `lastRunAt: null` after a manual `cron run`, and no
activity is produced. **Set `agent: "main"`** to get a real agent turn as Venus.

**2. A main cron cannot be edit-converted — it must be deleted and re-added.**
Changing an existing agentless cron to `agent: "main"` fails with
`invalid cron.update params: main cron jobs require payload.kind="systemEvent"`.
The sync script only passes payload args on ADD, so: `openclaw cron delete <id>`, drop the stale
`id:` from the manifest, re-run `npm run venus:sync`, paste the new id back.

**3. `--announce` needs an EXPLICIT channel — the default fail-closes on this machine.**
`deliveryArgs()` only passes `--channel` when the manifest entry sets `channel`. Without it the
CLI default is `--channel last`, which errors here because **both discord and telegram are
configured**: `Channel is required when multiple channels are configured: discord, telegram`.
In `cron list` this reads `announce -> last (last -> no route, will fail-closed: Channel...)`.
Always set both `channel: "telegram"` and `to: "<chat id>"`.

> ⚠️ **Other crons are currently in this state.** As of 2026-08-27, `TBJ Whitney — Job
> Applications` and `TBJ Email Inbox` both show `announce -> last (… will fail-closed)`. Whitney's
> is harmless *by design* — she is not supposed to message Joe, and her escalation goes out through
> `record_question`'s own Telegram call instead of the cron route. The others have simply never had
> a working route. (`TBJ Venus — Inbox Update` used to be listed here as broken — agentless *and* with
> a channel, traps #1 + #3 together. It has since been **merged into `TBJ Venus — Org Debrief`**,
> which covers Edward and Whitney in one message and is wired correctly.)

**4. Two different bots write to the same chat id — and only one is the one Joe reads.**
A Telegram chat id identifies the **user**, but every bot has its *own* private conversation with
that user. The same id reached from two tokens lands in two different threads:

| Token | Bot | Used by |
|---|---|---|
| `channels.telegram.botToken` in `openclaw.json` | **@Venus_JPSbot** | Venus + every OpenClaw cron. **This is the thread Joe actually reads.** |
| `TELEGRAM_BOT_TOKEN` in `.env.local` | **@thinkbigjoe_alerts_bot** | `src/lib/telegram.ts` — the Vercel app's own alerts (leads, bookings, voicemail). |

This bit on 2026-08-27: Whitney's escalation ping and Venus's first debrief were sent with the
`.env.local` token, returned `ok=true`, were logged as delivered — and Joe never saw them, because
they were sitting in the alerts-bot thread. **A successful send is not evidence Joe saw it.**

Fixed in tbj-mcp v2.45.0: `telegramCreds()` resolves the bot token from `openclaw.json` first and
falls back to `.env.local` only if OpenClaw has none — so anything an *agent* sends comes from
Venus, with no secret duplicated into `.env.local`. The app's own alerts stay on the alerts bot
deliberately; they're from the app, not from Venus. **If you add a new agent-facing notification,
send it through the MCP server, not through `src/lib/telegram.ts`.**

**The durable workaround:** the Job Hunt Debrief also calls **`send_telegram_update`**, an MCP tool
that posts straight to the Telegram Bot API. Belt and braces — the announce route is configured
*and* Venus sends the text herself, so the message lands even if announce regresses again. Prefer
that pattern for anything Joe must not miss.

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
