# MCP tools — how Claude, OpenClaw, and the app actually connect

`mcp-server/tbj-mcp.mjs` is a single MCP (Model Context Protocol) server: one Node process, one
file, that exposes named tools (`add_forge_prospect`, `enrich_forge_contact`,
`save_forge_outreach_draft`, etc.) which read/write the Neon database. **Only one thing calls it
at runtime: OpenClaw's agents.** This doc exists because "Claude / OpenClaw / the app / MCP" is
four names for pieces that are easy to conflate — here's exactly how they relate.

---

## The wiring, concretely

```
~/.openclaw/openclaw.json                 ← OpenClaw's config, on Joe's Mac
  "servers": { "tbj": {
      "command": "/usr/local/bin/node",
      "args": ["/Users/macdaddyjoe/code/thinkbigjoe/mcp-server/tbj-mcp.mjs"],
      "env": { "DATABASE_URL": "postgresql://…neon…" }   ← hardcoded HERE, not read from
  }}                                                          this repo's .env.local — see below

        │  OpenClaw spawns tbj-mcp.mjs fresh, per agent session, over stdio
        ▼
  An OpenClaw agent (Venus / prospector / outreach / marketing-manager)
  calls a tool by name, e.g. add_forge_prospect({ business_name, niche, … })

        │  tbj-mcp.mjs's CallTool handler runs the matching SQL against Neon
        ▼
  Neon Postgres (forge_sites, prospects, outreach, activity_log, …)

        │  the SAME database, read by this app's own Drizzle queries
        ▼
  This app (Vercel/Next.js) renders /command/** and /portal/**
```

**tbj-mcp.mjs lives in this repo's source tree** (`mcp-server/`) so it's version-controlled
alongside the schema and UI it serves — but it is **not part of the Next.js app**. It's a
standalone Node package (`mcp-server/package.json`, not a pnpm/npm workspace member, no
`import` from `src/`) that only OpenClaw ever executes, and only on Joe's Mac.

## Where each piece's job stops

- **Claude Code (me, in a session like this one)** — I **author and maintain** `tbj-mcp.mjs`'s
  source. I do **not** call its tools at runtime: this repo has no `.mcp.json` wiring a Claude
  Code session to it. If you ask me to "check the prospect queue," I read the database directly
  (or the code) — I'm not invoking `list_forge_queue` the way an agent would. Don't assume a
  Claude Code session is "using the MCP tools" — it's building/fixing the thing that does.
- **OpenClaw agents (Venus, `prospector`, `outreach`, `marketing-manager`)** — the actual,
  only runtime callers. Each cron in `src/lib/venus-crons.mjs` names which tools an agent may
  call for that run; OpenClaw resolves those names against `tbj-mcp.mjs`'s `ListTools` output.
  See [OPENCLAW.md](OPENCLAW.md) for the agent/cron mechanics.
- **This app (Vercel/Next.js)** — talks to the **same Neon database** directly via Drizzle
  (`src/db/*`), completely independent of MCP. It never calls `tbj-mcp.mjs`. Server actions
  (Joe clicking Approve, Approve-for-marketing, etc.) and MCP tool calls (an agent's writes) are
  **two separate write-paths into the same tables** — the schema is the shared contract between
  them, not shared code. This is exactly why "ship full-stack" (AGENTS.md) matters: a new MCP
  tool and the UI that reads its output must agree on column names/types with nothing to check
  that for you at compile time.

## The duplicated `DATABASE_URL` — a real gotcha, not a bug (yet)

`openclaw.json`'s `servers.tbj.env.DATABASE_URL` is a **separate, hardcoded copy** of the Neon
connection string — it is not read from `~/code/thinkbigjoe/.env.local` the way, say,
`forge-poll.mjs` reads it (see [FORGE.md](FORGE.md)'s connection table). If the Neon connection
string ever rotates, **this is a second place that needs updating** or every OpenClaw agent
silently loses DB access while everything else keeps working. There's no automated sync between
the two right now — check `openclaw.json` by hand after any Neon credential rotation.

## What the tools actually cover

Grouped by what they touch (see [VENUS_UI_MAPPING.md](VENUS_UI_MAPPING.md) for the full
tool-by-tool → UI-surface map):
- **Prospecting**: `add_forge_prospect`, `list_forge_queue`, `list_forge_blacklist`
- **Contact + call-prep enrichment**: `list_forge_needs_contact`, `enrich_forge_contact`,
  `list_forge_needs_callprep`, `save_forge_callprep`
- **Outreach**: `list_forge_outreach_queue` (gated on `marketing_approved_at` — see
  [FORGE.md](FORGE.md)'s lifecycle), `save_forge_outreach_draft`, `mark_forge_outreach_sent`,
  `list_forge_followup_due`
- **Monitoring / spend**: `forge_digest` (v2.18.0) — the forge ops snapshot: master +
  per-capability switches, weekly RUN-budget used vs remaining (75/90% warnings), build + edit
  queue depth, 24h/7d throughput. Fetches `GET /api/forge/digest` (`getForgeDigest` — the same
  source the Engine cockpit + Overview render), so ask it anytime for "where are we at with the
  forge, usage, and spend?" `forge_funnel_stats` covers the sell-first funnel counts.
- **Every state-changing tool in every group calls `audit(...)`** — the mechanism behind
  `/command/jobs`'s "verified" rows. See VENUS_UI_MAPPING.md's Audit log section.

## Adding a new tool

Same rule as everywhere else in this project (AGENTS.md's full-stack rule, specialized): a new
tool must be registered in **both** `ListTools` and `CallTool` in `tbj-mcp.mjs`, bump
`SERVER_VERSION`, call `audit()` if it writes, and be named in the cron(s) that should use it in
`venus-crons.mjs` — then `npm run venus:sync`. No restart needed on the OpenClaw side: it's
stdio-spawned fresh per agent session, so the next run picks up the new version automatically.
