# Brand assets — the per-type logo spec

**Read this when** you touch logo/image generation: the forge's build prompt, `factory/logo-fix.mjs`,
the portal's **Image Studio**, `src/lib/logo-spec.ts`, or a template's `CLAUDE.md` asset block.

Logos are the one asset where **dimensions are load-bearing**. A hero photo that's 5% off looks fine.
A logo that's 5% off looks *broken* — because a navbar sizes a logo by its **height**, so every pixel
of dead air above and below the mark shrinks the visible brand mark by that much.

## ⚠️ The one fact everything here follows from

**The image model cannot output transparency.** `gemini-2.5-flash-image` returns a **3-channel PNG**
(`hasAlpha=false`) — verified directly, not inferred. Asking it for a "transparent background" is a
**no-op that it satisfies by *painting* a background**, and left to its own devices it paints a subtly
*vignetted* off-white (corners measured at `241,237,233` vs `253,253,252`) that no colour key can
cleanly lift.

So a transparent logo is **impossible to generate** and **must be manufactured** afterwards. Background
removal is not a nice-to-have cleanup pass; it is the only thing standing between us and a white box.
The pipeline therefore has two halves, and they must agree:

1. **Ask for something achievable** — not "transparent" (impossible), but a **flat, uniform background
   we can key out**, plus a rule that keeps the artwork distinguishable from it.
2. **Key it out deterministically** — flood-fill the background away, drop artefacts, trim to the true
   ink, re-pad per type.

Neither half is sufficient alone. Prompting alone cannot produce alpha; keying alone can't turn a bare
icon into a circle.

### The two rules the prompt must carry

- **Flat background, stated explicitly.** *"a COMPLETELY FLAT, UNIFORM, SOLID PURE WHITE (#FFFFFF) — one
  single exact colour edge to edge, with NO gradient, NO vignette, NO shading, NO texture and NO drop
  shadow."* The vignette is what defeats a clean key; you must forbid it by name.
- **No white artwork touching the background.** We key by **connectivity from the border**, so white
  *enclosed* in a coloured shape (a white monogram on a brand-colour disc) survives — but white that
  *touches* the background is indistinguishable from it and gets erased. So: *"white is allowed only when
  fully enclosed inside a solid coloured shape."*
- **Say "the LOCKUP ITSELF must fill the frame"** — not just "fill the frame". See the failure below.
- **"Render the business name exactly once"** — the model otherwise echoes a word (a stray second
  "CLEANING" under the wordmark) and litters specks in the corners.

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

Every logo row also carries **the background rule above** — flat uniform white, no white artwork
touching it. Never ask for a transparent background; the model cannot produce one.

| Type | File | Aspect | What the model must produce | Post-trim pad | Quality gate |
|---|---|---|---|---|---|
| **Horizontal lockup** | `public/logo/logo.png` | `21:9` | Icon **left** + wordmark **right**, cap-heights matched, flat vector, **the lockup itself filling the frame edge-to-edge**, name rendered **exactly once**, on the flat white bg | `2%` of mark height top/bottom · `6%` of mark height left/right | mark aspect **≥ 1.8** · not >97% opaque |
| **Circular emblem** | `public/logo/logo-circle.png` | `1:1` | A **solid filled circle that touches all four edges** of the square frame, icon/monogram centred inside (**white icon is good — enclosed, so it survives the key**), on the flat white bg | pad to an exact square at `1.04 ×` the longest side | mark aspect **0.92 – 1.09** (target 1.00) |
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

## Failure modes this doc exists to prevent

### The white box (`thorough-global-cleaning-llc`, 2026-07)

The site shipped with the logo sitting in a **solid white rectangle**, the mark a sliver inside it. The
prompt said *"the lockup must FILL THE FRAME edge-to-edge"* **and** *"transparent background"* — and since
the model **cannot** do transparency, it satisfied "fill the frame" the only way it could: it **painted an
opaque white plate over the whole frame** and drew a small logo in the middle. The trim then treated the
plate as the mark (above) and padded it.

Measured on the shipped file: canvas **1616×698**, real ink **1055×166** — the mark owned **24% of the
navbar height**; the other 76% was white. Every gate passed. After the fix: **1051×178**, ink **97% of the
height**, rendering **210×64** in a 64px navbar slot.

The lesson isn't "write a better prompt." It's that **we were asking for something the model physically
cannot do**, and the post-processing was papering over the result badly enough to pass its own gates.

### The tiny navbar logo (`sunrise-plumbing-drain`)

1. The circle prompt asked for an icon, so the "circular emblem" was never a circle.
2. `logo-fix.mjs` padded with `max(width, height) * 0.05`. On a 2.29-aspect lockup that took 5% of the
   **width** and applied it to the **top and bottom** — ~9% of the height became dead air, dragging the
   canvas aspect from 2.29 down to 2.05 and shrinking the mark to 52px inside a 64px navbar slot.
3. The Studio had **no post-processing at all**, so a customer regenerating their logo got the raw
   1024²-canvas output — strictly worse than the forge's.

All fixed. The gates now make these loud instead of silent.

---

## How the background is removed (and why a trim isn't enough)

> **Superseded:** both twins used to lean on sharp's `trim()`, which keys off the **top-left pixel**.
> That is exactly what shipped a white box. Don't reintroduce it.

The generated file has **two background layers**: an opaque plate, and (after any prior pass) a
transparent margin around it. A single trim seeded from the top-left pixel sees only the *outer* layer:
on these files that pixel is transparent, so it strips the transparent ring, runs into the opaque plate,
and **stops — treating the plate as the mark**. It then pads a white rectangle, and every quality gate
passes, because the gates measure the plate (wide, fills its box), not the ink.

Three stages, in this order:

1. **`removeBackground()` — peel each layer by flood fill.** Seed from the current bounding box's ring,
   erase everything 4-connected to it that matches a background surface, re-measure, repeat (≤3 passes).
   A colour counts as background only if it owns **≥90% of that ring** (a *plate*); on the ring of a real
   mark's bbox the opaque pixels *are* the artwork and are never that uniform, so ink is never seeded.
   - **Connectivity is the whole point.** A global "make white transparent" would erase the white chevron
     inside the green disc. Flood fill cannot reach it — the disc encloses it.
2. **`pruneOutliers()` — drop artefacts that are BOTH small AND detached.** The model litters glyph-like
   specks in the corners. They survive the fill, and *one speck anchors the bounding box*: a real mark of
   **1055×166 (aspect 6.36)** came out as **1305×419 (aspect 3.11)**, reintroducing the exact dead air we
   were removing. **Size alone is not a safe test** — a real build produced a **49px** speck, while the tiny
   "LLC" subscript glyphs are the same order. The reliable signal is **isolation**: keep every component
   ≥2% of total ink, keep anything within half the mark's height of them (dots, subscripts, counters), drop
   the rest.
3. **Trim to the ink and re-pad** per the table above.

Both twins run all three and must agree. Guard rails: if removal would eat the artwork (<0.5% ink left)
it is **reverted**; if the mark is still >97% opaque afterwards the gate fires — that's a plate we failed
to lift (a gradient background), and the fix is to **regenerate**, not to tune the threshold.

## Verifying a change (parity check)

> ⚠️ The old numbers in this section were **the bug**, written down as the expected answer: it claimed
> `logo.png → 1616x698, mark 1536x672, aspect 2.29, no warning`. That "mark" was the **white plate**.
> If a change makes the output look like that again, the change is wrong.

Both implementations must produce the same geometry from the same input. Generate a fresh asset and run
it through, then run it through **again** — the second pass must be a no-op.

```bash
cd ~/code/webdev-templates
node factory/logo-fix.mjs /tmp/logo.png
#   → 1536x672 → 1051x178 (aspect 5.90, mark fills 98%w × 97%h, removed 95% background)
node factory/logo-fix.mjs /tmp/logo.png          # idempotent: 1051x178 → 1051x178, nothing removed
node factory/logo-fix.mjs /tmp/logo-circle.png --circle
#   → 1024x1024 → 745x745 (aspect 1.00, mark fills 96%, removed 62% background)
```

What a correct result looks like — check all four, not just the canvas size:

1. **`hasAlpha=true`, corners `0,0,0,0`.** The input has **no alpha channel at all**; if the output has
   none either, removal didn't run (is `sharp` resolving? it exits 0 and ships raw output if not).
2. **The mark is mostly transparent inside its own box.** A >97% opaque "mark" is a plate — gate fires.
3. **Enclosed white survives.** The circle emblem's white icon must still be there (~5% opaque-white
   pixels). If it's gone, someone replaced the flood fill with a global colour key. Don't.
4. **Idempotent.** Second pass changes nothing and removes 0% background.

`normalizeAsset()` (browser canvas) must agree with `logo-fix.mjs` (Node + sharp) on mark size, canvas
size, aspect, and gate verdict. They are twins across a repo boundary — **change one, change the other.**

**The 1px on the opaque lockup is expected, not a bug.** libvips thresholds the *mean* channel
difference from the background; the canvas twin thresholds the *max*. Since `max ≥ mean`, our box is
always a **superset** — it can retain one nearly-invisible antialiased edge column, never crop into the
mark. Aspect (2.85) and the gate verdict are identical either way. Don't "fix" this by tuning the
threshold to a fixture; if you need exactness, port libvips' rounded band-mean to both sides.

---

## Related

- [`FORGE.md`](FORGE.md) — the build pipeline that calls `logo-fix.mjs`, and the cost-safety rules.
- [`EDITOR.md`](EDITOR.md) — the portal editor the Studio tab lives in.
