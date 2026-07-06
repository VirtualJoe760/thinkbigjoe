<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ThinkBigJoe — what this is

Joe Sardella's AI web-design + automation agency. Two systems work together:

1. **Venus** (a self-hosted OpenClaw agent org on Joe's Mac) prospects, enriches contacts, and
   drafts outreach. She and her workers (`prospector`, `outreach`, `marketing-manager`) act
   through **MCP tools** in `mcp-server/tbj-mcp.mjs` on a schedule in `src/lib/venus-crons.mjs`.
   → **[docs/OPENCLAW.md](docs/OPENCLAW.md)** — roster, model routing, crons-as-code mechanics.
2. **The forge** (`~/code/webdev-templates`, a separate repo) builds and deploys the actual
   marketing sites via `claude -p`, picking from a growing library of distinct templates.
   → **[docs/FORGE.md](docs/FORGE.md)** — lifecycle, template system, queue architecture, and
   **cost-safety rules that exist because this burned real money once (2026-07-06) — read before
   touching anything that queues a build.**

This Next.js app (Vercel + Neon Postgres, Drizzle, pnpm) is the **command center** at
`/command/**` where Joe reviews and controls both systems.
→ **[docs/VENUS_UI_MAPPING.md](docs/VENUS_UI_MAPPING.md)** — every UI surface mapped to the
cron/tool/engine that feeds it, plus the full-stack shipping checklist below.

## The ecosystem — three systems, one Neon database

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
| Change what an agent says/does, its personality, its autonomy rules | OpenClaw persona files (`~/.openclaw/agents/<id>/*.md`, or Venus's `~/.openclaw/workspace/`) — see [OPENCLAW.md](docs/OPENCLAW.md). **Not this repo.** |
| Add/change a scheduled agent job (what it runs, when, which tools) | `src/lib/venus-crons.mjs` in **this repo**, then `npm run venus:sync` — the manifest is version-controlled here even though the agents themselves live on the Mac. |
| Add a new thing an agent can read/write in the database | `mcp-server/tbj-mcp.mjs` in **this repo** (the MCP tool), registered in both handlers, calling `audit()`. |
| Change what a generated site LOOKS like (a template, a shared component, the hero, a section) | `~/code/webdev-templates` — **a different repo**, cloned separately on Joe's Mac. See [FORGE.md](docs/FORGE.md). |
| Change how sites get *picked/queued/built* (the forge pipeline itself, cost safety, the queue) | Also `~/code/webdev-templates` (`factory/*.sh`, `factory/*.mjs`) — but the **triggering** side (approve/revise/rebuild buttons, the `job_requests` queue, the Lead Engine) is **this repo**. |
| Change anything Joe sees/clicks in the command center, or anything a claimed-site owner sees in their portal | **This repo** (`src/app/(frontend)/command/**`, `src/app/(frontend)/portal/**`). |
| Add a new external integration (Stripe, Retell, Apify, Google Calendar) | Almost always **this repo** (`src/lib/*.ts`, `src/app/api/**`) — external services are called from the Vercel app, not from OpenClaw or the forge directly. |

**The one thing to never forget:** because the forge and the OpenClaw agents run on **Joe's Mac**,
not Vercel, a change to `mcp-server/tbj-mcp.mjs` or `venus-crons.mjs` in this repo only takes
effect once deployed (MCP: automatically, it's stdio-spawned fresh per session — no restart
needed; crons: after `npm run venus:sync`). A change to the forge itself
(`webdev-templates`) never touches this repo's deploy at all — it's a fully separate push/deploy
cycle on a fully separate machine and Vercel project(s) (one `tbj-<slug>` project per generated
site, distinct from this app's own Vercel project).

## THE RULE: a feature ships full-stack, in one PR

Never build a capability as "just UI" or "just backend." Every one is **three layers that ship
together** — miss a layer and it silently fails:

1. **UI surface** — the page/section under `src/app/(frontend)/command/**` where Joe sees/controls it.
2. **MCP tool** — a named tool in `mcp-server/tbj-mcp.mjs` reading/writing the right DB table
   (register it in BOTH the `ListTools` handler AND the `CallTool` switch; bump the server version).
3. **Cron entry** — a declaration in `src/lib/venus-crons.mjs`, then `npm run venus:sync` to push
   it to OpenClaw (for agent work) — OR a scheduled script under `scripts/*.mjs` + launchd plist
   (for deterministic, non-cognitive work like the forge poller or the lead-finding engines).
   Don't `openclaw cron edit` prompts by hand — that drift is invisible and gets overwritten on
   the next sync.

Failure modes if you skip one: UI with no tool → page forever empty · tool with no cron → ability
never used · cron with no UI → work happens with no way to review it.

**Before building or merging a feature, read [`docs/VENUS_UI_MAPPING.md`](docs/VENUS_UI_MAPPING.md)**
— it maps every UI surface to the cron/tool that feeds it and has the full-stack checklist.

## Cost safety — the forge spends real money

Anything that queues a `forge_sites` row to `status='approved'` triggers a real `claude -p` build
the moment the poller (if running) picks it up. **Never bulk-approve/re-queue more than a
handful of sites without asking first** — the queue drains one at a time by design (see
FORGE.md), but volume in = volume spent. Check `launchctl list | grep thinkbigjoe` before
assuming any engine/poller is or isn't currently running.

## Crons-as-code

`src/lib/venus-crons.mjs` is the single source of truth for Venus's schedule (each cron's schedule,
exact prompt, tools, and the UI surface it feeds). Edit there → `npm run venus:sync` (use
`-- --dry` to preview). The `/command/crons` tab renders the manifest + last-run from `activity_log`.

## Auditability — every action self-logs

Venus must be verifiable. So **any MCP tool that changes state calls `audit(...)` as a side effect
of its real DB write** (see `mcp-server/tbj-mcp.mjs`) — the log reflects what actually happened, not
what Venus reports. These rows are tagged `metadata.auto = true` ("verified") to distinguish them
from Venus's manual `log_activity` rollups ("reported"). Reviewed at `/command/jobs` (the audit log),
filterable by action and attributed to the cron that ran it.

Rules when you add a Venus capability:
- A new state-changing tool **must** call `audit(action, summary, { prospectId, target, detail })`.
- Anything Venus does on a schedule must be a **declared cron** in the manifest — no ad-hoc,
  untracked agents. If Venus controls a sub-agent, that sub-agent runs on a declared cron too.
- Don't rely on the agent choosing to log — bake logging into the tool so it can't be skipped.

## Working rules
- **Run `pnpm run build` before every push** — it runs `tsc`; a clean build is the merge gate.
- **Never commit secrets or PII**: no `.env*` files, no prospecting CSVs (gitignored under `/prospecting/`).
- Commit at each logical milestone; end commit messages with the `Co-Authored-By:` trailer.
- DB is the source of truth for schema — pull with `npm run db:pull`, don't hand-edit `src/db/schema.ts`.
