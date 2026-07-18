# PLATFORM.md — the forge as a composable full-stack platform

**Status: PLANNING → Phase 0 in progress (2026-07).** This is the living roadmap for a large,
multi-repo effort: evolve **the forge** (`~/code/webdev-templates`) from a static-marketing-site
generator into a system that composes optional **full-stack "plugins"** (auth, billing, database,
customer portal, admin panel) onto generated client sites — and make **thinkbigjoe itself** the
reference "kitchen-sink" app that those plugins are extracted from.

Read this before starting any work on: turning the public marketing site into a forge template,
extracting auth/billing/db/portal/command into reusable modules, or the app-side foundation
refactor (shared UI primitives, directory reorg, dead-code pruning). Cross-refs:
[FORGE.md](FORGE.md) (build/deploy pipeline + token contract), [EDITOR.md](EDITOR.md) (the
token-first site editor this unlocks for our own site), [AUTH.md](AUTH.md) (the auth/billing/DB
mechanics being plugin-ized).

---

## The vision (in one paragraph)

Today the forge builds **brochure sites** — static Next.js apps, no backend. Meanwhile the
thinkbigjoe app is a **monolith** that bundles a marketing site + a customer portal + an admin
command center + auth + Stripe billing + a database. The goal is to **decompose the monolith into
plugins the forge can compose**: a base site (marketing) is the default; auth, billing, a
database, a portal, and an admin panel are opt-in capabilities declared per-site. Then a future
client who needs "a site **with** logins and payments" is a forge build with
`plugins: ["auth","billing","db","portal"]`, not a bespoke project. thinkbigjoe is both the first
customer of this system and the source the plugins are carved from.

## Locked decisions (from Joe, 2026-07)

- **Sequence: Phase 0 (app-side foundation refactor) first.** Clean the house before extracting
  from it.
- **Near-term forge focus: the public marketing site becomes a forge template.** That is the
  first thing to land in the forge. Auth + backend-as-plugins come *after*.
- **One step at a time.** Small, independently-shippable, reviewable steps — not a big-bang PR.
- **thinkbigjoe stays one app for now** (kitchen-sink reference). We extract reusable pieces
  *into* the forge; we do not (yet) re-platform the live command center / portal / billing onto
  forge output. Revisit once the plugin model is proven.

## Two load-bearing facts (discovered 2026-07, drive the whole plan)

1. **A full-stack template already exists, shelved.** `~/code/webdev-templates/templates/backend-service-business/`
   is a complete Next.js app — Neon + Drizzle + **Better Auth + Stripe + Resend + a server-side
   auth-gated `/admin` panel + zod server actions** — all lazy-initialized so it builds with no
   live creds. It is **not** in `templates/registry.json` and nothing uses it. It is a **monolith**,
   not composable plugins, but it proves the entire stack works inside the forge monorepo. **This is
   the reference implementation** for the plugin work — we refactor it, we don't start from zero.
2. **Every shipping forge site is static/brochure-only.** No `app/api/**`, no server actions, no
   DB, no env vars; deps are just `@webdev/ui, next, react, react-dom, lucide-react`. So the plugin
   vision has a real **deploy delta the forge has never done**: per-site Neon provisioning + env-var
   injection + running migrations. `factory/deploy-vercel.mjs` sets **zero** env vars today. This is
   the long pole of the full-stack work (Phase 3).

## The token-contract gap (why our own site isn't editable yet)

The site editor ([EDITOR.md](EDITOR.md)) works by moving `@webdev/ui`'s **OKLCH hue-driven**
design tokens (`--brand-h`, `--brand-c` → generated `--color-brand-50…950` ramps; roles like
`--color-foreground`, `--color-muted-foreground`, `--color-card`, `--color-border`). The
thinkbigjoe app uses a **different, fixed-hex** token system (`--brand: #0047ff`, Tailwind v4
`@theme`, roles `--color-ink`/`--color-surface`/`--color-brand-tint`, Jost font) — see
`src/app/(frontend)/globals.css`. Its marketing home is **5 bespoke components**
(`Hero/Services/Approach/HowItWorks/ContactCTA` + nav/footer), none from `@webdev/ui`.

So "edit thinkbigjoe.com with our own editor" ≠ an auth change (as admin, `site-proxy` already
lets Joe in). It requires **re-expressing the marketing site on the `@webdev/ui` token contract** —
that is Phase 1.

## The plugin model

A generated site declares capabilities in `business.json` (the existing content-injection channel,
alongside `theme_overrides` / `preferred_template`), honored by the forge selector + `forge-build`
prompt + `deploy-vercel`:

```jsonc
{ "plugins": ["auth", "db", "billing", "portal"] }   // base marketing site is plugins: []
```

Extraction map (source → plugin), easiest first:

| Plugin | Extracted from (thinkbigjoe) | Notes / difficulty |
|---|---|---|
| `ui-primitives` | `<AppHeader>` pattern + a new Card/Panel/Badge/Field/StatusPill set | Low. Kills ~300 duplicated card blocks. Pure win. |
| `auth` | `src/lib/auth*`, `admin.ts`, `require-admin.ts` | Medium. Clean core, but ~55 files import the session directly and **8 bypass it with raw `better_auth."user"` SQL** — needs an accessor layer (`getUserById/getUserEmail`) first. |
| `billing` | `src/lib/stripe.ts` + `plans.ts` | Medium. Clean + env-driven, but state lives as ~8 columns on the `forge_sites` god table — needs its own `subscriptions` table. Checkout logic is buried in `portal/actions.ts`. |
| `db` | `src/db/*` | Medium. Blocked by the **89-column `forge_sites` god table** (mixes prospecting/outreach/claim/billing/voice/editor state). Clean boundaries need it decomposed. |
| `portal` / `admin` | `portal/**`, `command/**` + their two mega action files | High. Split the action files along plugin lines first. `backend-service-business/app/admin` is the reference admin panel. |

## Roadmap (phased, lowest-risk / highest-value first)

Mirrors the discipline that worked for the editor (small ordered PRs). **Phase 0 is app-side only —
nothing in the forge changes yet, nothing can half-fail.**

### Phase 0 — Foundation refactor (this app) — *in progress*

Ordered, each independently shippable:

| Step | What | Risk | Serves | Status |
|---|---|---|---|---|
| **0.1** | **This roadmap doc** (+ index entry) | none | anchors the effort | ✅ `f93fbb7` |
| **0.2** | **Consolidate the marketing surface** — move the bespoke marketing components into `src/components/marketing/`; tidy the flat `src/components/` dir | low | Phase 1 (clean unit to extract) + cleanup | ✅ `431553a` (9 comps moved, tsc-clean, renders) |
| **0.3a** | **Prune dead files** — `pricing.tsx`, `prospect-recon.ts`, 5 create-next-app starter SVGs | low | shrinks surface | ✅ `139805d` (adversarially audited) |
| **0.3b** | **Prune dead exports** — 9 verified-dead lib exports (tsc-gated). **NOTE:** `analysisToBusinessJson` (site-analyzer.ts) is *kept* — it's commented "for a future send to forge," i.e. staged for this very platform | low | shrinks surface | ⏸ deferred (awaiting go/no-go — low value, judgment-heavy) |
| **0.3c** | **Retire dead subsystems + fix stale docs** — delete `macmini-runner/`, `vps-sentinel/`; the `linkedin-sender`/`windows-sender` dirs are already gone but their docs (`docs/README.md:108`) + `.gitignore` lines are stale | med | cleanup + fixes doc-drift | ⏸ deferred (product/infra + doc-protocol call) |
| **0.4** | **Shared UI primitives** — `Card/Field/Badge/StatusPill/StatTile/SectionHeading` in `src/components/ui/` (button.tsx recipe: lookup tables + `*Class()` helper + component) | med | `ui-primitives` plugin + future portal/admin plugins | 🟡 primitives complete (`3226797`, `2fbdc08`; 7 primitives + barrel). **Command fan-out done** (`5bcffd0`: 9 admin surfaces → Card/cardClass/StatGrid, every change verified className-equivalent, green `pnpm build`). Remaining: **portal + marketing fan-out** (conservative pass); **`leads-crm.tsx`/`leads/page.tsx`** (blocked on Joe's WIP commit); **StatusPill consolidation** (see note); `Field` adoption. |
| **0.5** | **Route-group separation** — split `(frontend)` into `(marketing)` / `(portal)` / `(command)` so the tree reflects the plugin boundaries (URLs unchanged) | med (touches many imports) | every later phase | ⬜ not started |

**StatusPill consolidation (deferred, deliberate):** unifying the ~6 ad-hoc CRM status-color maps into
the one canonical `StatusPill` vocabulary is *not* className-equivalent — the canonical table uses
`-50/-700` shades, while several existing maps use `-100/-800`. So it's a real (minor) **visual
normalization**, admin-only. Doing it one-file-at-a-time would make pills inconsistent across the CRM,
so it should land as one coherent pass over all the maps at once, with sign-off on the shade change.

**Excluded from the prune by judgment (verified, but *not* deleted):** `src/db/relations.ts` (regenerated by `db:pull`), `command/sites/sites-queue.tsx` (still imported by 3 live pages — the route is gone but the component is shared), and env-gated public assets (`audio/*.mp3` via `DROPCOWBOY_AUDIO_URL`, `joe-avatar.png` possibly in a Zoho signature, 5 of 6 `templates/*.jpg` are valid template ids staged for previews).

### Phase 1 — The marketing site becomes a forge template

Re-express thinkbigjoe's marketing site on the `@webdev/ui` token contract and land it as a new
template (a new "agency" design language) in `templates/` + `registry.json`. Outcome: thinkbigjoe.com
is editor-editable (Brand mode + click-to-edit work), and the agency look is reusable for other
clients. Open sub-decision (defer to Phase 1): rebuild on stock `@webdev/ui` sections vs. port the
bespoke components into the UI package as new variants.

### Phase 2 — Plugin-ize the full stack

Refactor `backend-service-business` from monolith → composable `auth` / `db` / `billing` / `admin`
modules. Add `plugins: []` to `business.json` + the forge selector + `CLAUDE.md` build rails (which
already say "never touch backend plumbing if present" — the rails anticipate this).

### Phase 3 — The deploy delta

Per-site Neon provisioning, env-var injection, and migrations in `deploy-vercel.mjs`. Prove the
whole thing end-to-end by generating one real full-stack client site.

## Docs protocol

Update this doc when a phase advances or a locked decision changes. When Phase 1 lands, update
[FORGE.md](FORGE.md) (new template + `plugins` field) and [EDITOR.md](EDITOR.md) (our own site is
now editor-editable). When the plugin model ships, revisit the "Locked decisions" section. Keep the
"Two load-bearing facts" current — if `backend-service-business` gets wired in or the deploy delta
is solved, say so here.
