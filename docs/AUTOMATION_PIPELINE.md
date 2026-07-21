# Automation Pipeline — ad to customer-for-life, on rails

> **Status**: PHASES 2–4 BUILT (2026-07-20). The keystone (auto-provision voice on payment) ships
> behind an OFF-by-default switch; Phase 1 (website optional / call-Ivy flows) shipped with the
> portal redesign. What remains is operational, not code — see "What's live now" below.
> **Written**: 2026-07-20 · **Owner**: Joseph Sardella
> Companion to [`BUSINESS_PLAN.md`](./BUSINESS_PLAN.md) (who/what/why),
> [`VOICE_TENANCY_SPEC.md`](./VOICE_TENANCY_SPEC.md) and [`VOICE_ONBOARDING.md`](./VOICE_ONBOARDING.md)
> (the voice half), [`FORGE.md`](./FORGE.md) (the build half + cost-safety).

---

## The reframe that makes this safe

The product is **the dashboard**, not the website.

The dashboard — the authenticated portal where the AI receptionist's calls, leads and agent results
show up — is a **shared multi-tenant app rendering each customer's own rows**. It costs effectively
nothing to give someone: an account plus their data. The public marketing website is a **per-customer
forge build** that costs real money, and **it is now optional** — an add-on for customers who want a
public face, not the core deliverable.

That single reframe dissolves the automation-vs-cost tension:

- The core deliverable is **free to provision**, so the funnel can be automatic from ad to account
  with zero spend and zero abuse exposure. A bot flooding the form creates empty logins, not builds.
- **The only outbound money-spend now sits AFTER payment** — voice provisioning and the optional
  site build. Money follows a real human commitment, so "fully automatic" is safe by construction.

Everything below is built around that ordering.

---

## The pipeline

```
   AD / referral / cold outreach
        │
        ▼
   ┌─────────────────┐
   │ 1. FORM         │  free.  A submit creates a lead + an account-in-waiting.
   │    /api/intake  │  No build. No spend. Bots cost nothing.
   └───────┬─────────┘
           ▼
   ┌─────────────────┐
   │ 2. THE DEMO     │  free.  They call the number and hear the product work.
   │    call Ivy     │  Ivy books the appointment and/or starts setup.
   └───────┬─────────┘
           ▼
   ┌─────────────────┐
   │ 3. DASHBOARD    │  free.  Account created, portal access granted.
   │    login        │  Empty until their receptionist goes live — then it fills.
   └───────┬─────────┘
           ▼
   ┌─────────────────┐
   │ 4. PAYMENT      │  ── THE GATE ──  the one real human commitment.
   │    Stripe       │  Everything downstream is post-payment, so auto-spend is safe.
   └───────┬─────────┘
           ▼
   ┌──────────────────────────────────────────────┐
   │ 5. AUTO-PROVISION  (guarded)                   │
   │    • voice number bought, receptionist LIVE    │  ← spend #1, post-pay
   │    • dashboard starts showing real calls       │
   │    • (optional) forge builds their public site │  ← spend #2, opt-in, post-pay
   └───────┬──────────────────────────────────────┘
           ▼
   ┌─────────────────┐
   │ 6. FINISHING     │  You. The appointment from step 2. Human touch = the moat + the
   │    TOUCHES        │  natural safety valve. Add finishing touches, they feel handled.
   └───────┬─────────┘
           ▼
      CUSTOMER FOR LIFE
      (a year of call history in a dashboard they can't take with them)
```

---

## The guardrail pattern (already proven in this repo — copy it, don't invent it)

Two workers already run "automated but budget-capped with a kill switch." Every new auto-spend
reuses the same shape:

| Piece | Forge (`forge_engine`) | Outreach (`automation_settings`) |
|---|---|---|
| Master switch | `enabled` | `enabled` |
| Cap | `weekly_run_budget` | `daily_goal` (+ ramp) |
| Read where | top of every forge-poll tick | `check_outreach_window` before every send |
| Over-cap behaviour | new builds pause, **queue preserved** | returns `allowed:false` |
| Warnings | 75 / 90 / 100% Telegram, de-duped | — |

**The rule that makes it safe: over budget PAUSES draining, never DROPS the queue.** A capped
pipeline stops spending; it doesn't lose the customer. When you raise the cap, the backlog flows.

**New for this pipeline:** an `auto_provision` config row with `enabled` + a weekly line-buy cap,
enforced exactly like the forge budget. Default OFF — flipping it on is the deliberate act that
turns "money spend manual" into "money spend automatic," and the cap is what stops a runaway.

---

## What's built vs. what's missing

| Step | Exists today | Missing |
|---|---|---|
| 1 Form | `/api/intake` (Turnstile, booking token), `/api/contact` → `leads` | An "account-in-waiting" so a form submit can become a login without a human |
| 2 Ivy demo/booking | Ivy live; booking works 3 ways; onboarding endpoints built + tested | Onboarding tools not pushed to the **live** Ivy agent; nothing deployed |
| 3 Dashboard | Full multi-tenant portal: calls, usage, calendar, receptionist config | Make website **optional** (today the funnel assumes a built site); "dashboard-only" onboarding path |
| 4 Payment | Stripe webhook sets plan/active/paid on `checkout.session.completed` | Nothing — this step works |
| 5a Auto-provision voice | `provision-line.mjs` (manual, `--apply`, idempotent, dry-run default) | **The automated caller**: payment → provision, behind the `auto_provision` switch + cap |
| 5b Optional site build | `status='approved'` triggers the external forge-poll; `forge_engine` guardrails | Make it **opt-in post-payment** rather than on-claim; the poller is OFF by default |
| 6 Finishing touches | Portal editor, template gallery, appointment with Joe | Nothing — this is the human step, on purpose |

**The single highest-value new piece is 5a:** payment → auto-provision voice, guarded. It's the one
money-spend with zero automated path today, it's post-payment so it's safe, and it's what turns
"they paid" into "their phone is answering" with no human in the loop.

---

## Build order (each phase is shippable and independently valuable)

**Phase 0 — deploy what exists + push Ivy's tools.** None of the current work is live. Deploy the
branch, run `update-tbj-agent.mjs` so the live Ivy has the onboarding tools. *No new code.*

**Phase 1 — dashboard as the front door.** Make the public website optional. A customer can be fully
live (account + receptionist + dashboard) with no forge build at all. This is mostly copy/flow
changes and a plan-feature flag; it removes the last place a build is assumed.

**Phase 2 — auto-provision voice on payment (guarded).** The keystone.
- New `auto_provision` config row: `enabled` (default OFF) + `weekly_line_budget` + warn bands.
- On `checkout.session.completed`, if the plan includes voice AND the receptionist config is
  complete AND `auto_provision.enabled` AND under cap → enqueue provisioning; else fall back to
  today's manual Telegram ping. **Same fail-safe as the forge: over cap or switched off = queue it
  for a human, never drop it.**
- Provisioning still runs through the same audited `provision-line` logic — the change is *what
  calls it*, not what it does. (Design note: the app can't run a CLI on the Mac Mini directly; this
  becomes either a small provisioning API the app calls, or a DB `provision_status='queued'` flag a
  poller drains — mirroring exactly how the forge build works today.)

**Phase 3 — auto-build the optional site on payment (guarded).** For customers who opted into a
public site, set `status='approved'` on payment instead of on claim, behind the existing
`forge_engine` budget. Reuses 100% of the existing guardrail; only the trigger moves.

**Phase 4 — the automation cockpit.** One `/command` surface showing all three switches
(`forge_engine`, `automation_settings`, `auto_provision`), their caps, spend-vs-budget, and a single
master kill switch. This is where "manual vs automatic" becomes a set of toggles you own, per the
existing `/command/engine` pattern.

---

## What's live now (2026-07-20)

Phases 2–4 shipped as one full-stack change (UI + schedule + the switch). What each layer is:

| Layer | Where | Notes |
|---|---|---|
| **The switch + cap** | `auto_provision` table (id=1), mirrors `forge_engine` | `enabled` default **OFF** (money spend manual). `weekly_line_budget` (default 10) caps numbers/7d. `auto_build_enabled` opt-in. |
| **Enqueue (switch-agnostic)** | `src/app/api/stripe/webhook/route.ts` → `enqueuePostPaymentAutomation()` | On a voice-plan `checkout.session.completed`: insert `voice_provision_queue` (idempotent via `unique(site_id)`). Never reads the switch — pausing never drops the customer. |
| **Drain (the enforcement)** | `scripts/provision-drain.mjs` + launchd `com.thinkbigjoe.provisiondrain` (5-min tick) | Reads the switch + cap; over cap PAUSES, never drops. Shells out to the untouched `provision-line.mjs --apply` — the money-spending path is unchanged, only *what calls it*. Warns 75/90/100%. |
| **Cockpit** | `/command/engine` → `AutoProvisionControls` | Master Manual/Automatic switch, line-budget + spend gauge, queued/failed counts, auto-build toggle, and a single **Stop all automation** master kill (forge + provisioning). |
| **MCP** | `automation_status` (read-only, tbj-mcp v2.28.0) | "Is money spend automatic, and who's waiting for a line?" |
| **Read path** | `src/lib/auto-provision.ts` → `getAutoProvisionStatus()` | Derived spend (voice_lines in the last 7d), mirrors `getForgeDigest`. |

**What flipping it on takes (operational, not code):** set `VOICE_WEBHOOK_KEY` in Vercel, then in
`/command/engine` flip **Auto-provision → Automatic** and set the cap. The drain poller is already
installed and inert until then. Until you flip it, every paid voice customer queues and pings
Telegram, and you run `node scripts/retell/provision-line.mjs --site N --apply` by hand.

**Deferred (goal b of Phase 4):** serving Ivy's *sales* dynamic-variables from `/api/voice/inbound`.
It needs her live static prompt reworked to consume `{{variables}}` — an outward-facing change to the
live phone line — so it stays a deliberate TODO. Phase-4 *persistence* (her calls now save under the
internal TBJ site) shipped; see `scripts/db/2026-07-20-ivy-tenant.sql`.

## The abuse question, closed

The scenario that made money-spend-manual the right default was: *a bot floods the form and triggers
500 expensive builds / 500 phone numbers overnight.*

Under this pipeline that **cannot happen**, because:

1. A form submit triggers a **login**, not a build. Bots make empty accounts (spam, not spend).
2. Every outbound spend is **post-payment**. No payment, no build, no number.
3. Payment is a real card + a real human. 500 fraudulent payments is a Stripe-fraud problem with its
   own controls, not a runaway-automation problem.
4. Even post-payment, the `auto_provision` cap and `forge_engine` budget bound the worst case to a
   number **you set**, and breaching it pauses + alerts rather than draining.

Manual stays the default. Automatic is a switch you flip, bounded by a cap you choose, with a kill
switch that stops everything. That is the full vision, on rails.

---

## Docs to update as phases land

[`FORGE.md`](./FORGE.md) (build trigger moves claim → payment) · [`VOICE.md`](./VOICE.md) +
[`VOICE_ONBOARDING.md`](./VOICE_ONBOARDING.md) (auto-provision path) ·
[`ACQUISITION_SYSTEM.md`](./ACQUISITION_SYSTEM.md) (the funnel) · [`README.md`](./README.md) index ·
the full-stack rule in [`AGENTS.md`](../AGENTS.md) applies to every phase (UI + MCP tool + schedule).
