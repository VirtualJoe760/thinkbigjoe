/**
 * CANONICAL BRAND-ASSET SPEC — one source of truth for how each asset type is generated,
 * framed, and normalized. See `docs/LOGOS.md`.
 *
 * Two producers must agree on this geometry or a logo renders tiny:
 *   1. the forge  — `factory/forge-build.sh` prompt + `factory/logo-fix.mjs` post-processing
 *   2. the Studio — this file (prompt hints) + `normalizeAsset()` below
 *
 * The numbers here (pad ratios, quality gates) MIRROR `factory/logo-fix.mjs` in the sibling
 * `webdev-templates` repo. Change one, change the other.
 */

/** Post-generation geometry fix. `null` = photo, ship as generated. */
export type NormalizeMode = "lockup" | "circle";

export type AssetSpec = {
  key: string;
  label: string;
  /** Appended to the user's prompt before it reaches the image model. */
  hint: string;
  /** Gemini aspect ratio — without it every image lands on a 1024² square. */
  aspect: string;
  /** Human label for the shape, shown in the Studio. */
  shape: string;
  /** One-line explainer of WHY this shape. */
  note?: string;
  /** Preview/export clips to an inscribed circle. */
  round?: boolean;
  normalize?: NormalizeMode;
};

// ── Geometry (mirrors factory/logo-fix.mjs) ────────────────────────────────────
/** Navbars size logos by HEIGHT, so vertical padding is pure loss. Keep it a hair. */
export const LOCKUP_PAD_Y = 0.02; // × mark height
export const LOCKUP_PAD_X = 0.06; // × mark height (not width — keeps wide marks off the edge)
/** The circle is clipped to an inscribed circle by consumers; only ~2% breathing room. */
export const CIRCLE_SCALE = 1.04; // × max(mark w, h)
/**
 * Per-channel tolerance when deciding "is this pixel background?" — mirrors sharp's
 * `trim({ threshold: 10 })`, which trims edges similar to the **top-left pixel** and, on images with
 * an alpha channel, unions the alpha and colour bounding boxes. Matching that matters: image models
 * frequently ignore "transparent background" and return the mark on flat white, and a pure alpha test
 * would find nothing to trim there.
 */
export const TRIM_THRESHOLD = 10;

// ── Quality gates (mirrors factory/logo-fix.mjs) ───────────────────────────────
/** A real horizontal lockup trims to a wide bbox. Narrower means it isn't a lockup. */
export const LOCKUP_MIN_ASPECT = 1.8;
/** A real filled circle trims to a SQUARE bbox. Off means the model returned a bare icon. */
export const CIRCLE_MIN_ASPECT = 0.92;
export const CIRCLE_MAX_ASPECT = 1.09;

/**
 * THE BACKGROUND RULE — the single most load-bearing sentence in this file.
 *
 * The image model CANNOT emit transparency: it returns a 3-channel PNG (`hasAlpha=false`). Asking it
 * for a "transparent background" is a no-op that it satisfies by PAINTING an opaque background — and
 * left to itself it paints a subtly vignetted off-white, which no colour key can cleanly remove. So we
 * stop asking for the impossible and instead ask for the one thing that makes removal exact: a single
 * flat colour. `normalizeAsset()` keys it out afterwards.
 *
 * The white-ink clause is the other half. We key out the background by CONNECTIVITY from the border, so
 * white fully enclosed in a coloured shape (a white monogram on a brand-colour disc) survives — but white
 * that touches the background is indistinguishable from it and gets erased. Say so, up front.
 */
const FLAT_BG =
  "The background must be a COMPLETELY FLAT, UNIFORM, SOLID PURE WHITE (#FFFFFF) — one single exact colour " +
  "edge to edge, with NO gradient, NO vignette, NO shading, NO texture and NO drop shadow (this white is " +
  "keyed out to transparency afterwards). Flat vector artwork only. " +
  "CRITICAL — the ARTWORK ITSELF must never use pure white or near-white anywhere, because pure white is the " +
  "background colour and gets erased. If an element needs to read as white (an icon or monogram inside a " +
  "coloured badge), paint it in a soft OFF-WHITE tint — no lighter than #EEEEEE — clearly distinguishable " +
  "from the pure-white background. Never #FFFFFF for ink";

export const ASSET_SPECS: AssetSpec[] = [
  {
    key: "logo",
    label: "Logo",
    aspect: "21:9",
    shape: "wide lockup",
    note: "fills a navbar without shrinking",
    normalize: "lockup",
    hint:
      "as a HORIZONTAL brand logo lockup — the icon on the LEFT and the business-name wordmark on the RIGHT, " +
      "side by side, cap-heights optically matched, flat and crisp. " +
      "The LOCKUP ITSELF must FILL THE FRAME edge-to-edge — the full width AND the full height, with no empty margin " +
      "(NOT a small mark floating in empty space). Render the business name EXACTLY ONCE — do not repeat, duplicate or " +
      "echo any word, and add no stray marks, letters or specks anywhere in the frame. " +
      FLAT_BG,
  },
  {
    key: "circle",
    label: "Circular logo",
    aspect: "1:1",
    shape: "1:1 filled circle",
    note: "for favicons & avatars — must be a filled circle, not a bare icon",
    round: true,
    normalize: "circle",
    hint:
      "as a CIRCULAR brand badge — a SOLID FILLED CIRCLE that completely fills the square frame and touches " +
      "all four edges, with the icon or monogram centred inside it (a WHITE icon inside the coloured circle is " +
      "good — it is enclosed, so it survives). NOT a bare icon, NOT a small circle floating in empty space. " +
      FLAT_BG,
  },
  { key: "og", label: "OG image", aspect: "16:9", shape: "16:9 banner", hint: "as a wide social-share banner (Open Graph) with the brand feel, balanced, with room for text" },
  { key: "hero", label: "Hero image", aspect: "16:9", shape: "16:9 wide", hint: "as a wide hero background photo, leaving clear space on the left for headline text" },
  { key: "carousel", label: "Carousel image", aspect: "4:3", shape: "4:3", hint: "as a clean gallery/carousel image" },
];

export type NormalizeResult = {
  dataUrl: string;
  /** Set when the GENERATION is wrong in a way trimming cannot fix — surface it, don't hide it. */
  warn: string | null;
  /** `${w}×${h}` of the trimmed mark, and how much of the final canvas it fills. */
  info: { markW: number; markH: number; markAspect: number; fillW: number; fillH: number } | null;
};

type Rect = { left: number; top: number; width: number; height: number };
type Surface = { r: number; g: number; b: number; a: number };

/** If the mark is still this opaque after removal, it's a solid plate, not artwork. */
const PLATE_OPACITY = 0.97;
/** An opaque colour counts as a background PLATE only if it owns this much of a box's border ring. */
const PLATE_RING_FRACTION = 0.9;
/** A component with ≥ this share of total ink is a substantial part of the mark; always kept. */
const MAJOR_FRACTION = 0.02;
/** Refuse a removal that would eat the artwork. */
const MIN_INK_FRACTION = 0.005;

const near = (d: number, e: number) => Math.abs(d - e) <= TRIM_THRESHOLD;

/** Is pixel `i` the same surface as `ref`? Transparency matches transparency. */
function sameSurface(px: Uint8ClampedArray, i: number, ref: Surface): boolean {
  const a = px[i + 3];
  if (ref.a <= TRIM_THRESHOLD) return a <= TRIM_THRESHOLD;
  if (Math.abs(a - ref.a) > TRIM_THRESHOLD) return false;
  return near(px[i], ref.r) && near(px[i + 1], ref.g) && near(px[i + 2], ref.b);
}

/** The 1px ring around a rect — the seeds for one removal pass. */
function ringPixels(w: number, rect: Rect): number[] {
  const out: number[] = [];
  const x2 = rect.left + rect.width - 1, y2 = rect.top + rect.height - 1;
  for (let x = rect.left; x <= x2; x++) { out.push(rect.top * w + x); out.push(y2 * w + x); }
  for (let y = rect.top; y <= y2; y++) { out.push(y * w + rect.left); out.push(y * w + x2); }
  return out;
}

/**
 * The background surfaces on a rect's ring. Transparency always counts. An opaque colour counts only
 * if it's a PLATE — owning ≥ PLATE_RING_FRACTION of the ring. That test is the safety catch: on the ring
 * of a real mark's bbox the opaque pixels ARE the artwork and are never that uniform, so we never seed
 * ink as background and erase the logo.
 */
function backgroundSurfaces(px: Uint8ClampedArray, w: number, rect: Rect): Surface[] {
  const ring = ringPixels(w, rect);
  const surfaces: Surface[] = [{ r: 0, g: 0, b: 0, a: 0 }];
  const opaque = ring.filter((p) => px[p * 4 + 3] > TRIM_THRESHOLD);
  if (!opaque.length) return surfaces;

  // Mode, not mean — a mean would invent a colour that exists nowhere in the image.
  const counts = new Map<string, { n: number; i: number }>();
  for (const p of opaque) {
    const i = p * 4;
    const key = `${px[i] >> 3},${px[i + 1] >> 3},${px[i + 2] >> 3}`;
    const c = counts.get(key) || { n: 0, i };
    c.n++;
    counts.set(key, c);
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  const i = best.i;
  const cand: Surface = { r: px[i], g: px[i + 1], b: px[i + 2], a: px[i + 3] };
  if (ring.filter((p) => sameSurface(px, p * 4, cand)).length / ring.length >= PLATE_RING_FRACTION) {
    surfaces.push(cand);
  }
  return surfaces;
}

/** 4-connected flood fill from `rect`'s ring, erasing background. Cannot reach ink enclosed by the mark. */
function floodErase(px: Uint8ClampedArray, w: number, h: number, rect: Rect, surfaces: Surface[]): number {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const p of ringPixels(w, rect)) if (!seen[p]) { seen[p] = 1; stack.push(p); }
  let erased = 0;
  while (stack.length) {
    const p = stack.pop()!;
    const i = p * 4;
    if (!surfaces.some((s) => sameSurface(px, i, s))) continue; // hit the mark — stop
    if (px[i + 3] !== 0) { px[i + 3] = 0; erased++; }
    const x = p % w, y = (p / w) | 0;
    if (x > rect.left && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
    if (x < rect.left + rect.width - 1 && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
    if (y > rect.top && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
    if (y < rect.top + rect.height - 1 && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
  }
  return erased;
}

/**
 * Strip every background LAYER. These files routinely have two — a transparent margin wrapping an opaque
 * plate — and the plate never touches the image border, so one pass seeded from the border only learns
 * "transparent" and stops dead at the plate. That is the exact bug that shipped a white box: peel a layer,
 * re-measure, peel the next.
 */
function removeBackground(px: Uint8ClampedArray, w: number, h: number): { erased: number; plate: Surface | null } {
  let rect: Rect = { left: 0, top: 0, width: w, height: h };
  let erased = 0;
  let plate: Surface | null = null;
  for (let pass = 0; pass < 3; pass++) {
    const surfaces = backgroundSurfaces(px, w, rect);
    const opaque = surfaces.find((s) => s.a > TRIM_THRESHOLD);
    if (opaque) plate = opaque; // the solid card the mark was painted on
    erased += floodErase(px, w, h, rect, surfaces);
    const box = rawBBox(px, w, h);
    if (!box) break;
    if (box.width === rect.width && box.height === rect.height) break;
    rect = box;
  }
  return { erased, plate };
}

/**
 * Clear the ENCLOSED background — the counters of letters.
 *
 * The flood fill works by connectivity, so it physically cannot reach the hole inside an "O" or the
 * bowl of an "R": that region IS background, but the letter stroke walls it off from the border. On a
 * real shipped logo this left 306 blobs / 3760px of opaque white inside the wordmark, which render as
 * soft white bubbles on a dark navbar.
 *
 * Colour alone can't fix it — an enclosed white region might be ARTWORK (the white icon inside a
 * brand-colour disc). So the prompt now forbids pure white as an INK colour, and here SIZE is the
 * safety net: counters measured ≈0.56% of the mark, an enclosed icon 5–13%. An order of magnitude
 * apart. Anything too big to be a counter is kept and reported — the model broke the no-white rule and
 * the fix is to regenerate.
 */
const ENCLOSED_MAX_FRACTION = 0.02; // of the mark's area
function clearEnclosedBackground(
  px: Uint8ClampedArray, w: number, h: number, plate: Surface | null, box: Rect,
): { cleared: number; keptArtwork: number } {
  if (!plate) return { cleared: 0, keptArtwork: 0 };
  const markArea = box.width * box.height;
  const seen = new Uint8Array(w * h);
  const isPlate = (p: number) => px[p * 4 + 3] > TRIM_THRESHOLD && sameSurface(px, p * 4, plate);

  let cleared = 0, keptArtwork = 0;
  for (let p = 0; p < w * h; p++) {
    if (seen[p] || !isPlate(p)) continue;
    const cells: number[] = [];
    const stack = [p];
    seen[p] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      cells.push(q);
      const x = q % w, y = (q / w) | 0;
      if (x > 0 && !seen[q - 1] && isPlate(q - 1)) { seen[q - 1] = 1; stack.push(q - 1); }
      if (x < w - 1 && !seen[q + 1] && isPlate(q + 1)) { seen[q + 1] = 1; stack.push(q + 1); }
      if (y > 0 && !seen[q - w] && isPlate(q - w)) { seen[q - w] = 1; stack.push(q - w); }
      if (y < h - 1 && !seen[q + w] && isPlate(q + w)) { seen[q + w] = 1; stack.push(q + w); }
    }
    if (cells.length > markArea * ENCLOSED_MAX_FRACTION) { keptArtwork += cells.length; continue; }
    for (const q of cells) px[q * 4 + 3] = 0;
    cleared += cells.length;
  }
  return { cleared, keptArtwork };
}

/**
 * Erase stray artefacts — blobs that are BOTH small AND far from the mark.
 *
 * The model litters the corners of the plate with little glyph-like specks. They survive the fill, and
 * one speck in the corner ANCHORS THE BOUNDING BOX there, reintroducing exactly the dead air we're
 * removing (measured: a real mark of 1055×166 came out as a 1305×419 box).
 *
 * Size alone is NOT a safe test — a real build produced a 49px speck, while the tiny "LLC" subscript
 * glyphs are of the same order. The reliable signal is ISOLATION: artwork clusters, artefacts sit alone
 * in a corner. Keep every substantial component, keep anything NEAR them (dots, subscripts, letter
 * counters), and drop only what is both minor and detached.
 */
function pruneOutliers(px: Uint8ClampedArray, w: number, h: number): void {
  const seen = new Uint8Array(w * h);
  const visible = (p: number) => px[p * 4 + 3] > TRIM_THRESHOLD;
  const comps: { cells: number[]; minx: number; maxx: number; miny: number; maxy: number }[] = [];
  let total = 0;
  for (let p = 0; p < w * h; p++) {
    if (seen[p] || !visible(p)) continue;
    const cells: number[] = [];
    const stack = [p];
    seen[p] = 1;
    let minx = w, maxx = -1, miny = h, maxy = -1;
    while (stack.length) {
      const q = stack.pop()!;
      cells.push(q);
      const x = q % w, y = (q / w) | 0;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (x > 0 && !seen[q - 1] && visible(q - 1)) { seen[q - 1] = 1; stack.push(q - 1); }
      if (x < w - 1 && !seen[q + 1] && visible(q + 1)) { seen[q + 1] = 1; stack.push(q + 1); }
      if (y > 0 && !seen[q - w] && visible(q - w)) { seen[q - w] = 1; stack.push(q - w); }
      if (y < h - 1 && !seen[q + w] && visible(q + w)) { seen[q + w] = 1; stack.push(q + w); }
    }
    total += cells.length;
    comps.push({ cells, minx, maxx, miny, maxy });
  }
  if (!comps.length) return;

  const major = comps.filter((c) => c.cells.length >= total * MAJOR_FRACTION);
  if (!major.length) return;
  const box = {
    minx: Math.min(...major.map((c) => c.minx)), maxx: Math.max(...major.map((c) => c.maxx)),
    miny: Math.min(...major.map((c) => c.miny)), maxy: Math.max(...major.map((c) => c.maxy)),
  };
  const gap = Math.max(8, (box.maxy - box.miny + 1) * 0.5);
  const nearMark = (c: { minx: number; maxx: number; miny: number; maxy: number }) =>
    c.minx >= box.minx - gap && c.maxx <= box.maxx + gap &&
    c.miny >= box.miny - gap && c.maxy <= box.maxy + gap;

  for (const c of comps) {
    if (c.cells.length >= total * MAJOR_FRACTION || nearMark(c)) continue;
    for (const q of c.cells) px[q * 4 + 3] = 0;
  }
}

/** Bounding box of everything still visible (post-removal), plus its ink count. */
function rawBBox(px: Uint8ClampedArray, w: number, h: number) {
  let top = -1, left = w, right = -1, bottom = -1, ink = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] <= TRIM_THRESHOLD) continue;
      ink++;
      if (top === -1) top = y;
      bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (top === -1) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1, ink };
}

/**
 * Trim the transparent canvas back to the true mark, then re-pad per type — the browser-side
 * twin of `factory/logo-fix.mjs`. Non-fatal: any failure returns the original untouched.
 *
 * Trimming cannot invent a circle or widen a square, so a bad generation is REPORTED (`warn`),
 * never silently shipped.
 */
export async function normalizeAsset(dataUrl: string, mode: NormalizeMode): Promise<NormalizeResult> {
  const asIs: NormalizeResult = { dataUrl, warn: null, info: null };
  if (typeof document === "undefined") return asIs;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("load"));
      i.src = dataUrl;
    });

    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return asIs;
    const scratch = document.createElement("canvas");
    scratch.width = w; scratch.height = h;
    const sctx = scratch.getContext("2d", { willReadFrequently: true });
    if (!sctx) return asIs;
    sctx.drawImage(img, 0, 0);

    const image = sctx.getImageData(0, 0, w, h);
    const px = image.data;
    const original = Uint8ClampedArray.from(px);

    // The model paints an opaque background (it cannot emit alpha), so KEY IT OUT before measuring.
    // Skipping this is what made a white plate look like the mark and shipped a white box.
    const { plate } = removeBackground(px, w, h);
    pruneOutliers(px, w, h); // before the bbox — one corner speck otherwise anchors it
    let box = rawBBox(px, w, h);

    // Guard: if removal ate (nearly) everything, this wasn't a mark-on-background. Restore.
    if (!box || box.ink < w * h * MIN_INK_FRACTION) {
      px.set(original);
      box = rawBBox(px, w, h);
    }
    if (!box) return asIs;

    // Now that the mark's size is known, clear the ENCLOSED background (letter counters) — the
    // counter-vs-artwork test is relative to the mark's area, so it has to run after the bbox.
    const enclosed = clearEnclosedBackground(px, w, h, plate, box);
    if (enclosed.cleared) box = rawBBox(px, w, h) || box;

    const markW = box.width, markH = box.height;
    const markAspect = markW / markH;
    const opacity = box.ink / (markW * markH);

    let outW: number, outH: number, dx: number, dy: number;
    if (mode === "circle") {
      const side = Math.round(Math.max(markW, markH) * CIRCLE_SCALE);
      outW = outH = side;
      dx = Math.round((side - markW) / 2);
      dy = Math.round((side - markH) / 2);
    } else {
      const padY = Math.round(markH * LOCKUP_PAD_Y);
      const padX = Math.round(markH * LOCKUP_PAD_X);
      outW = markW + padX * 2; outH = markH + padY * 2;
      dx = padX; dy = padY;
    }

    // Composite from the KEYED pixels (not the source img) — otherwise the background comes back.
    scratch.getContext("2d")?.putImageData(image, 0, 0);
    const out = document.createElement("canvas");
    out.width = outW; out.height = outH;
    const octx = out.getContext("2d");
    if (!octx) return asIs;
    octx.drawImage(scratch, box.left, box.top, markW, markH, dx, dy, markW, markH);

    const fillW = Math.round((markW / outW) * 100);
    const fillH = Math.round((markH / outH) * 100);

    let warn: string | null = null;
    if (opacity > PLATE_OPACITY) {
      warn = "That came back as artwork sitting on a solid background block, and the background couldn’t be lifted off. Try again and ask for “flat artwork on a plain, solid white background — no gradient or shadow.”";
    } else if (enclosed.keptArtwork) {
      // Painted in the background colour, and too big to be a letter counter — we kept it rather than
      // erase real artwork, but it can't be made transparent.
      warn = "Part of this design is painted in pure white, which is the background colour — so it can’t be made see-through and will show as a white patch. Try again and ask for “a soft off-white instead of pure white.”";
    } else if (mode === "circle") {
      if (markAspect < CIRCLE_MIN_ASPECT || markAspect > CIRCLE_MAX_ASPECT) {
        warn = "That came back as a bare icon, not a filled circle. Try again and ask for “a solid filled circle that fills the whole frame, with the icon centred inside.”";
      }
    } else if (markAspect < LOCKUP_MIN_ASPECT) {
      warn = "That came back closer to a square than a wide lockup — it will look small in a navbar. Try again and ask for “the icon on the left, the business name on the right, side by side.”";
    }

    return { dataUrl: out.toDataURL("image/png"), warn, info: { markW, markH, markAspect, fillW, fillH } };
  } catch {
    return asIs;
  }
}
