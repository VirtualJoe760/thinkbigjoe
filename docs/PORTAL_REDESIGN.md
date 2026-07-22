# Portal Redesign — voice-first, Ivy-driven

> **Status**: PLAN (2026-07-20), now mostly SHIPPED — see the **2026-07-22 status addendum** at
> the bottom. Phases 2–4 done, Phase 5 landed, Phase 1 partial; the portal has since grown an OS
> shell this plan predates.
> **Owner**: Joseph Sardella · Companion to [`AUTOMATION_PIPELINE.md`](./AUTOMATION_PIPELINE.md)
> and [`BUSINESS_PLAN.md`](./BUSINESS_PLAN.md).

The sales model moved from website-first to **voice-first**. The portal still reads website-first.
This aligns it: the AI receptionist is the product, everything is set up by **calling Ivy**, the
website is a separate one-time purchase, and the admin can review Ivy's own calls.

---

## What the audit found (live pages, 2026-07-20 — historical snapshot; see the status addendum for what shipped)

| Page | Today | Problem |
|---|---|---|
| **Overview** `/portal` | Cards grouped YOUR SITES → YOUR AI → CLIENT. Sites lead. | Website-first ordering. "Build a site", "Build your agents", "Set up receptionist" are all forms/links, not Ivy calls. |
| **Billing** `/portal/billing` | "Every plan is a one-time **$250 build** plus a monthly subscription." Tiers: Website / Website+Voice / Complete. Website build $250 "unlocks your subscription". | The $250 build fee is **coupled** to the subscription and presented as the website price. Tiers are web-named. Buying a site is not decoupled. |
| **Receptionist** `/portal/receptionist` | A long **setup form** (services, hours, greeting, two phone fields, FAQs…). | To be deleted — setup happens by calling Ivy now. |
| **Dashboard** `/portal/dashboard` | "Your AI receptionist" — value stats + feedback (built this session). | Shows **all zeros for ThinkBigJoe** even though Ivy takes real calls: Ivy's line was never wired to persist into `calls`. |
| **Build a site** `/portal/build` | A form. | → call Ivy. |
| **Agentic** `/solutions` | Marketing/explainer. | The "Build your agents" entry → call Ivy. |

---

## Decisions locked (from Joe, 2026-07-20)

1. **The three "make something" pages become call-Ivy flows** — Build a site, Build agents, Set up
   receptionist. Fresh user → a simple "call Ivy about this" page. Existing customer → a "call Ivy
   to change/add" header with the **dashboard below** (calls, appointments, transcripts). Ivy's
   *structured* intake (capturing the request into the DB) is a **later** phase; for now the page is
   a clean call CTA and Ivy discusses it.
2. **Ivy's own calls must be reviewable by the admin** — do **both**: (a) pull Ivy's call log +
   transcripts live from Retell's API, and (b) make ThinkBigJoe a tenant so her calls persist going
   forward. Plus the **site editor should work on thinkbigjoe.com's** front-facing site.
3. **Website = separate one-time purchase**, fully decoupled from the voice subscription. The $250
   on the page is the setup/build fee, not a website price — that coupling goes away.

---

## Build plan (phased, each shippable)

### Phase 1 — Billing: decouple + voice-first *(highest clarity win, contained)*
- Split billing into **two independent things**: a **Subscription** section (the monthly voice
  plans, which is what "Billing" is *for*) and a separate **Buy a website** one-time purchase.
- Remove the "$250 build unlocks your subscription" coupling — a voice subscription no longer
  requires buying a build first.
- Reframe tier display names voice-first (the receptionist is the hero; the website is the add-on).
  Keys in `src/lib/plans.ts` stay `website`/`voice`/`complete` for continuity; only display changes.
- Fix the $250 label: it's the **setup fee**, shown with the thing it sets up, not as the website's
  price. Website's own one-time price is a separate line (Joe to set the number).
- Files: `src/app/(frontend)/portal/billing/**`, `portal/actions.ts` (`startCheckout`),
  `src/lib/plans.ts` (display only). Stripe already has the prices.

### Phase 2 — Receptionist page = call Ivy + dashboard
- **Delete the setup form** (`/portal/receptionist` + `receptionist-form.tsx`). Setup is a call now.
- Make `/portal/dashboard` (already "Your AI receptionist") the single receptionist surface:
  - **Fresh user** (no line): a clean "Call Ivy to set up your receptionist" panel — the number,
    what to expect, ~5 minutes.
  - **Existing customer**: a "Call Ivy to make changes or add a receptionist" header, then the
    dashboard (calls, appointments, transcripts, feedback) below — the layout Joe described.
- Add **transcript access** to the dashboard rows (the full transcript already lives on the call;
  `/portal/calls` expands it — bring that into the dashboard or link through).
- Point the overview's "Set up the voice receptionist" card here.
- Files: `portal/dashboard/**`, delete `portal/receptionist/**`, nav in `portal-header.tsx`.
  *(Shipped: form deleted, routes kept as redirect stubs; per-page nav superseded by the
  PortalShell rail — see addendum.)*

### Phase 3 — "Build a site" and "Build agents" → call Ivy
- Both become simple call-Ivy pages (fresh-user shape from Phase 2). Replace the site-build form and
  the agents entry with "call Ivy about a website / about custom agents" panels.
- Overview cards repoint. `/portal/build` and the agents link become call CTAs.

### Phase 4 — Ivy's own calls (make TBJ a tenant + Retell backfill)
- **Persist going forward**: give ThinkBigJoe a `voice_lines` row for 480-764-2121 and set the
  inbound webhook, so Ivy's future calls flow into `calls` like a customer's and the dashboard fills.
  Caveat: Ivy is a sales concierge, not a receptionist, so some "leads captured" framing fits
  awkwardly — the dashboard copy may need an admin/TBJ variant.
- **Backfill history**: a read path that pulls Ivy's past calls + transcripts from Retell's API for
  the admin view, so "review what the caller said" works for calls that predate the tenant wiring.
- Files: new `voice_lines` row (script/DB), a Retell-calls read lib + an admin surface on the
  dashboard.

### Phase 5 — Site editor on thinkbigjoe.com *(its own effort — see [`PLATFORM.md`](./PLATFORM.md))*
- Make the front-facing thinkbigjoe.com marketing site editable through the portal editor. This is
  the "marketing site → forge template" work already scoped in PLATFORM.md Phase 1 (the OKLCH-token
  vs fixed-hex mismatch is the known blocker). Kept separate because it's a platform change, not a
  portal-copy change. **Update 2026-07-22: landed** — the FOH adopted the forge token contract and
  portal edits now apply to thinkbigjoe.com through the same edit-requests → edit-poll loop
  (internal-repo branch).

---

## Recommendations beyond the directives (from the audit)

- **Reorder the overview voice-first.** Today YOUR SITES leads and YOUR AI follows. Flip it: the
  receptionist is the product a customer pays for, so it should be the first thing they see; sites
  are the optional add-on.
- **Drop "7 days free" from Build-a-site** if the website is now a paid one-time purchase — the copy
  contradicts the new model.
- **A fresh customer sees the same shape everywhere:** one consistent "call Ivy about X" panel
  (number, what to expect, minutes) reused across receptionist / site / agents. Build it once.
- **The dashboard is the front door** — consider making it (not the current Overview) the default
  `/portal` landing for a non-admin customer, since it's the thing they open daily.

---

## Docs to update as phases land

[`VOICE.md`](./VOICE.md) (Ivy as a tenant, admin call review) · [`EDITOR.md`](./EDITOR.md) +
[`PLATFORM.md`](./PLATFORM.md) (Phase 5) · [`BUSINESS_PLAN.md`](./BUSINESS_PLAN.md) (website as a
decoupled purchase) · [`README.md`](./README.md) index. Full-stack rule applies per phase.

---

## Status addendum — 2026-07-22

This doc was the 2026-07-20 plan. Most of it shipped within two days, and the portal then grew a
design the plan never described. The plan text above is kept as the historical record; current
truth:

| Phase | Status |
|---|---|
| 1 — Billing decouple | **Partial** — $250 reads as the receptionist **setup fee** (`billing/page.tsx`, `site-billing.tsx`: "NOT a website — separate call-Ivy purchase"). Still open: tier display names are web-named (`plans.ts`: "Website", "Website + Voice") and billing has no explicit "Buy a website" purchase — a site is bought by calling Ivy (`/portal/build`). |
| 2 — Receptionist = call Ivy | **DONE** — setup form deleted; `/portal/receptionist` (+ `[id]`) are redirect stubs to the dashboard, which is now the **Scoreboard**. |
| 3 — Build site/agents → call Ivy | **DONE** — `/portal/build` is a CallIvy page; the overview's "Build your agents" card points at `/portal/agents`. The shared panel was built once: `src/components/portal/call-ivy.tsx` (used on build/dashboard/knowledge/agents). |
| 4 — Ivy as tenant + Retell review | **DONE, both halves** — `scripts/db/2026-07-20-ivy-tenant.sql` gives +14807642121 a `voice_lines` row on the internal TBJ site (`forge_sites.is_internal`); admin-only `IvyCalls` on the Scoreboard reads live from Retell (`src/lib/retell-calls.ts`). The anticipated "admin/TBJ dashboard copy variant" was solved by exclusion instead: customer surfaces filter `isInternal`, so Ivy's sales calls never render as a customer receptionist. |
| 5 — Editor on thinkbigjoe.com | **LANDED** — the OKLCH-vs-hex blocker is resolved: the FOH adopted the forge token contract (`src/app/(frontend)/globals.css` `--brand-h`/`--brand-c`, Roboto stacks), `/api/edit-requests` emits internal-site instructions (`route.ts` `internal` branch), and edit #4 was applied to the front of house via the forge's edit-poll on a branch of this repo. |

### What the plan never described — the portal OS shell (2026-07-21/22)

The portal grew past this plan into an OS shell: `src/components/portal/portal-shell.tsx` —
content left, **nav rail on the RIGHT** (house style), the customer's website pinned to the rail
as a card, `?site=` carried across tabs. Rail tabs: **Scoreboard** (`/portal/dashboard` — impact
score, value tiles, call receipts with outcome chains), **Calls**, **Knowledge**
(`/portal/knowledge` — `receptionist_config` shown read-only via `TENANT_DEFAULTS`/`deriveRouting`;
changes happen by calling Ivy), **Agents** (`/portal/agents` — roster from `plans.ts` `AGENTS`,
Ivy as the first employee card, honest "rolling out / coming soon" chips), **Calendar**,
**Billing**. The shell wraps Scoreboard/Knowledge/Agents today; Calls/Calendar/Billing still
render under the legacy `portal-header.tsx` navbar (applied globally by `portal/layout.tsx`).

### Command is a ring

(The section `portal-shell.tsx` cites.) One shell, three rings: **Ring 1** — the customer portal,
i.e. the shell above, listing every surface a customer has today. **Ring 2** — grows in at the
Agents tab: each new customer-facing agent becomes a card on that roster (see
`AGENT_PLATFORM.md` for what gates tiers 2–3). **Ring 3** — Joe's `/command/**` modules stay
behind `isAdmin` and migrate into this same shell later.

### Still open (from the original recommendations)

- Overview still leads with "Your sites" (`portal/page.tsx` — "Your AI" comes second); the
  voice-first reorder didn't happen.
- `/portal` overview is still the default landing; Scoreboard-as-front-door is unimplemented.
- Phase 1 leftovers above (voice-first tier display names, an explicit website purchase).
