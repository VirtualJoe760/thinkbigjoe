// Cheap, deterministic assets for the pre-sale preview so it never looks empty:
// a monogram built from the business name (used as the logo when the company has none),
// and a niche-matched placeholder hero image from the shared /public/preview-stock/ set
// (generated once, reused by every preview for free — no per-preview image cost).

/** Up to 2 initials from a business name, e.g. "Bob the Plumber" → "BP". */
export function initials(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "•";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// Niche keyword → one of the bundled niche-stock hero images.
const NICHE_STOCK: { keys: string[]; file: string }[] = [
  { keys: ["plumb", "drain", "sewer", "water heater"], file: "plumbing" },
  { keys: ["hvac", "heating", "cooling", "air condition", "furnace", "appliance"], file: "hvac" },
  { keys: ["electric"], file: "electrical" },
  { keys: ["roof", "gutter", "siding", "exterior"], file: "roofing" },
  { keys: ["landscap", "lawn", "tree", "irrigation", "garden", "stump"], file: "landscaping" },
  { keys: ["clean", "maid", "janitor", "pressure wash", "window", "carpet"], file: "cleaning" },
  { keys: ["pest", "termite", "exterminat"], file: "pest" },
  { keys: ["pool", "spa"], file: "pool" },
  { keys: ["auto", "mechanic", "detail", "tint", "towing"], file: "auto" },
  { keys: ["solar", "smart home", "ev ", "med spa", "aesthetic"], file: "modern" },
  { keys: ["paint", "drywall", "stucco", "remodel", "handyman", "concrete", "mason", "fence", "deck", "floor", "garage door", "welding"], file: "contractor" },
];

/** A niche-matched placeholder hero image path (falls back to a generic one). */
export function nicheStockImage(niche?: string | null): string {
  const n = (niche || "").toLowerCase();
  for (const m of NICHE_STOCK) if (m.keys.some((k) => n.includes(k))) return `/preview-stock/${m.file}.jpg`;
  return "/preview-stock/general.jpg";
}
