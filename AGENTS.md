<!-- BEGIN:nextjs-agent-rules -->
This project runs a customized build of Next.js — some APIs/conventions differ from stock
Next.js. If something framework-level behaves unexpectedly, check `node_modules/next/dist/docs/`
before assuming your training data is right.
<!-- END:nextjs-agent-rules -->

# ThinkBigJoe — what this is

Joe Sardella's AI web-design + automation agency, built from **three codebases sharing one Neon
database**: the OpenClaw agent org (Venus + workers, on Joe's Mac) finds and drafts; **the forge**
(`~/code/webdev-templates`, a sibling repo) builds and deploys the sites; **this repo** (Vercel +
Next.js) is the command center (`/command/**`) and the claimed-site portal (`/portal/**`) that
ties both together.

**→ Start at [`docs/README.md`](docs/README.md)** — the documentation index, the ecosystem map
(which of the 3 codebases owns a given change), and the full doc list. This file is a router, not
a manual — it stays short on purpose; the depth lives in `docs/`.

## THE RULE: a feature ships full-stack, in one PR

Never build a capability as "just UI" or "just backend." Every one is **three layers that ship
together**, or it silently half-fails (UI with no tool → page forever empty · tool with no cron →
never used · cron with no UI → invisible work):

1. **UI surface** — under `src/app/(frontend)/command/**` or `.../portal/**`.
2. **MCP tool** — in `mcp-server/tbj-mcp.mjs` (both `ListTools` + `CallTool`, version bumped,
   calls `audit()` if it changes state).
3. **Schedule** — a cron in `src/lib/venus-crons.mjs` + `npm run venus:sync` (agent work), or a
   script under `scripts/*.mjs` + launchd plist (deterministic work).

Full detail + the shipping checklist: [`docs/VENUS_UI_MAPPING.md`](docs/VENUS_UI_MAPPING.md).
Agent/cron mechanics: [`docs/OPENCLAW.md`](docs/OPENCLAW.md). Forge lifecycle + **cost-safety
rules — read before queuing any site build**: [`docs/FORGE.md`](docs/FORGE.md). Email delivery
standards + the live health board — **read before touching anything that sends email, especially
on behalf of a client**: [`docs/DELIVERABILITY.md`](docs/DELIVERABILITY.md).

## THE OTHER RULE: build the agent, don't *become* the agent

There are three kinds of thing in this org — **actors, models, tools** — and collapsing them is
the single most expensive, most-repeated mistake in this codebase. Keep them straight:

- **Actors = the OpenClaw agents** (Venus + `prospector`, `outreach`, `marketing-manager`,
  `researcher`, `brand-lead`, and any comms agent). They are what **thinks, converses, decides,
  and drives the browser.** Anything that needs judgment or a back-and-forth — a prospecting reply,
  an outreach conversation, a rebuttal, "what do we say to this lead," "which lead to work" — is
  **their** job.
- **Models = what an actor runs ON** (`ollama-cloud/glm-*`, `claude-cli/claude-sonnet-4-6`,
  gemini). Chosen per-agent in `~/.openclaw/openclaw.json`. A model is a substrate, not a task-doer.
- **Tools = what an actor USES** (the Apify scrapers, `send_sms`, the booking endpoints — every MCP
  tool in `mcp-server/tbj-mcp.mjs`). This repo's job is to **expose tools and surfaces for the
  agents to call.** That's THE RULE above.

**This app is the stage and the toolbox. It is never the actor.** Any "intelligence" that lives in
the app is a narrow, deterministic helper (a single draft, a classifier) — never a conversation.

Two instructions that keep getting misread — get them right:

- **"It should run on Ollama"** = put the **agent** on the ollama model in `openclaw.json` and let
  the gateway drive it. It does **NOT** mean "make the app POST to `ollama.com`." If you're writing
  a direct model call to *hold a conversation*, stop — that conversation is an agent.
- **"Use Apify" / "use the scraper"** = give the **prospector agent** the Apify tool and let it
  decide when to call it. It does **NOT** mean the app hits Apify directly to do the agent's job.

**The test, before you write a line:** does this task decide *what to say or do* (judgment, a
conversation, a rebuttal, which lead to work)? → **agent work** — build or adjust the OpenClaw
agent (its personality files, model, tools) via `/edit-agent` or `/create-agent`, and make sure the
**gateway is running** (that's the first thing to check when an agent seems "broken" — see
[`docs/OPENCLAW.md`](docs/OPENCLAW.md)). Is it *deterministic plumbing* (a scheduled send, a poll, a
webhook relay, a DB write, a page)? → **app work**, and THE RULE above applies. When in doubt, it's
an agent — ask before building a direct-to-model or direct-to-tool path.

**Live example of getting this wrong:** `src/lib/sms-agent.ts` currently holds the lead conversation
by calling a model API directly from the app. That's the mistake this rule exists to stop. The
correct shape is an OpenClaw **comms agent** on the ollama model, using the `send_sms` + booking
MCP tools, invoked by the gateway when a lead texts back — not app code POSTing to a model. Treat
it as owed migration; do not add more app-side agent brains in the meantime.

## Docs protocol — how this file stays fast AND current

Don't let docs drift silently (see FORGE.md's incident writeup for what that cost once — and
docs/README.md's "Every README.md" table for a second, worse example: `factory/README.md` fully
described a retired pipeline, and `vps-sentinel/README.md`'s own "replaced by X" banner went
stale when X was *also* later retired — nobody was checking a README describing something old
when the new thing changed again). Before you consider a change done:

1. **Check `docs/README.md`'s index** — does anything you touched match one of its "read this
   when…" triggers (a nav tab, a cron, an MCP tool, the forge lifecycle, an env var, a file path)?
2. **If yes, update that doc in the same change** — not a follow-up, not a TODO.
3. **Retiring or replacing a feature is its own trigger, separate from #1.** Grep
   `docs/README.md`'s "Every README.md" table for anything that *describes the old behavior* —
   not just docs about the new one — and either update it or add a `⚠️ RETIRED` banner (see
   existing examples: `vps-sentinel/README.md`, `linkedin-sender/README.md`). A stale "this
   replaced X" banner is exactly as misleading as no banner at all if X is later retired too —
   check what a doc *points to*, not just what it directly describes.
4. **If the change is big enough to need its own explanation and nothing fits**, add a new doc
   and list it in `docs/README.md`. Don't let it live only in a commit message.

## Working rules
- **Run `pnpm run build` before every push** — it runs `tsc`; a clean build is the merge gate.
- **Email delivery health is a gate for any sending change.** Before shipping anything that sends
  email — transactional, outreach, or a client newsletter — verify the live health board in
  [`docs/DELIVERABILITY.md`](docs/DELIVERABILITY.md) and **re-check + date the rows you affect**.
  Deliverability is a shared, exhaustible reserve: one send to a bounced address, without an
  unsubscribe, or from an un-authenticated domain degrades **every** future send on that domain. Never
  push bulk through the transactional mailbox, and don't promise a client "thousands of emails" until
  that doc's onboarding checklist is green.
- **Never commit secrets or PII**: no `.env*` files, no prospecting CSVs (gitignored under `/prospecting/`).
- Commit at each logical milestone; end commit messages with the `Co-Authored-By:` trailer.
- DB is the source of truth for schema — pull with `npm run db:pull`, don't hand-edit `src/db/schema.ts`.
