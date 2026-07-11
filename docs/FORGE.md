# The Forge — site-building pipeline, queue architecture, and cost safety

The forge turns an approved prospect into a live, deployed marketing website. It runs as
**local infrastructure on Joe's Mac** (`~/code/webdev-templates`, a separate repo from this one),
driven by `claude -p` (Claude Code, non-interactive). It is deliberately **NOT an OpenClaw/Venus
cron** — an 8–15 minute Claude Code build is boring, deterministic infra, not a cognitive
scheduling decision. See [OPENCLAW.md](OPENCLAW.md) for the agent side of the business.

**Read this whole doc before changing anything that touches `claude -p`, launchd timers, or bulk
`forge_sites` updates.** The "queue" flooded and burned real money once already (2026-07-06) —
the fixes are load-bearing, not decoration.

---

## Architecture map — directory layout

```
~/code/webdev-templates/                  ← separate repo, NOT this one. Lives on Joe's Mac only.
├── packages/ui/                          @webdev/ui — shared, content-agnostic component library
│   └── src/
│       ├── styles/globals.css              base @theme tokens
│       ├── primitives/                     Button, Container, Section, Heading, Card, …
│       ├── sections/                       Navbar, Hero, Services, Stats, Testimonials, CTA,
│       │                                    TrustBar, ProcessSteps, BeforeAfter, … (grows as the
│       │                                    template-designer mode adds new section types)
│       └── hooks/useReveal.ts              scroll-reveal (the thing that was silently broken —
│                                            see the Hero-fade fix in git history)
├── templates/                            THE TEMPLATE LIBRARY — each dir is a distinct, reusable
│   │                                      design, cloned fresh per new site
│   ├── frontend-base/                      "classic-service" — the original balanced skeleton
│   ├── bold-trades/                        designer-built (dark/muscular trades)
│   ├── premium-service/                    designer-built (editorial/serif)
│   ├── friendly-local/                     designer-built (warm/rounded)
│   ├── clean-corporate/                    designer-built (grid/blue-professional)
│   ├── modern-tech/                        designer-built (gradient/bento)
│   └── registry.json                       THE INDEX — { id, dir, enabled, bestFor, preview }
│                                            forge-build.sh picks an enabled template from here
├── factory/
│   ├── design-languages.json               the aesthetic specs the designer mode builds FROM
│   ├── forge-build.sh                       builds ONE site (see lifecycle below)
│   ├── forge-poll.mjs                       the queue worker (polls Neon, claims, runs forge-build)
│   ├── forge-template.sh                    the template-DESIGNER mode (builds a new template)
│   ├── deploy-vercel.mjs                    pushes a built site live (Vercel API)
│   ├── queue/                               per-build business.json inputs (transient, gitignored-ish)
│   └── sites/.forge.lock.d                  the single-worker lock directory (see Queue architecture)
└── sites/<slug>/                         ONE GENERATED SITE per business — a full Next.js app,
                                           cloned from a template dir, content filled in, deployed
                                           to its own Vercel project (tbj-<slug>.vercel.app)
```

**The template vs. the site — don't confuse them.** `templates/<name>/` is the reusable design
(edit it to fix a bug across every future build, or via the designer mode to add a new one).
`sites/<slug>/` is one already-generated business's copy — editing it fixes only that one site.
A bug found on a live site almost always belongs in `templates/`, not `sites/<slug>/`.

---

## Connecting to it — env vars, secrets, and how the pieces actually talk

The forge and this app (`thinkbigjoe`) are separate codebases on **the same Mac**, connected by
three things: a shared Neon database, a shared Vercel token, and files read directly off disk
(there is no API between them — it's all local filesystem + one shared Postgres connection
string).

| What | Lives where | Read by |
|---|---|---|
| `DATABASE_URL_UNPOOLED`, `CRON_SECRET` | `~/code/thinkbigjoe/.env.local` | `forge-poll.mjs` reads **this app's** `.env.local` directly off disk (`path.join(HOME, "code/thinkbigjoe/.env.local")`) — the forge has no `.env` of its own for these. |
| `VERCEL_TOKEN`, `GITHUB_TOKEN` | `~/code/nanocrew/.env.local` | `forge-build.sh` / `deploy-vercel.mjs` — **a third repo's** env file. (Historical — nanocrew was an earlier project; the tokens just live there.) |
| `GEMINI_API_KEY` (image generation) | `~/.openclaw/service-env/ai.openclaw.gateway.env` | Sourced by `forge-build.sh` at the top (`set -a; source "$ENVF"`) — the same env file the OpenClaw gateway uses. |
| Claude Code auth | macOS Keychain (`claude auth status`) | `forge-build.sh` explicitly `unset`s `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` so `claude -p` is forced onto the **subscription** login, not a stray API key — this is the #1 thing to verify if a build's cost looks wrong. |
| `FORGE_APP_URL` (optional) | shell env when running `forge-poll.mjs` | Where it POSTs build results — defaults to `https://thinkbigjoe.com`. |

**No API key or webhook connects the two repos** — `forge-poll.mjs` talks to Neon directly with
the connection string it read out of thinkbigjoe's `.env.local`, and reports results back over
plain HTTPS to `POST https://thinkbigjoe.com/api/forge/register` (Bearer `CRON_SECRET`, the same
secret both sides read from that one `.env.local` file). If you move either repo to a different
machine, this whole connection breaks until both paths are updated.

**Manually triggering things (no UI, straight from the terminal):**
```bash
cd ~/code/webdev-templates

# Run the queue worker once (processes at most one approved job, see Queue architecture)
node factory/forge-poll.mjs

# Force-build a specific approved row directly, optionally pinning a template
bash factory/forge-build.sh factory/queue/<slug>.json [template-dir]

# Design a brand-new template from a design-language spec (expensive — see Cost model)
bash factory/forge-template.sh <language-id>

# Check what's currently running/queued before touching anything
launchctl list | grep thinkbigjoe
ls sites/.forge.lock.d 2>/dev/null && echo "a build IS active" || echo "idle"
```

---

## The lead lifecycle (full pipeline, prospect → paying customer)

```
prospector finds a business (no/bad website)
        │  add_forge_prospect
        ▼
forge_sites.status = 'discovered'   ──▶  Joe reviews in /command/prospects
        │  Joe clicks Approve
        ▼
status = 'approved'                 ──▶  queued for the forge (see Queue architecture below)
        │  forge-poll claims it, forge-build.sh runs claude -p, builds, deploys
        ▼
status = 'built'                    ──▶  /command/prospects → Built (review, NOT yet a lead)
        │  Joe reviews the live site. Tools available on the card:
        │    ✏️ Edit site      → /portal/edit/[id]            (live content editor)
        │    🎨 Image studio   → /portal/edit/[id]?tab=studio (Gemini image regen)
        │    🛠 Ask forge to revise → plain-English note → forge-build re-applies it in place
        │    🎲 Rebuild differently → fresh build, different template, clears preferred_template
        ▼
Joe clicks "✓ Approve for marketing"   (sets forge_sites.marketing_approved_at)
        │
        ▼
IT BECOMES A LEAD           ──▶  /command/leads "call room": photo, reviews, calling script
        │
        ├─▶ outreach agent drafts email/DM (list_forge_outreach_queue → save_forge_outreach_draft)
        │     — ONLY fires for marketing_approved_at IS NOT NULL leads
        │
        └─▶ Joe reviews the draft, clicks Approve & send (real SMTP send)
                  owner gets: live link + claim code + book-a-call
                  owner claims the site → /portal/claim → optional Stripe Identity verification
```

**The gate is the point.** A `built` site is a draft for Joe's eyes, not a lead. Nothing in the
outreach path (agent drafting, the call room, the `list_forge_outreach_queue` MCP tool) considers
a site a lead until `marketing_approved_at` is set. This was added specifically so "the forge
finished a build" and "we're marketing to this business" are two separate, human-gated decisions.

---

## Templates — why sites shouldn't all look the same

`templates/registry.json` in webdev-templates is the library the forge picks from for each new
build (with variety — it avoids repeating the last template used). Originally there was only one
skeleton (`classic-service` / `frontend-base`) with 5 color/font "themes" layered on top — which is
why early sites looked structurally identical (same section order, same hero-fades-to-white-then-
slams-into-a-dark-band pattern) no matter the theme.

**`factory/design-languages.json`** defines aesthetic design-*languages* (Bold Trades, Premium
Service, Friendly Local, Clean Corporate, Modern Tech) — each with its own section composition,
type/color strategy, and the new section components it needs (TrustBar, ProcessSteps, BeforeAfter,
ReviewWall, Bento, etc.), reusable across many industries rather than tied to one trade.

**`factory/forge-template.sh <language-id>`** is the *template-designer mode*: a `claude -p` run
that designs + codes a genuinely new template into the registry, builds a demo, screenshots it,
and registers it `enabled: false` until reviewed. It also queues a **real matching prospect** on
that template (rather than a throwaway demo) so reviewing it means looking at an actual site for
an actual business.

**Approving templates (the `templates` table is the source of truth).** The cloud DB `templates`
table mirrors the registry and carries the authoritative `enabled` flag. Review + approve from the
**`/command/engine` "Templates" panel** (`command/actions.ts:setTemplateEnabled`) — toggling there
flips `templates.enabled`, and **`forge-poll.mjs` mirrors those flags into `registry.json` on its
next tick** (so `forge-build.sh`'s selector, which reads the registry, honors the UI). You *can*
still hand-edit `registry.json` on the Mac, but the DB will overwrite it on the next poll — toggle
in the UI instead. The app-side owner picker (`src/lib/forge-templates.ts`) is a hand-kept mirror;
keep it in sync when templates are added/retired.

Building a new template is an **expensive, `--max-turns 160` `claude -p` run** — this is not
something to batch casually (see the incident below).

---

## Queue architecture — SINGLE WORKER, non-blocking lock

**What broke (2026-07-06):** the lock that was supposed to make "one build at a time" true was a
**blocking** mkdir-lock — a launchd tick that found the lock held would *wait in line* (up to
60 minutes) rather than exit, and `forge-poll` pulled **every** `approved` row in one run instead
of one job at a time. Combine those with a bulk re-queue of a dozen-plus sites and you get several
overlapping `claude -p` processes running concurrently, each burning real Claude API spend, with
GitHub pushes flying out even for builds that failed locally. That's what drained the account.

**The fix, now in place:**
- `factory/forge-build.sh` and `factory/forge-template.sh` locks are **non-blocking** — if the
  lock is held, the process **exits immediately** (`FORGE_BUSY`, exit 0). It never waits, never
  stacks a second `claude -p`.
- `factory/forge-poll.mjs` **peeks the lock before doing anything** — if a build is active it
  exits the tick entirely. When free, it claims and builds **exactly one** oldest-`approved` row
  per tick (true FIFO), not the whole batch. A stale lock (>40 min, i.e. a crashed build) is
  cleared automatically so the queue doesn't wedge forever.
- `forge-build.sh` only pushes to GitHub **after** a clean local `pnpm build` — a failed build can
  no longer spam the repo with broken commits.

**Net effect:** at most one `claude -p` process runs at any moment, system-wide. A queue of N
approved sites drains one every ~10–15 minutes, however large N is. This is the correct behavior —
do not "fix" slowness by re-introducing parallelism without also adding the guardrails below.

### UI kill-switch — one switch, both flows (builds + edits)

The forge on/off toggle in the **Engine room** (`/command/engine`) writes `forge_engine.enabled`.
**Both** local pollers read it at the top of every tick and no-op when it's `false`:
- `forge-poll.mjs` — pauses new-site builds.
- `edit-poll.mjs` — pauses applying portal edits.

Crucially, turning the forge **off never drops work**. The Vercel front-end still accepts
everything: an approved site stays `status='approved'`, and a customer's portal edit is still
written to `edit_requests` as `status='requested'` (the `/api/edit-requests` route has no
forge-state gate). Both simply **queue** until Joe flips the forge back on, then drain on the next
tick. So "the forge is offline" degrades to "builds are paused," never "edits are lost." The Engine
room surfaces this: a pending customer-edits indicator shows the count waiting while it's off.

### Granular controls, weekly run-budget + idle template-building

Beyond the master `enabled`, the Engine cockpit exposes finer control (all columns on
`forge_engine`, read by the pollers each tick):

| Column | Control | Effect when off / exceeded |
|---|---|---|
| `builds_enabled` | New-site builds | `forge-poll` skips claiming `approved` sites (edits + idle templates still run) |
| `edits_enabled` | Customer edits | `edit-poll` no-ops; edits stay `requested` and drain when re-enabled |
| `idle_templates_enabled` | Idle template-building | when the forge is otherwise free, design a new template (default **off**) |
| `weekly_run_budget` | Quota guard (default 40) | when 7-day runs ≥ budget, new builds **and** templates pause; edits still run |
| `templates_per_day` | Idle template daily cap (default 2) | — |

**Spend = runs, not dollars.** The forge runs on the Claude **Max subscription** (flat weekly
rate-limit), so there is no per-token bill. A "run" = one build, edit, or template (counted from
`activity_log`: `forge_site_built`/`forge_site_build_failed`/`edit_applied`/`edit_failed`/
`forge_template_built`, including failures — they still burn quota). `forge-poll` warns via Telegram
once per **75 / 90 / 100%** band crossed (`last_warn_pct` de-dupes) and logs `forge_budget_warning`.

**Idle template-building** (the "grow the library when free" fallback) only fires when: the toggle is
on **and** under budget **and** under the daily cap **and** ≥3h since the last template **and** no
edits are pending. It designs the next unbuilt entry from `factory/design-languages.json` via
`forge-template.sh` (registered `enabled:false` for review). Seed more directions there to extend
the backlog.

The digest that powers all of this — queues, throughput, the budget gauge — is computed once in
`src/lib/forge-stats.ts` (`getForgeDigest`), exposed at `GET /api/forge/digest` (Bearer
`CRON_SECRET`), and consumed by the Engine cockpit, the Overview "Engine flow" card, and the
`forge_digest` MCP tool.

### Rules that keep this safe going forward

1. **Never bulk-approve/re-queue more than a handful of sites at once** without discussing it —
   each row in `approved` is a real `claude -p` build that costs money the moment the poller picks
   it up.
2. **The poller is OFF by default** (`com.thinkbigjoe.forgepoll` unloaded) unless you've
   deliberately decided to run builds. Loading it means "start spending." Check
   `launchctl list | grep thinkbigjoe` before assuming nothing is running.
3. **`git log --author=forge --oneline` in webdev-templates** is a cheap way to see exactly how
   many builds actually ran recently, without needing to re-run anything.
4. Before turning the poller back on after any pause, confirm `forge_sites` doesn't have a
   surprise pile of `approved` rows queued up (`SELECT count(*) FROM forge_sites WHERE status=
  'approved'`).

---

## Cost model — subscription vs. API, and how to scale

**`claude -p` billing is separate from OpenClaw's `claude-cli` agents**, but shares the same
underlying Claude account/subscription if both point at the same login. Two backends:

- **Claude subscription (Max)** — flat monthly fee, rate-limited, meant for interactive/one-human
  use. Good for **low-to-moderate serial volume** (today's setup: 1 build at a time, a handful a
  day) — predictable cost, and the rate limit itself acts as a natural spend cap. **A dedicated
  Max subscription for forge + nanocrew** (separate from Joe's personal one) is the right move at
  this volume — isolates spend, keeps it predictable, no more surprise credit drains.
- **API credits (pay-per-token)** — what actually got drained in the incident. No subscription rate
  cap, so a bug that runs N processes in parallel just charges N× the tokens with nothing to stop
  it. This is the credits Joe topped up $50 into as the emergency fallback.

**Scaling to "hundreds of sites/day" later** (not today, but the plan): the queue above is the
foundation, not the ceiling.
- Replace the mkdir lock with a **Postgres-backed job queue** (`forge_jobs` table +
  `SELECT ... FOR UPDATE SKIP LOCKED`) so **multiple worker processes** (not multiple ports —
  `claude -p` is a CLI process, not a server) can safely compete for jobs with zero races.
  Any number of workers, any number of machines, same queue.
  - The biggest cost lever without adding boxes: let `claude -p` just **generate code + push**,
    and let **Vercel do the actual `pnpm build`** — the local build is the heaviest thing a worker
    does today. Doing so lets one machine host far more concurrent workers.
- A subscription **cannot** power a parallel-worker fleet — Max's rate limits handle "a few dozen
  serial builds/day," not concurrent workers. Hundreds/day means switching that worker pool to
  **API billing** with raised rate limits, plus a **daily budget cap + max-attempts + dead-letter**
  built into the queue so a poison job or a bug fails loudly and cheaply instead of looping.
- The worker code itself doesn't change between subscription and API — only the auth. Build the
  queue once, run it on 1 worker + the dedicated subscription now, flip to API + N workers later
  with no rewrite.

---

## Key files

| File | Purpose |
|---|---|
| `factory/forge-build.sh` | Builds ONE site: clone template → brief (Gemini) → `claude -p` → `pnpm build` gate → screenshot → push (gated on clean build) → deploy → register. Non-blocking lock. |
| `factory/forge-poll.mjs` | The queue worker. Peeks the lock, claims exactly one `approved` row per tick, runs forge-build.sh, POSTs the result to `/api/forge/register`. |
| `factory/logo-fix.mjs` | Post-build geometry fix for `logo.png` / `logo-circle.png` — trims the transparent canvas back to the real mark, re-pads **per type**, and warns when the generation itself is wrong (a bare icon instead of a filled circle; a near-square instead of a wide lockup). Idempotent + non-fatal. Spec: [`LOGOS.md`](LOGOS.md). |
| `factory/forge-template.sh` | The template-designer mode — builds a new reusable template + queues a real prospect on it. |
| `templates/registry.json` | The template library forge-build picks from (`enabled: true/false`). |
| `factory/design-languages.json` | The aesthetic specs the designer mode builds templates from. |
| `~/Library/LaunchAgents/com.thinkbigjoe.forgepoll.plist` | The launchd timer for forge-poll.mjs. **Check load state before assuming builds are/aren't running.** |
| `scripts/lead-engine.mjs`, `enrich-engine.mjs`, `callprep-engine.mjs`, `trigger-poll.mjs` (this repo) | Separate Apify/free-agent engines for finding + enriching leads — not the forge itself, but feed `forge_sites`. Budget-aware, independently scheduled. |
