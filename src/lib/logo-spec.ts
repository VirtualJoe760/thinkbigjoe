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
      "side by side, cap-heights optically matched, flat and crisp, on a transparent background. " +
      "The lockup must FILL THE FRAME edge-to-edge — the full width AND the full height, with no empty margin " +
      "(NOT a small mark floating in empty space)",
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
      "all four edges, with the icon or monogram centred inside it. Transparent ONLY outside the circle. " +
      "NOT a bare icon, NOT a small circle floating in empty space",
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

/**
 * Bounding box of the real mark — everything that differs from the background.
 *
 * Mirrors sharp's `trim()`: the background is the **top-left pixel**, and a pixel counts as content
 * if its alpha OR its colour differs from that background by more than `TRIM_THRESHOLD`. A pure alpha
 * test would silently no-op on a logo generated on flat white — the common failure, since image models
 * routinely ignore "transparent background".
 *
 * Not bit-identical to libvips: it thresholds the *mean* channel difference, we threshold the *max*.
 * Since max ≥ mean, our box is always a superset of sharp's — measured at ≤1px on real assets, and
 * always in the safe direction (we may keep one faint antialiased edge pixel; we never crop into the
 * mark). Mark aspect and the quality-gate verdict are unaffected. See docs/LOGOS.md.
 *
 * Returns `null` when nothing differs (a solid image) — sharp likewise makes no change rather than
 * trimming an image to nothing.
 */
function contentBBox(data: Uint8ClampedArray, w: number, h: number) {
  const bgR = data[0], bgG = data[1], bgB = data[2], bgA = data[3];
  let top = -1, left = w, right = -1, bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      let content: boolean;
      if (Math.abs(a - bgA) > TRIM_THRESHOLD) content = true;          // alpha differs from the bg
      else if (a <= TRIM_THRESHOLD) content = false;                    // transparent, like a transparent bg
      else content =                                                     // opaque: compare colour to the bg
        Math.abs(data[i] - bgR) > TRIM_THRESHOLD ||
        Math.abs(data[i + 1] - bgG) > TRIM_THRESHOLD ||
        Math.abs(data[i + 2] - bgB) > TRIM_THRESHOLD;
      if (!content) continue;
      if (top === -1) top = y;
      bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (top === -1) return null; // nothing but background
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
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

    const box = contentBBox(sctx.getImageData(0, 0, w, h).data, w, h);
    // Nothing but background. sharp makes no change rather than trimming to nothing — match it.
    if (!box) return asIs;
    // NOTE: we do NOT early-return when the box already fills the canvas. `logo-fix.mjs` always
    // re-pads after trimming, and always evaluates the quality gate; skipping either here would let
    // the two twins disagree (and would hide a warning on an edge-to-edge bad shape). Re-padding is
    // idempotent: the next pass trims the transparent margin back off before re-adding it.

    const markW = box.width, markH = box.height;
    const markAspect = markW / markH;

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

    const out = document.createElement("canvas");
    out.width = outW; out.height = outH;
    const octx = out.getContext("2d");
    if (!octx) return asIs;
    octx.drawImage(img, box.left, box.top, markW, markH, dx, dy, markW, markH);

    const fillW = Math.round((markW / outW) * 100);
    const fillH = Math.round((markH / outH) * 100);

    let warn: string | null = null;
    if (mode === "circle") {
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
