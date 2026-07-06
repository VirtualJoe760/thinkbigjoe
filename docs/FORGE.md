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
an actual business. Flip `enabled: true` in the registry once you like the preview.

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
| `factory/forge-template.sh` | The template-designer mode — builds a new reusable template + queues a real prospect on it. |
| `templates/registry.json` | The template library forge-build picks from (`enabled: true/false`). |
| `factory/design-languages.json` | The aesthetic specs the designer mode builds templates from. |
| `~/Library/LaunchAgents/com.thinkbigjoe.forgepoll.plist` | The launchd timer for forge-poll.mjs. **Check load state before assuming builds are/aren't running.** |
| `scripts/lead-engine.mjs`, `enrich-engine.mjs`, `callprep-engine.mjs`, `trigger-poll.mjs` (this repo) | Separate Apify/free-agent engines for finding + enriching leads — not the forge itself, but feed `forge_sites`. Budget-aware, independently scheduled. |
