# Documentation index

This is the reference index `AGENTS.md`/`CLAUDE.md` points to. Every doc here should be kept
current — if you change behavior that one of these describes, update the doc **in the same
change**, not as a follow-up. A doc that silently drifts from reality is worse than no doc: see
`FORGE.md`'s incident writeup and `VENUS_UI_MAPPING.md`'s own history for what happens when this
slips.

## Ecosystem map — three codebases, one Neon database

There are **three separate codebases** plus a set of external services. Neon Postgres is the
connective tissue — every system reads/writes the same `forge_sites` (and related) tables, so the
database *is* the shared state, even though the code lives in three different places on two
different machines.

```
 ┌─────────────────────────────┐        ┌──────────────────────────────┐
 │  OpenClaw agent org          │        │  the forge                    │
 │  (Joe's Mac, gateway proc)   │        │  ~/code/webdev-templates       │
 │                               │        │  (separate repo, this repo's  │
 │  Venus + prospector +         │        │   sibling on Joe's Mac)        │
 │  outreach + marketing-manager │        │                                │
 │  → MCP tools (this repo's     │        │  claude -p builds + deploys    │
 │    mcp-server/tbj-mcp.mjs)    │        │  sites from a template         │
 │  → finds/enriches/drafts      │        │  library onto Vercel           │
 └───────────────┬───────────────┘        └────────────────┬───────────────┘
                 │  writes forge_sites                       │  writes forge_sites
                 │  (discovered, contact info,                │  (built, live_url,
                 │   call-prep, outreach drafts)               │   build_status)
                 └───────────────────┬────────────────────────┘
                                     ▼
                     ┌───────────────────────────────┐
                     │   Neon Postgres (shared DB)     │
                     └───────────────┬─────────────────┘
                                     ▼
                     ┌───────────────────────────────┐
                     │   THIS REPO — thinkbigjoe app    │
                     │   (Vercel + Next.js)              │
                     │                                    │
                     │   /command/**  — Joe's control room │
                     │   /portal/**   — the site owner's    │
                     │                  claimed-site portal  │
                     │   /api/**      — webhooks + forge      │
                     │                  register + Stripe/     │
                     │                  Retell/voice endpoints  │
                     └───────────────────────────────────┘
```

**Where does a given change belong?**

| You want to… | Edit… |
|---|---|
| Change what an agent says/does, its personality, its autonomy rules | OpenClaw persona files (`~/.openclaw/agents/<id>/*.md`, or Venus's `~/.openclaw/workspace/`) — see [OPENCLAW.md](OPENCLAW.md). **Not this repo.** |
| Add/change a scheduled agent job (what it runs, when, which tools) | `src/lib/venus-crons.mjs` in **this repo**, then `npm run venus:sync` — the manifest is version-controlled here even though the agents themselves live on the Mac. |
| Add a new thing an agent can read/write in the database | `mcp-server/tbj-mcp.mjs` in **this repo** (the MCP tool), registered in both handlers, calling `audit()`. |
| Change what a generated site LOOKS like (a template, a shared component, the hero, a section) | `~/code/webdev-templates` — **a different repo**, cloned separately on Joe's Mac. See [FORGE.md](FORGE.md). |
| Change how sites get *picked/queued/built* (the forge pipeline itself, cost safety, the queue) | Also `~/code/webdev-templates` (`factory/*.sh`, `factory/*.mjs`) — but the **triggering** side (approve/revise/rebuild buttons, the `job_requests` queue, the Lead Engine) is **this repo**. |
| Change anything Joe sees/clicks in the command center, or anything a claimed-site owner sees in their portal | **This repo** (`src/app/(frontend)/command/**`, `src/app/(frontend)/portal/**`). |
| Add a new external integration (Stripe, Retell, Apify, Google Calendar) | Almost always **this repo** (`src/lib/*.ts`, `src/app/api/**`) — external services are called from the Vercel app, not from OpenClaw or the forge directly. |

**The one thing to never forget:** because the forge and the OpenClaw agents run on **Joe's Mac**,
not Vercel, a change to `mcp-server/tbj-mcp.mjs` or `venus-crons.mjs` in this repo only takes
effect once deployed (MCP: automatically, it's stdio-spawned fresh per session — no restart
needed; crons: after `npm run venus:sync`). A change to the forge itself (`webdev-templates`)
never touches this repo's deploy at all — it's a fully separate push/deploy cycle on a fully
separate machine and Vercel project(s) (one `tbj-<slug>` project per generated site, distinct
from this app's own Vercel project).

---

## Doc list

| Doc | Read this when… |
|---|---|
| [`AGENTS.md`](../AGENTS.md) *(repo root)* | Always — the entry point. Points here, states the full-stack shipping rule, and the docs-freshness protocol. |
| [`OPENCLAW.md`](OPENCLAW.md) | You're touching an agent's behavior/personality, adding or editing a cron, debugging why an agent "isn't doing anything," or need to know which model an agent should run on. |
| [`FORGE.md`](FORGE.md) | You're touching site-building: a template, the queue/poller, deploy behavior, or anything that could trigger a `claude -p` build. **Read before any bulk `forge_sites` status change.** Includes the architecture map + exact env-var wiring between this repo and the forge repo. |
| [`VENUS_UI_MAPPING.md`](VENUS_UI_MAPPING.md) | You're building or changing a `/command/**` or `/portal/**` surface, and need to know which MCP tool/cron/engine is supposed to feed it (or vice versa — a UI surface exists and you need to find its data source). |
| [`ACQUISITION_SYSTEM.md`](ACQUISITION_SYSTEM.md) | You need the original multi-agent client-acquisition gameplan for context. **Partly aspirational** — it says so at the top; treat anything not corroborated by the docs above as not-yet-built, not as current behavior. |

## Keeping this current

Docs rot the moment behavior changes and the doc doesn't. The rule (also stated in `AGENTS.md`):
**when a change makes something in one of these docs inaccurate, fix the doc in the same PR.**
Common triggers to watch for:
- Added/removed a `/command/**` or `/portal/**` route or nav tab → `VENUS_UI_MAPPING.md`.
- Added/edited/removed a Venus cron, an MCP tool, or the agent roster → `OPENCLAW.md` and/or
  `VENUS_UI_MAPPING.md`.
- Changed the forge's lifecycle, queue behavior, template library, or anything cost-related →
  `FORGE.md`.
- Added a new doc → add it to the table above.

If you're not sure a doc is still accurate, the fastest check is to grep the actual code/config
for the specific claim (file paths, env var names, table/column names) rather than trust the doc's
prose — the docs above call this out explicitly where it's mattered before.
