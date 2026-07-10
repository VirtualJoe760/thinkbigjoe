# EDITOR.md — the customer site editor (token-based, modular)

**Status: part current, part design-spec.** The "What exists today" section is live behavior.
The "Target architecture" section is the **modular token-first editor we're building toward** — not
yet shipped. Anything under Target that isn't corroborated by a file path + "(today)" is a plan, not
current behavior. Roadmap phases at the bottom track the gap.

This is the doc for the **`/portal/edit/[id]` editing experience** a customer uses to change their
built site: the **Site** tab (inline editor), the **Studio** tab (image/logo generator), and the
**Design** tab (template gallery). If you're touching any of those, `public/editor.js`, the
`edit_requests` apply loop, or the theming/token system, read this first.

---

## The one principle

**One token contract — edited live, persisted per-site, honored by every template.**

The forge templates already share a single design-token contract (see below). The editor's job is to
let customers move **those tokens**, not to paint individual elements. Because the theme lives at the
token layer:

- A change to "primary color" moves one hue variable that **every** template reads → the whole
  component library recolors harmoniously (OKLCH scales do the work).
- The saved theme is **template-agnostic**: brand (palette + fonts) and layout (template) are
  independent knobs. Surf to a different template in the Design tab and the customer's brand carries
  over automatically, because every template consumes the same tokens.
- Customers **can't randomly break the design** — the default steers them to a constrained palette;
  per-element overrides exist but are the advanced escape hatch, not the front door.

Everything below serves that principle.

---

## The token contract (the forge templates — today)

Defined in **`~/code/webdev-templates/packages/ui/src/styles/globals.css`** (`:root`), OKLCH and
**hue-driven**, so one variable recolors a whole scale:

| Role | Drives | Tokens it generates |
|---|---|---|
| **Primary** | `--brand-h` (hue), `--brand-c` (chroma) | `--color-brand-50…950`; `--color-brand` = `brand-600` |
| **Secondary / accent** | `--accent-h` | `--color-accent-300…500`; `--color-accent` = `accent-500` |
| **Neutrals** | `--neutral-h`, `--neutral-c` | `--color-neutral-50…950` |
| **Semantic roles** | (reference the scales) | `--color-background`, `--color-foreground`, `--color-muted(-foreground)`, `--color-card(-foreground)`, `--color-border`, `--color-ring` |

Fonts are template-level families (a primary display + a body). Radius/spacing are token-scaled too.

**Why this matters for the editor:** "change the primary color everywhere" = set `--brand-h`. That's
the entire mechanism. The editor should expose these named roles as **Primary / Secondary / Neutrals
/ Background + a small text-shade set / Primary font / Secondary font** — nothing more, nothing raw.

---

## What exists today

### The three tabs (`src/app/(frontend)/portal/edit/[id]/`)
- **`edit-workspace.tsx`** — the tab shell (Site / Studio / Design) + a "Done" link. Gated upstream by
  owner + `trialStatus(site).canEdit` (see [`../src/lib/trial.ts`](../src/lib/trial.ts)); a
  trial-ended, unpaid site bounces to `/portal?locked`.
- **Site** → an iframe of `/api/site-proxy/[id]` (the live site served from our origin with the
  editor injected).
- **Studio** → `image-studio.tsx` (generate/edit a logo/hero image).
- **Design** → `template-gallery.tsx` (pick a different template → `preferredTemplate`).

### The inline editor (`public/editor.js`, ~384 lines, vanilla JS)
Injected into the proxied site by **`src/app/api/site-proxy/[id]/route.ts`** (which strips the site's
own scripts, injects `<base>` + `window.__TBJ_EDIT` config + `editor.js`, and injects a few CSS
variables). On element click it opens a panel with **per-element** controls: Text, Text color, Button
color, image replace/generate, Note. Edits are collected client-side with an Undo history, then
POSTed as a batch.

### The apply loop (real — the Site tab genuinely changes the site)
`editor.js` → **`POST /api/edit-requests`** → stored as markdown on the **`edit_requests`** table →
the forge's **`factory/edit-poll.mjs`** (cron, ~every 5 min) applies each batch to the site source and
redeploys. Surfaces as the **"Customer edit queue"** on `/command/engine`.

### Known gaps (why we're redesigning)
1. **Per-element, not modular.** `editor.js` writes inline `style.setProperty('color', …, 'important')`
   — it fights the token system instead of using it. A customer edits "that one button," not "primary."
2. **The Studio dead-ends at Download.** `image-studio.tsx` can generate a great logo but has **no
   "apply to my site"** action; `/api/generate-image` returns a data URL and persists nothing. (See
   Roadmap — this needs a save+apply path too.)
3. ~~**Desktop-only.**~~ **✅ Fixed (Phases 1–2).** The Site editor is now a bottom sheet with
   tap-select on phones; the Studio (canvas strip + segmented nav) and Design gallery (swipe
   carousel + full-screen preview) are mobile-first. Desktop layouts unchanged.

---

## Target architecture (the modular token-first editor)

### 1. Token-first editing in `editor.js`
- A **Brand / Theme panel** reads the site's current tokens and edits the **named roles** — Primary,
  Secondary, Neutrals, Background, a small text-shade set, Primary font, Secondary font. Each control
  live-previews **instantly** by setting the CSS variable on the iframe `:root` (no rebuild).
- **Element-click → token detection.** Clicking an element resolves its computed style to the nearest
  token (e.g. a button whose background computes to `--color-brand` → *"This is your **Primary
  button**."*). The primary action edits **that token** (global); a clearly-secondary **"just this
  element"** control is the escape hatch.
- **Idiot-proofing.** Choices are palette-constrained; OKLCH lightness gives automatic contrast
  safety; per-element overrides are visually demoted and reversible.
- **Undo/revert.** Token-aware, global, and obvious — one tap to undo the last change, one to reset to
  the site's saved theme.

### 2. Apply & persist (stays in the ecosystem)
- **Live:** token edits set CSS vars on the proxied iframe's `:root` — instant, free, no forge run.
- **Persist:** the saved theme is a **per-site token override** (the brand/accent/neutral hues +
  font choices + any semantic overrides), stored on the site and **injected into `:root` by the forge
  on every build** — so it survives rebuilds *and* template swaps. Element-level overrides persist
  alongside as the existing `edit_requests` markdown.
- Net: brand changes are a cheap, durable **theme override**; structural/content changes remain the
  `edit_requests` → `edit-poll` path.

### 3. Mobile-first (all three surfaces)
- Editing panel becomes a **bottom sheet** (not a mouse-positioned popover), large tap targets, a
  thumb-reachable tab bar.
- **Template surfing on mobile**: swipe/scroll the Design gallery, preview a template full-screen,
  apply — brand carries over via the token contract.
- `editor.js`'s own injected UI must be mobile-responsive **and** isolated so it can't collide with an
  arbitrary customer site.

---

## Roadmap

Four ordered, independently-shippable PRs, **lowest-risk / highest-value first**. Phases 1–2 are pure
front-end (nothing can silently half-fail); the token system lands in 3–4. **Build Phase 1 first** — a
solid mobile chrome is the foundation every later panel renders into, and it front-loads the single
biggest execution risk (the scoped `all:revert` reset that protects our injected UI from arbitrary
host-site CSS).

| # | Phase | Effort | What ships |
|---|---|---|---|
| **1 ✅** | **Bottom-sheet + touch editor** *(shipped)* | L | `editor.js` v4: scoped `all:revert` on our chrome so host CSS can't break it; `openPanel`/`openSectionPanel` become a **bottom sheet** under `max-width:640px`/`hover:none` (desktop popover kept); `pointerover` hover-select → **tap-select** with a flash; 44px targets; safe-area insets. `site-proxy` injects a viewport meta if missing. `edit-workspace.tsx` gets a fixed bottom tab bar on small screens. **Payload unchanged** — zero backend risk. |
| **2 ✅** | **Mobile Studio + Design surfer** *(shipped)* | L | `image-studio.tsx`: sticky ~40vh canvas, section groups as a one-at-a-time segmented sub-nav, pinned Generate/Download bar. `template-gallery.tsx`: scroll-snap **carousel** of large cards + page dots, full-screen Preview sheet + sticky Apply bar (grid on larger screens). Swipe-surf templates on a phone. |
| **3a ✅** | **Token palette editor + instant preview** *(shipped)* | L | `editor.js` **🎨 Brand mode**: Primary + Secondary color pickers (pre-filled from the site's real tokens via a `getImageData` rasterize so `oklch()` reads correctly) + 10 curated font pairings; live-preview by setting `--brand-h`/`--brand-c`/`--accent-h`/`--font-*-stack` on the iframe `:root`; custom `hexToOklch`. Single `kind:'token'` edit per batch (Apply replaces, Undo/Reset reconcile). `/api/edit-requests` renders a "move the design tokens" markdown branch (+ `next/font` family spec). `site-proxy` versions `editor.js?v=<mtime>` so updates aren't cached stale. **The forge applies it via the existing `claude -p` loop for now** — 3b makes it deterministic. |
| **3b ✅** | **Forge deterministic theme fast-path** *(shipped — forge repo, `a98e9ee`)* | M | `edit-poll.mjs`: a **color-only token edit skips `claude -p`** — `applyThemeTokens()` writes/replaces a fenced `TBJ-THEME` `:root` block at the end of the site's `app/globals.css` (last + unlayered → overrides the template's `:root`; values clamped + injection-safe). **Font** changes still route to the LLM (proper `next/font` wiring). Review-driven pipeline fixes: deploy is gated on a real commit+push (never reports "applied" after a failed push; skips the no-op re-apply), and the LLM prompt knows about the managed block. Writer unit-tested. *(Committed on the forge branch, not pushed — the poller runs the working-tree file.)* |
| **4** | **Durable theme persistence** | L | New `forge_sites.theme_overrides` jsonb (via `npm run db:pull` — don't hand-edit schema). `/api/edit-requests` upserts it immediately so the proxy shows the saved theme on reopen; `site-proxy` emits a `<style>` **after** the site CSS + the font link; `edit-poll` regenerates the fenced block from the DB JSON on **every** apply (idempotent, rebuild-proof). Portal surfaces a `failed` edit-request status so a customer knows if their theme isn't live on the public URL yet. **Revert = easy undo.** |

### The persistence mechanism (Phases 3–4)
A theme edit is a **pure CSS-variable swap**: preview instantly via `documentElement.style` in the
iframe → persist as a `forge_sites.theme_overrides` jsonb row (DB is source of truth) → apply as a
deterministic string-merge into a **fenced `TBJ-THEME` block** in `globals.css`, **no `claude -p`
run**. Element/section edits remain the `claude -p` escape hatch, coexisting in one `edits` batch
tagged with `kind`.

### Open decisions (resolve before/at each phase)
- **Curated font list (before Phase 3):** `next/font/google` needs a static import per font at build
  time — so fonts are a **curated set** (~10–15 pairings the forge imports); free-text falls back to
  `claude -p`. Joe picks the set.
- **Lossy hex→OKLCH-hue:** the previewed primary won't *exactly* match a picked hex swatch. Frame it
  as "we build a matching palette," or offer a raw-hex escape hatch? (Confirm exact-hex needn't be honored.)
- **Preview vs deployed font:** the proxy's Google-Fonts preview differs slightly from the self-hosted
  `next/font` deploy — accept with a note, or match the source?
- **Instant-persist gets ahead of the public site:** if a build fails, proxy and public URL diverge
  until retried — the portal must surface the `failed` status (Phase 4 does this).
- **`edit_requests.kind` reuse vs a new `theme_only` boolean** — confirm current column semantics first.
- **Notched-phone safe-area:** two stacked bottom bars on the Site tab can double-consume the inset —
  coordinate offset/z-index, or hide the app tab bar while the Site editor is active?
- **Design-tab live preview** exists only for the ~5 templates with preview URLs; the rest fall back
  to a screenshot. Acceptable for launch, or generate preview URLs for the full set first?

---

## Docs protocol

Update this doc when you change: `public/editor.js`, the `/api/site-proxy` injection, the
`edit_requests` / `edit-poll` apply loop, the Studio/Design tabs, or the forge token contract in
`packages/ui/src/styles/globals.css`. Cross-refs: [FORGE.md](FORGE.md) (build/deploy + the token
system's repo), [VENUS_UI_MAPPING.md](VENUS_UI_MAPPING.md) (the `/portal/edit` surface), and
[SHOWROOM.md](SHOWROOM.md) (previews use the same token contract).
