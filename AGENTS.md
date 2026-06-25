<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ThinkBigJoe — what this is

Joe Sardella's AI-consulting outreach system. **Venus** (a self-hosted OpenClaw AI on Joe's Mac)
prospects on LinkedIn, drafts replies, and runs follow-up sequences. The Next.js app (Vercel +
Neon Postgres, Drizzle, pnpm) is the **command center** at `/command/**` where Joe reviews and
controls Venus's work. Venus acts through **MCP tools** in `mcp-server/tbj-mcp.mjs` and runs on a
schedule defined in `src/lib/venus-crons.mjs`.

## THE RULE: Venus features ship full-stack, in one PR

Never build a Venus capability as "just UI" or "just backend." Every one is **three layers that
ship together** — miss a layer and it silently fails:

1. **UI surface** — the page/section under `src/app/(frontend)/command/**` where Joe sees/controls it.
2. **MCP tool** — a named tool in `mcp-server/tbj-mcp.mjs` reading/writing the right DB table
   (register it in BOTH the `ListTools` handler AND the `CallTool` switch; bump the server version).
3. **Cron entry** — a declaration in `src/lib/venus-crons.mjs`, then `npm run venus:sync` to push
   it to OpenClaw. Don't `openclaw cron edit` prompts by hand — that drift is invisible and gets
   overwritten on the next sync.

Failure modes if you skip one: UI with no tool → page forever empty · tool with no cron → ability
never used · cron with no UI → work happens with no way to review it.

**Before building or merging a Venus feature, read [`docs/VENUS_UI_MAPPING.md`](docs/VENUS_UI_MAPPING.md)**
— it maps every UI surface to the cron/tool that feeds it and has the full-stack checklist.

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
