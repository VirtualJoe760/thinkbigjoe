# Brand assets — the per-type logo spec

**Read this when** you touch logo/image generation: the forge's build prompt, `factory/logo-fix.mjs`,
the portal's **Image Studio**, `src/lib/logo-spec.ts`, or a template's `CLAUDE.md` asset block.

Logos are the one asset where **dimensions are load-bearing**. A hero photo that's 5% off looks fine.
A logo that's 5% off looks *broken* — because a navbar sizes a logo by its **height**, so every pixel
of transparent air above and below the mark shrinks the visible brand mark by that much.

We generate logos with an image model. The model does **not** reliably honor "tightly framed" — it
centers a mark in a big transparent canvas by default. So the pipeline has two halves, and they must
agree:

1. **Ask correctly** — a per-type prompt fragment that describes the *frame*, not just the art.
2. **Fix deterministically** — trim the transparent canvas back to the true mark, then re-pad per type.

Neither half is sufficient alone. Prompting alone drifts run-to-run; trimming alone can't turn a bare
icon into a circle.

---

## The two producers (both must implement this spec)

| Producer | Prompt lives in | Post-processing lives in |
|---|---|---|
| **The forge** (build a whole site) | `factory/forge-build.sh` + every `templates/*/CLAUDE.md` | `factory/logo-fix.mjs` (sharp, at build time) |
| **The Studio** (`/portal/edit/[id]` → Studio tab) | `src/lib/logo-spec.ts` → `ASSET_SPECS[].hint` | `src/lib/logo-spec.ts` → `normalizeAsset()` (canvas, in the browser) |

> ⚠️ `src/lib/logo-spec.ts` (this repo) and `factory/logo-fix.mjs` (the forge repo) are **twins**. The
> pad ratios and quality-gate thresholds are duplicated across a repo boundary because the two run in
> different runtimes (browser canvas vs. Node + sharp). **Change one, change the other**, and re-run
> the parity check at the bottom of this doc.

### Saving a Studio asset to the live site

The Studio's **"Save to my site"** button doesn't just download — it PUTs the asset onto the site.
It POSTs the canvas to `/api/edit-requests` as `{ kind:'asset', changes:{ asset:{ key, dataUrl, mime } } }`
(validated there: mime allowlist, ~9 MB cap, key whitelist). The forge's `factory/edit-poll.mjs` applies it:

- **logo / circle** — a **deterministic fast-path** (`fastAsset`, mirroring the theme `fastTheme`): decode the
  base64, overwrite the canonical file (`public/logo/logo.png` / `logo-circle.png`), run `logo-fix.mjs`,
  rebuild + redeploy. **No `claude -p`** — cheaper, and the saved logo gets the exact geometry the forge bakes.
  A **circle** save also mirrors the normalized emblem to **`app/icon.png`** (the Next App Router favicon
  convention) — created even on sites that had no `icon.png` — so saving a circular logo actually changes the
  browser-tab favicon rather than writing a `logo-circle.png` that nothing references.
- **hero / og / carousel** — their destination path varies per template, so they're written to
  `public/_edits/` and the build agent places + wires them into `lib/constants.ts`.

So `normalizeAsset()` runs **twice** on a saved logo — once in the browser on generate, once again via
`logo-fix.mjs` on apply. Both are idempotent, so the second pass is a no-op. That redundancy is deliberate:
the browser trim gives instant WYSIWYG, the forge trim is the authority that also guards a hand-uploaded file.

---

## Per-type spec

| Type | File | Aspect | What the model must produce | Post-trim pad | Quality gate |
|---|---|---|---|---|---|
| **Horizontal lockup** | `public/logo/logo.png` | `21:9` | Icon **left** + wordmark **right**, cap-heights matched, flat vector, transparent bg, **filling the frame edge-to-edge** | `2%` of mark height top/bottom · `6%` of mark height left/right | mark aspect **≥ 1.8** (target ~2.3) |
| **Circular emblem** | `public/logo/logo-circle.png` | `1:1` | A **solid filled circle that touches all four edges** of the square frame, icon/monogram centred inside; transparent **only outside** the circle | pad to an exact square at `1.04 ×` the longest side | mark aspect **0.92 – 1.09** (target 1.00) |
| OG image | — | `16:9` | Social-share banner, room for text | none (photo) | — |
| Hero | `public/images/…` | `16:9` | Hero photo, clear space at left for the headline | none (photo) | — |
| Carousel | — | `4:3` | Gallery image | none (photo) | — |

**Why the lockup pad is asymmetric.** Navbars size by height, so vertical padding is pure loss while
horizontal padding just keeps the mark off the edge. Both pads derive from the **mark height** — never
from `max(width, height)`, which on a wide lockup is the *width* and injects ~9% of dead vertical air.

**Why the circle pad is tiny.** Consumers (favicons, avatars) clip it to a circle *inscribed in the
square*, so any inset is wasted twice over. 4% total is enough to keep antialiased edges clean.

---

## What the gates mean

The gates never modify the image. They tell you the **generation** was wrong in a way trimming
physically cannot repair:

- **`⚠️ circular emblem is NOT circular (mark aspect 0.88)`** — the model returned a *bare icon* (e.g. a
  water droplet), not a badge. Trimming an icon produces a tight box around the icon; there is no circle
  to find. **Fix: regenerate.**
- **`⚠️ lockup still narrow (mark aspect 1.4 < 1.8)`** — the model stacked the wordmark under the icon,
  or omitted it. A near-square lockup renders small in a height-sized navbar. **Fix: regenerate.**
- **`⚠️ lockup fills only 81% of its height`** — padding math regressed. This one *is* a code bug.

In the forge the gates print to the build log. In the Studio they surface as an amber banner with
plain-language regenerate guidance (no vendor names — see the copy rule in `AGENTS.md`).

---

## The canonical prompt fragments

Keep these three in sync — they are the same spec written for three audiences:

- `factory/forge-build.sh` — the `claude -p` build prompt (clauses `(a)` and `(b)`).
- `templates/*/CLAUDE.md` — the asset block the build agent reads (identical in all 10 templates).
- `src/lib/logo-spec.ts` — `ASSET_SPECS[].hint`, appended to the customer's Studio prompt.

The load-bearing words, learned the hard way:

- Lockup: **"must FILL THE FRAME edge-to-edge — the full width AND the full height, with no empty margin"**.
  "Tightly framed with minimal margin" was *not* enough; the model still centered a small mark.
- Circle: **"a SOLID FILLED CIRCLE that completely fills the square frame and touches all four edges,
  with the icon centred inside it"**. The old phrasing — "the icon centered inside a circle" — reads to
  the model as *draw an icon*, and it returned a bare 0.88-aspect droplet on every run.

---

## Failure mode this doc exists to prevent

A live site (`sunrise-plumbing-drain`) shipped with a visibly tiny navbar logo. Three compounding causes:

1. The circle prompt asked for an icon, so the "circular emblem" was never a circle.
2. `logo-fix.mjs` padded with `max(width, height) * 0.05`. On a 2.29-aspect lockup that took 5% of the
   **width** and applied it to the **top and bottom** — ~9% of the height became dead air, dragging the
   canvas aspect from 2.29 down to 2.05 and shrinking the mark to 52px inside a 64px navbar slot.
3. The Studio had **no post-processing at all**, so a customer regenerating their logo got the raw
   1024²-canvas output — strictly worse than the forge's.

All three are fixed. The gates now make #1 and #2 loud instead of silent.

---

## How the trim decides what's background

Both implementations take the **top-left pixel** as the background and trim every edge similar to it.
This matters more than it sounds: the model frequently ignores "transparent background" and returns the
mark on flat white. A naive *alpha-only* trim finds nothing to remove there and ships the raw 1024²
canvas — which is the original bug, reintroduced. Test against the background **colour**, not just alpha.

`logo-fix.mjs` gets this free from sharp. `normalizeAsset()` re-implements it on `ImageData`.

## Verifying a change (parity check)

Both implementations must produce the same geometry from the same input. The real assets make good
fixtures — a correct lockup, a known-bad circle, and opaque-background copies of each (`sharp
.flatten({background:"#ffffff"})`) to exercise the colour-trim path:

```bash
# forge side (Node + sharp)
cd ~/code/webdev-templates
node factory/logo-fix.mjs /path/to/logo.png            # → 1616x698, mark 1536x672, aspect 2.29, no warning
node factory/logo-fix.mjs /path/to/logo-circle.png --circle
#   → 739x739, mark 628x711, aspect 0.88 → ⚠️ NOT circular
```

Both are **idempotent** — running them on their own output is a no-op, so a rebuild never compounds
padding. `normalizeAsset()` must agree on mark size, canvas size, aspect, and warning. Verified on all
four fixtures:

| Fixture | sharp | `normalizeAsset()` | Gate |
|---|---|---|---|
| `logo.png` (transparent) | mark 1536×672 → 1616×698 | identical | quiet |
| `logo-circle.png` (transparent) | mark 628×711 → 739×739 | identical | ⚠️ not circular |
| `logo-opaque.png` (white bg) | mark 1290×453 → 1344×471 | mark 1291×453 → 1345×471 | quiet |
| `logo-circle-opaque.png` (white bg) | mark 628×711 → 739×739 | identical | ⚠️ not circular |

**The 1px on the opaque lockup is expected, not a bug.** libvips thresholds the *mean* channel
difference from the background; the canvas twin thresholds the *max*. Since `max ≥ mean`, our box is
always a **superset** — it can retain one nearly-invisible antialiased edge column, never crop into the
mark. Aspect (2.85) and the gate verdict are identical either way. Don't "fix" this by tuning the
threshold to a fixture; if you need exactness, port libvips' rounded band-mean to both sides.

---

## Related

- [`FORGE.md`](FORGE.md) — the build pipeline that calls `logo-fix.mjs`, and the cost-safety rules.
- [`EDITOR.md`](EDITOR.md) — the portal editor the Studio tab lives in.
