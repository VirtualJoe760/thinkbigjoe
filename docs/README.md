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
| [`AGENT_PLAYBOOK.md`](AGENT_PLAYBOOK.md) | The step-by-step how-to for the agent org: **update an agent, give it a tool, add a new one, restart the gateway, the cron→agent gotcha, model/quota rules, and scaling to per-client sales agents.** OPENCLAW.md is the concepts; this is the procedures. |
| [`MCP_TOOLS.md`](MCP_TOOLS.md) | You need to understand how Claude Code, OpenClaw's agents, and this app relate through the MCP server — or you're adding a new MCP tool. |
| [`FORGE.md`](FORGE.md) | You're touching site-building: a template, the queue/poller, deploy behavior, or anything that could trigger a `claude -p` build. **Read before any bulk `forge_sites` status change.** Includes the architecture map + exact env-var wiring between this repo and the forge repo. |
| [`SHOWROOM.md`](SHOWROOM.md) | You're touching the **sell-first preview engine**: the personalized `/s/[slug]` previews, `claim = build` trigger, the `preview_engine` wave budget, the outreach-agent integration, or the preview schema. The full funnel from discovered → preview → claim → built. |
| [`VENUS_UI_MAPPING.md`](VENUS_UI_MAPPING.md) | You're building or changing a `/command/**` or `/portal/**` surface, and need to know which MCP tool/cron/engine is supposed to feed it (or vice versa — a UI surface exists and you need to find its data source). |
| [`EDITOR.md`](EDITOR.md) | You're touching the **customer site editor** (`/portal/edit/[id]` — the Site/Studio/Design tabs), `public/editor.js`, the `/api/site-proxy` injection, the `edit_requests` → `edit-poll` apply loop, or the **design-token/theming system**. The target is a **token-first modular editor** (edit Primary/Secondary/palette + fonts, not one element) + mobile. **Partly a design-spec** — it flags what exists vs. what's planned. |
| [`LOGOS.md`](LOGOS.md) | You're touching **brand-asset generation** — the forge's image prompts, `factory/logo-fix.mjs`, the Image Studio, `src/lib/logo-spec.ts`, or a template's `CLAUDE.md` asset block. The canonical **per-type spec** (aspect · prompt fragment · trim/pad rule · quality gate) for the horizontal lockup, the circular emblem, and the photo types — plus why the forge (Node + sharp) and Studio (browser canvas) implementations are **twins that must change together**. |
| [`VOICE.md`](VOICE.md) | You're touching the **AI phone receptionist** — the Retell agent, the `/api/voice/*` webhooks (`verify_code`, `check_availability`, `book_appointment`), the call/claim flow, provisioning (`scripts/retell/create-tbj-agent.mjs`), or selling voice as a per-client service. Notes the Retell-billing blocker + how to update the live agent. |
| [`AUTH.md`](AUTH.md) | You're touching **login, the admin gate, transactional email, inbound email, or the domain/DNS/email setup** — better-auth wiring, the admin allowlist, the Google-only-account/no-password gotcha, the Zoho SMTP setup, `/api/health/email`, the **inbound bounce/reply pipeline** (`scripts/inbox-poll.mjs` → `forge_replies` → the "Replies to respond to" panel on `/command/leads`, draft→approve→send), **and the authoritative "where everything lives" map: DNS = Vercel, email = Zoho, plus deliverability (SPF/DKIM/DMARC) status.** Check it before asking where DNS or email lives. |
| [`SMS.md`](SMS.md) | You're touching **SMS or the Twilio number's call handling** — the send helper (`src/lib/sms.ts`), the **two-way relay** webhook (`/api/sms/inbound`, `#code` conversation mapping to Joe's Google Voice, `sms_conversations` table), **call forwarding** to the Retell AI line (`/api/twilio/voice`), the `send_sms` MCP tool, A2P 10DLC compliance (shared LLC brand + "Low Volume Mixed" campaign), or the Twilio env vars / Messaging Service + number webhook wiring. |
| [`ACQUISITION_SYSTEM.md`](ACQUISITION_SYSTEM.md) | You need the original multi-agent client-acquisition gameplan for context. **Partly aspirational** — it says so at the top; treat anything not corroborated by the docs above as not-yet-built, not as current behavior. |

## Every README.md in the ecosystem

The doc list above is the curated `docs/*.md` — this table is every **README.md file that
physically exists**, across all three codebases, so nothing is hiding in a subdirectory nobody
remembers. ⚠️ = retired/legacy, kept only for history; safe to ignore unless you're archaeologizing.

**This repo (thinkbigjoe):**

| README | Status | What it covers |
|---|---|---|
| [`/README.md`](../README.md) | Active | Short pointer to `AGENTS.md` + this index, plus local-dev commands. |
| [`/docs/README.md`](README.md) | **This file** | The documentation index. |
| `/_archive/prospecting-linkedin-insurance-2026-06/README.md` | ⚠️ Archived (2026-07-06) | The old insurance/mortgage/wealth/law LinkedIn B2B prospecting notes — from before the pivot to local-service webdev. Was never in git (`/prospecting/` was gitignored — real PII); the whole folder was moved out of the live tree rather than deleted, kept for reference only. Not the current clientele. |
| [`/linkedin-sender/README.md`](../linkedin-sender/README.md) | ⚠️ Retired (docs-only — GitHub Action NOT disabled) | The cloud (Browserbase/Playwright) LinkedIn connection-request drip-sender, for the now-retired B2B/insurance funnel. **Its `linkedin-sender.yml` GitHub Action is still scheduled every ~10 min** and will run if `/command/automation` is toggled on with approved prospects queued — the code/infra wasn't touched, only the docs now say clearly that this isn't the business anymore. |
| [`/windows-sender/README.md`](../windows-sender/README.md) | ⚠️ Retired (docs-only) | Same job as linkedin-sender, Windows/Playwright variant; superseded by it anyway. |
| `/vps-sentinel/README.md` | ⚠️ Retired | The DigitalOcean Gmail-IMAP sentinel; no VPS anymore. Its own "replaced by X" banner had gone stale too (X was later removed) — fixed 2026-07-06, see the banner for the story. |
| `/macmini-runner/README.md` | ⚠️ Retired | Replaced entirely by Venus on OpenClaw — this banner has stayed accurate. |

**`~/code/webdev-templates` (the forge — separate repo, see [FORGE.md](FORGE.md)):**

| README | Status | What it covers |
|---|---|---|
| `webdev-templates/README.md` | Active | The monorepo overview — stack, layout, the template registry (updated 2026-07-06 to mention `templates/registry.json` + the template-designer mode instead of only describing the original single `frontend-base` copy-paste flow). |
| `webdev-templates/factory/README.md` | ⚠️ Outdated, banner-replaced | Used to describe the retired Adrian/Cleo/Leo multi-agent pipeline in full detail. Now a short banner pointing to `docs/FORGE.md` (this repo) as the source of truth, rather than re-describing the current pipeline in a second place with no index watching over it. |
| `webdev-templates/packages/ui/README.md` | Active | `@webdev/ui` component library conventions — still accurate. |
| `webdev-templates/templates/backend-service-business/README.md` | ⚠️ Flagged unverified | Not referenced by `templates/registry.json` or any current forge script — added a banner saying so explicitly rather than silently leaving it looking current. Confirm with Joe whether this is a live future product line before building on it. |

**Not a README, but functions as one:** OpenClaw agent persona files
(`~/.openclaw/agents/<id>/*.md`) are documentation-as-config for each agent — see
[OPENCLAW.md](OPENCLAW.md) rather than looking for a README there; there isn't one, the persona
files themselves are the reference.

## Keeping this current

Docs rot the moment behavior changes and the doc doesn't. The rule (also stated in `AGENTS.md`):
**when a change makes something in one of these docs inaccurate, fix the doc in the same PR.**
Common triggers to watch for:
- Added/removed a `/command/**` or `/portal/**` route or nav tab → `VENUS_UI_MAPPING.md`.
- Added/edited/removed a Venus cron, an MCP tool, or the agent roster → `OPENCLAW.md` and/or
  `VENUS_UI_MAPPING.md`.
- Added a new MCP tool, or changed how OpenClaw/the app/Claude Code connect to `tbj-mcp.mjs` →
  `MCP_TOOLS.md`.
- Added/removed a README.md anywhere in the ecosystem → the table above ("Every README.md").
- Changed the forge's lifecycle, queue behavior, template library, or anything cost-related →
  `FORGE.md`.
- Added a new doc → add it to the table above.
- **Retired or replaced a whole feature/pipeline** → this is the trigger that actually broke
  down before (2026-07-06): `webdev-templates/factory/README.md` fully described the retired
  Adrian/Cleo/Leo pipeline for months, and `vps-sentinel/README.md`'s own "retired, replaced by
  X" banner went stale when X was *also* retired later. **Scan the "Every README.md" table for
  anything describing the OLD thing — not just anything about the new one — and either update it
  or add a `⚠️ RETIRED`/`⚠️ OUTDATED` banner** (copy the style already used on
  `vps-sentinel/README.md`, `macmini-runner/README.md`, `linkedin-sender/README.md`). Do this
  even in a repo with no doc index of its own (like `webdev-templates`) — that lack of an index
  is exactly why its README went unnoticed for so long.

If you're not sure a doc is still accurate, the fastest check is to grep the actual code/config
for the specific claim (file paths, env var names, table/column names) rather than trust the doc's
prose — the docs above call this out explicitly where it's mattered before.
