# EDITOR.md — the customer site editor (token-based, modular)

**Status: SHIPPED (Phases 1–4, 2026-07).** The token-first modular editor + mobile-first surfaces
are live. The "Target architecture" section below is now the built design (see the Roadmap table for
the phase→commit map); the "What exists today" notes predate the build and describe the starting
point. When in doubt, the file paths are authoritative.

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
- **Studio** → `image-studio.tsx` (generate/edit a logo/hero image). Asset types, prompt fragments, and
  the per-type trim/pad + quality gates come from [`../src/lib/logo-spec.ts`](../src/lib/logo-spec.ts) —
  the browser twin of the forge's `factory/logo-fix.mjs`. Spec: [`LOGOS.md`](LOGOS.md). On a phone in
  **portrait** it shows a *rotate-to-landscape* prompt (the canvas needs width; web can't force
  rotation), and the controls panel is **collapsible** (a "Hide ⟩ / ⟨ Controls" toggle) so the canvas
  can take the full width.
- **Design** → `template-gallery.tsx` (pick a different template → `preferredTemplate`).

### The inline editor (`public/editor.js`, vanilla JS)
Injected into the proxied site by **`src/app/api/site-proxy/[id]/route.ts`** (which strips the site's
own scripts, injects `<base>` + `window.__TBJ_EDIT` config + `editor.js`, and injects a few CSS
variables).

**Intent-first tool tiles.** Clicking an element opens a panel of **square tool tiles** contextual to
the element — text/heading → **Text · Size · Color · Request**; button → Text · Color · Size · Request;
image/graphic → Image · Request. Tapping a tile reveals only that tool's controls (with a `‹` back to
the grid), so the panel is never a wall of inputs. Tools:
- **Text** — edits the element's full text (not the truncated label).
- **Size** — A−/A+ steppers (×1.1, 8–200px) → per-element `font-size`, with a Reset.
- **Color** — text/button color, with the **reframed scope control** ("Apply to: *Everywhere it's
  used* / *Just this*") — "everywhere" moves the design token (recolors every use), "just this" is a
  per-element override. Replaces the old confusing "All body text / Just this" toggle.
- **Request** — a free-text note the forge/team applies.
- **Image** — upload or AI-generate a replacement (image/graphic elements).

**Preview → Approve / discard, everywhere.** Every panel previews live; a primary **"Approve changes"**
commits to the `edits[]` batch (surfaced by the bottom "Send N edits →" bar); **X / Cancel discard** —
they revert the preview so nothing is saved unless approved. This holds across the element, **brand**
(`openBrandPanel` snapshots `openTheme` on open; `discardBrand()` reverts the live theme to it), and
section panels. Edits carry an Undo history and are POSTed as a batch.

### The apply loop (real — the Site tab genuinely changes the site)
`editor.js` → **`POST /api/edit-requests`** → stored as markdown on the **`edit_requests`** table →
the forge's **`factory/edit-poll.mjs`** (cron, ~every 5 min) applies each batch to the site source and
redeploys. Surfaces as the **"Customer edit queue"** on `/command/engine`.

### Known gaps (why we're redesigning)
1. ~~**Per-element, not modular.**~~ **✅ Fixed (Phase 3).** `editor.js` now has a **🎨 Brand mode**
   that edits the tokens (Primary/Secondary/fonts) — "change primary everywhere," live-previewed. The
   per-element controls remain as the escape hatch.
2. ~~**The Studio dead-ends at Download.**~~ **✅ Fixed.** `image-studio.tsx` now has a **"Save to my
   site"** button next to Download. It POSTs the canvas to `/api/edit-requests` as a `kind:'asset'`
   edit (`{ asset: { key, dataUrl, mime } }`). The forge's `edit-poll.mjs` applies it: **logo/circle
   are deterministic** — it overwrites the canonical file (`public/logo/logo.png` /
   `logo-circle.png`) and runs `logo-fix.mjs`, no `claude -p` (a `fastAsset` fast-path mirroring
   `fastTheme`); **hero/og/carousel** go to `public/_edits/` for the build agent to place + wire into
   `lib/constants.ts` (their target path varies per template). Then rebuild + redeploy. Asset spec +
   the canonical paths: [`LOGOS.md`](LOGOS.md).
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
| **4 ✅** | **Durable theme persistence** *(shipped — app `5b64b79`, forge `9161132`)* | L | `forge_sites.theme_overrides` jsonb is the source of truth. `/api/edit-requests` upserts it on a token edit (merges; Revert nulls it, flagging `clearFont` when a font was wired). `site-proxy` injects it as a `<style>` **last** (wins the cascade) + a Google Fonts link + passes it to `window.__TBJ_EDIT.theme`; values sanitized. `editor.js` pre-fills the Brand panel from it (stable `fontId`) + offers **Revert to original**. `edit-poll` sources the fenced color block from the DB (rebuild-proof); **template swaps / rebuilds carry `theme_overrides` into `business.json` so the forge bakes the saved brand** instead of the template default. Portal shows a `failed`-edit banner. |
| **5 ✅** | **Studio "Save to my site" + per-type logo spec** *(shipped — app side; forge on branch)* | M | Closes the Studio dead-end (gap #2). `image-studio.tsx` gets a **Save to my site** button that POSTs the canvas as a `kind:'asset'` edit; `/api/edit-requests` validates it (mime allowlist, size cap, key whitelist). `edit-poll.mjs` applies it — **logo/circle deterministically** (overwrite `public/logo/*` + `logo-fix.mjs`, a `fastAsset` fast-path, no `claude -p`); hero/og/carousel via the build agent. Backed by [`../src/lib/logo-spec.ts`](../src/lib/logo-spec.ts), the browser twin of `factory/logo-fix.mjs` (per-type trim/pad + quality gates). Full spec: [`LOGOS.md`](LOGOS.md). |
| **6 ✅** | **Intent-first tool tiles + one preview/approve model + mobile nav/PWA** *(shipped — app `f1b5d1a`, `5543b0d`)* | M | `editor.js` `openPanel` becomes a **tool-tile picker** (Text · Size · Color · Request, contextual to element type) → tap a tile → only that tool's controls. New **Size** tool (A−/A+ → per-element `font-size`, new `changes.fontSize`); the confusing color scope toggle → "**Apply to: Everywhere it's used / Just this**"; Text tool edits the element's full text (was truncating). **Preview → "Approve changes" / discard** unified across element + **brand** (`discardBrand` reverts the live theme on X/Cancel) + section panels. **Studio**: rotate-to-landscape prompt on portrait phones + collapsible controls. **Portal PWA nav**: responsive `portal-header.tsx` (hamburger), a mobile **bottom bar** (`portal-bottom-nav.tsx`, via `portal/layout.tsx`), admin "‹ Portal" link, `viewport-fit=cover`. See VENUS_UI_MAPPING.md "Nav chrome". |

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
