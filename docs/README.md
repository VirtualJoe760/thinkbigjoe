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
| [`EDITOR.md`](EDITOR.md) | You're touching the **customer site editor** (`/portal/edit/[id]` — the Site/Studio/Design tabs), `public/editor.js`, the `/api/site-proxy` injection, the `edit_requests` → `edit-poll` apply loop, or the **design-token/theming system**. The **token-first modular editor** (edit Primary/Secondary/palette + fonts, not one element) + mobile **shipped 2026-07 (Phases 1–6)** — the doc's roadmap table maps each phase to its commits; its "What exists today" notes describe the pre-build starting point, so trust file paths over prose. |
| [`PORTAL_REDESIGN.md`](PORTAL_REDESIGN.md) | **You're touching the claimed-site portal's shape** — the voice-first/Ivy-driven redesign: the audit of the old website-first portal, the call-Ivy flows that replaced the setup forms (`/portal/receptionist` is now a redirect to the dashboard), billing's website/voice decoupling, and the phased plan through making TBJ its own voice tenant. ⚠️ Written as a PLAN (2026-07-20); several phases have since shipped (portal shell, `/portal/dashboard` scoreboard, `/portal/knowledge`, `/portal/agents`) — trust code over its "Today" column. |
| [`PLATFORM.md`](PLATFORM.md) | You're working on the **big refactor**: turning the forge into a composable full-stack platform (auth/billing/db/portal/admin as opt-in **plugins**), making the **public marketing site a forge template**, or the app-side **foundation refactor** (shared UI primitives, directory reorg, dead-code pruning). **The living roadmap** — locked decisions, the phased plan, and the two load-bearing facts (the shelved `backend-service-business` full-stack template + the static-only deploy delta). |
| [`LOGOS.md`](LOGOS.md) | You're touching **brand-asset generation** — the forge's image prompts, `factory/logo-fix.mjs`, the Image Studio, `src/lib/logo-spec.ts`, or a template's `CLAUDE.md` asset block. The canonical **per-type spec** (aspect · prompt fragment · trim/pad rule · quality gate) for the horizontal lockup, the circular emblem, and the photo types — plus why the forge (Node + sharp) and Studio (browser canvas) implementations are **twins that must change together**. |
| [`VOICE.md`](VOICE.md) | You're touching the **AI phone receptionist** — the Retell agent, the `/api/voice/*` webhooks (`verify_code`, `check_availability`, `book_appointment`, `verify_callback_code`), the **priority-callback-code → transfer-to-Joe** flow, the call/claim flow, provisioning (`scripts/retell/create-tbj-agent.mjs`), or selling voice as a per-client service. Notes how to update the live agent. |
| [`AUTH.md`](AUTH.md) | You're touching **login, the admin gate, transactional email, inbound email, or the domain/DNS/email setup** — better-auth wiring, the admin allowlist, the Google-only-account/no-password gotcha, the Zoho SMTP setup, `/api/health/email`, the **inbound bounce/reply pipeline** (`scripts/inbox-poll.mjs` → `forge_replies` → the "Replies to respond to" panel on `/command/leads`, draft→approve→send), **and the authoritative "where everything lives" map: DNS = Vercel, email = Zoho, plus deliverability (SPF/DKIM/DMARC) status.** Check it before asking where DNS or email lives. |
| [`SMS.md`](SMS.md) | You're touching **SMS or the Twilio number's call handling** — the send helper (`src/lib/sms.ts`), the **two-way relay** webhook (`/api/sms/inbound`, `#code` conversation mapping to Joe's Google Voice, `sms_conversations` table), **call forwarding** to the Retell AI line (`/api/twilio/voice`), the `send_sms` MCP tool, A2P 10DLC compliance (shared LLC brand + "Low Volume Mixed" campaign), or the Twilio env vars / Messaging Service + number webhook wiring. |
| [`DELIVERABILITY.md`](DELIVERABILITY.md) | You're touching **anything that sends email** — transactional, outreach, or the **client newsletter at scale** — or onboarding a client to sending. The delivery **standards** (authenticated domain, bounce suppression, one-click unsubscribe, never bulk through the mailbox, warm-up), the **live health board** (SPF/DKIM/DMARC, transactional transport, bounce poller, client-newsletter readiness — keep it current), the **check-health runbook**, and the **before-a-client-sends checklist**. `AUTH.md` is the mailbox/DNS mechanics; this is whether the system is healthy + safe to send. |
| [`EMAIL_SCALE.md`](EMAIL_SCALE.md) | You're **building or operating the bulk email sender** (client newsletters at thousands/month). The **Amazon SES** architecture (send queue + paced background job, SES transport, SNS bounce/complaint webhook, suppression list), **per-client sending identity** (reputation isolation via their own verified domain), the **AWS-console setup steps** (domain/DKIM, DMARC, production access, SNS, SMTP creds — Joe handles the secret), and the build order. Standards + health live in `DELIVERABILITY.md`. |
| [`CONTACTS.md`](CONTACTS.md) | You're touching **contact data** — the `contacts` table (TBJ's own CRM: one row per person we deal with, `src/lib/contacts.ts`), the `/portal/settings` "Business details" form (prepopulated from the scrape on claim), or the lead engine capturing an address. **The load-bearing distinction:** `contacts` is OUR CRM (prospects + client owners) — the client's *own* customers stay in `newsletter_contacts` + their Google Contacts, never here. Also documents the **staged cutover** off the legacy `forge_sites` contact columns (still read by the live senders — don't drop them yet). |
| [`NEWSLETTER.md`](NEWSLETTER.md) | You're touching the **$99-plan monthly customer newsletter** — the portal **studio** (`/portal/newsletter`: rich editor, **banner + inline images**, **AI co-edit**, live branded preview), the draft/revise/render engine (`src/lib/newsletter.ts`), image storage (**Vercel Blob** via `src/lib/blob.ts` + `/api/newsletter/upload`; `BLOB_READ_WRITE_TOKEN`), the `newsletter_contacts` / `newsletters` (+`banner_url`) tables, or the unsubscribe route. Client uploads a list → drafts/edits with AI → approves + sends (paced SES queue, see `EMAIL_SCALE.md`). |
| [`VOICEMAIL.md`](VOICEMAIL.md) | You're touching **ringless voicemail** — the Drop Cowboy integration (`src/lib/dropcowboy.ts`, `src/lib/voicemail-outreach.ts`), the **📞 Drop voicemail + text** lead-page button, the batch sender (`/api/forge/send-voicemail-outreach`), the delivery webhook (`/api/dropcowboy/webhook`), the `drop_voicemail` MCP tool, or the `DROPCOWBOY_*` env vars. The "call, then follow up with a text" first-touch; callbacks route to Ivy. |
| [`VOICE_ONBOARDING.md`](VOICE_ONBOARDING.md) | **You're touching how a customer's receptionist gets configured** — Ivy's phone interview (`/api/voice/onboard/{start,verify,save}`), the `voice_onboarding` challenge table, or prompt step 5 in `agent-config.mjs`. ⚠️ **Read the threat model before loosening anything:** account numbers are sequential and enumerable, so an account number identifies a caller but must never authorize one — the one-time code is what stands between a guessed number and repointing a competitor's emergency calls. Also explains why the portal's single free-text phone field was a real bug, not just poor UX. |
| [`VOICE_TENANCY_SPEC.md`](VOICE_TENANCY_SPEC.md) | **You're making the voice receptionist work for customer businesses instead of just TBJ** — the `voice_lines` + `calls` tables, tenant resolution from `call.to_number`, the shared-agent + dynamic-variables architecture, per-tenant booking, the Twilio fallback dial, and the staged build order. The implementation spec: exact files, signatures, and schema. ⚠️ **Supersedes** the per-customer-agent provisioning in `AGENT_PLATFORM.md` and `ONBOARDING_READINESS.md` P0 #5 — one shared agent, not N. Its "verify before coding" gate on Retell's inbound-webhook wire format is ✅ resolved — verified while building (`/api/voice/inbound` is live; see the spec's status header). |
| [`SALES_RUNBOOK.md`](SALES_RUNBOOK.md) | **You're actually selling** — the voicemail script, follow-up texts, discovery questions, objection handling, the close, the customer intake list, **phone-forwarding instructions and the customer's kill switch**, the payment→live onboarding schedule, and the committed support model. Use verbatim. ⚠️ Opens with a live blocker: the demo number is Ivy (TBJ's own claim concierge), not a receptionist demo — a prospect who calls it hears the wrong product. |
| [`ONBOARDING_READINESS.md`](ONBOARDING_READINESS.md) | **Before taking a paying voice customer live** — the 2026-07-18 six-part code audit of the onboarding path (payments, auth/claim, voice provisioning, booking, portal, reliability). Ranked P0/P1/P2 blockers with file:line, what's genuinely solid, and the realistic sequence. ⚠️ **The load-bearing finding:** the per-customer receptionist does not exist — Ivy is TBJ's own single-tenant front desk, and several of its tools (`identify_caller`, `transfer_to_joe`, `book_appointment`) actively misbehave if pointed at a customer's callers. Read before touching `/api/voice/*`, `/api/twilio/*`, or promising an activation date. |
| [`AUTOMATION_PIPELINE.md`](AUTOMATION_PIPELINE.md) | **You're touching the ad→payment→customer automation, or anything money-spend-automatic** — the `auto_provision` switch + weekly line-budget cap (mirrors `forge_engine`), the switch-agnostic Stripe-webhook enqueue (`voice_provision_queue`), the drain poller (`scripts/provision-drain.mjs` + launchd `com.thinkbigjoe.provisiondrain`), the `/command/engine` cockpit + master kill, the `automation_status` MCP tool, or the auto-build-on-payment trigger. ⚠️ **The invariant:** the enqueue never reads the switch; only the drainer does, and over-cap PAUSES (never drops). Money spend is OFF by default. |
| [`AGENT_PLATFORM.md`](AGENT_PLATFORM.md) | **You're building or changing an installable customer-facing agent** — the `site_agents` table, the `src/lib/agents.ts` registry, install/uninstall/entitlement logic, tier→agent mapping in `src/lib/plans.ts`, or the `/portal/agents` surface. The spec for how a customer buys a tier and turns agents on **after** the sale, the provisioning lifecycle, and the build order. ⚠️ **Naming:** the `agents` table is the OpenClaw org (Venus et al.); customer agents are `site_agents`. Also flags the load-bearing dependency: tier 2–3 agents are blocked on a customer-data ingress layer that does not exist yet. |
| [`BUSINESS_PLAN.md`](BUSINESS_PLAN.md) | **You're changing who we sell to, what we charge, or how we sell it** — the ICP, the offer ladder and price points, the outreach motion, the 90-day plan, or the day-60 go/no-go gate. Also read it before repointing a scraper, changing campaign sizing, or building a `/command/prospects` surface: it says *why* the targeting is what it is, and carries the 2026-07-18 baseline (1,806 prospects, 48 contacted, **0 paying customers**) that the whole plan is calibrated against. **Supersedes the ICP row in `ACQUISITION_SYSTEM.md`.** |
| [`ADS.md`](ADS.md) | **You're touching paid ads** — the `meta-ads` MCP server (re-auth via `/mcp`, writes land PAUSED, creative uploads by hand, ≤1 budget edit/day), the **UTM attribution pipeline** (`attribution-capture.tsx` → intake/contact forms → `leads.utm_*` → the command-home "ad:" chip → the `ads_funnel_report` MCP tool), campaign 1's spec (`never-miss-a-call-v1`), the cost-per-form-fill metrics, or an ad's landing URL. ⚠️ **Carries the launch gates: zero spend until they're green and Joe activates the campaign himself.** No plan prices in creative. |
| [`ACQUISITION_SYSTEM.md`](ACQUISITION_SYSTEM.md) | You need the original multi-agent client-acquisition gameplan for context. **Partly aspirational** — it says so at the top; treat anything not corroborated by the docs above as not-yet-built, not as current behavior. ⚠️ **Its "Decisions locked in" ICP is superseded by [`BUSINESS_PLAN.md`](BUSINESS_PLAN.md)** — the finance/insurance/MSP pilot vertical described there is not the current target. |

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
| `/linkedin-sender/README.md` | ⚠️ Deleted (2026-07-09, `f55f515`) | The cloud (Browserbase/Playwright) LinkedIn connection-request drip-sender for the retired B2B/insurance funnel. The whole directory, its `linkedin-sender.yml` GitHub Action, and the `/command/automation` UI were removed together — nothing is scheduled anymore. Row kept so nobody re-adds a "still running?" warning; backend tables/MCP tools were left intact. |
| `/windows-sender/README.md` | ⚠️ Deleted (2026-07-09, `f55f515`) | Windows/Playwright variant of linkedin-sender; superseded by it, then removed with it. |
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
  `vps-sentinel/README.md`, `macmini-runner/README.md`). Do this
  even in a repo with no doc index of its own (like `webdev-templates`) — that lack of an index
  is exactly why its README went unnoticed for so long.

If you're not sure a doc is still accurate, the fastest check is to grep the actual code/config
for the specific claim (file paths, env var names, table/column names) rather than trust the doc's
prose — the docs above call this out explicitly where it's mattered before.
