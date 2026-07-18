import { eq } from "drizzle-orm";

import { db, forgeSites, activityLog } from "@/db";
import { generateClaimCode } from "@/lib/claim-code";

// Generates the cheap, pre-sale personalized preview for a prospect (the "showroom"):
// Gemini writes tailored hero copy; the hero image reuses the already-scraped business
// photo (no image generation — that's the forge's job on the real build). Mints the claim
// code and sets a 14-day "reserved" window. No forge build, no per-prospect deploy.

const PREVIEW_TTL_DAYS = 14;
const MODEL = "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export type PreviewContent = {
  eyebrow: string;
  headline: string;
  subcopy: string;
  services: { name: string; blurb: string }[];
  features: string[];
  stats: { value: string; label: string }[];
  heroUrl: string | null;
  model: string;
};

function titleCase(s: string) {
  return s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type SiteRow = typeof forgeSites.$inferSelect;

/** Ask Gemini for tailored hero copy. Returns null on any failure (caller falls back). */
type GeminiCopy = Pick<PreviewContent, "eyebrow" | "headline" | "subcopy" | "services" | "features" | "stats">;

async function geminiCopy(site: SiteRow): Promise<GeminiCopy | null> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if (!key) return null;

  const facts = {
    business: site.businessName,
    niche: site.niche,
    city: site.city,
    serviceArea: site.serviceArea,
    rating: site.googleRating,
    reviews: site.reviewCount,
  };
  const prompt = `You are a senior website copywriter for local service businesses. Write homepage copy for "${site.businessName}". Return STRICT JSON, no markdown, with exactly these keys:
{"eyebrow":"<niche · city, <= 6 words>","headline":"<benefit-driven hero headline, <= 9 words, no company name>","subcopy":"<1-2 warm sentences mentioning the service area or a differentiator, <= 240 chars>","services":[{"name":"<service, 1-3 words>","blurb":"<one concrete sentence, <= 90 chars>"}],"features":["<short trust/benefit phrase, <= 5 words>"],"stats":[{"value":"<short, e.g. 15+ yrs, 4.9★, 24/7>","label":"<1-2 words>"}]}
Give 3-4 services REAL to this specific trade, 3 features, and 3 stats (use the rating/reviews facts where they fit). Business facts: ${JSON.stringify(facts)}
Output ONLY the JSON object.`;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.9 },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text: string =
      json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).filter(Boolean).join("") ?? "";
    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed?.headline) return null;
    const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
    return {
      eyebrow: String(parsed.eyebrow || "").slice(0, 60),
      headline: String(parsed.headline).slice(0, 90),
      subcopy: String(parsed.subcopy || "").slice(0, 280),
      services: arr<{ name?: string; blurb?: string }>(parsed.services)
        .slice(0, 4)
        .map((s) => ({ name: String(s?.name || "").slice(0, 40), blurb: String(s?.blurb || "").slice(0, 120) }))
        .filter((s) => s.name),
      features: arr<string>(parsed.features).slice(0, 4).map((f) => String(f || "").slice(0, 40)).filter(Boolean),
      stats: arr<{ value?: string; label?: string }>(parsed.stats)
        .slice(0, 3)
        .map((s) => ({ value: String(s?.value || "").slice(0, 16), label: String(s?.label || "").slice(0, 20) }))
        .filter((s) => s.value),
    };
  } catch {
    return null;
  }
}

export type GenPreviewResult = { ok: boolean; claimCode?: string; usedGemini?: boolean; error?: string };

/** Generate (or regenerate) the preview for one site. Idempotent; refreshes copy + TTL. */
export async function generatePreview(siteId: number): Promise<GenPreviewResult> {
  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, siteId)).limit(1);
  if (!site) return { ok: false, error: "site not found" };

  const copy = await geminiCopy(site);
  const nicheLabel = site.niche ? titleCase(site.niche.split(/[—-]/)[0].trim()) : "Local service";
  const place = site.city || site.serviceArea || "your area";

  const nl = nicheLabel.toLowerCase();
  const content: PreviewContent = {
    eyebrow: copy?.eyebrow || `${nicheLabel} · ${place}`,
    headline: copy?.headline || `${nicheLabel} in ${place}, done right.`,
    subcopy:
      copy?.subcopy ||
      `${site.businessName} — ${site.serviceArea ? `proudly serving ${site.serviceArea}` : "trusted, local, and reliable"}. Get a fast, no-pressure quote today.`,
    services: copy?.services?.length
      ? copy.services
      : [
          { name: "Repairs", blurb: `Fast, reliable ${nl} repairs done right the first time.` },
          { name: "Installations", blurb: "Quality installs built to last, with upfront pricing." },
          { name: "Maintenance", blurb: "Keep everything running smoothly with regular service." },
        ],
    features: copy?.features?.length
      ? copy.features
      : ["Licensed & insured", "Upfront pricing", "Local & family-owned", "Satisfaction guaranteed"],
    stats: copy?.stats?.length
      ? copy.stats
      : [
          { value: site.googleRating ? `${site.googleRating}★` : "5★", label: "Rated" },
          { value: site.reviewCount || "100+", label: "Reviews" },
          { value: "Same-day", label: "Service" },
        ],
    heroUrl: site.photoUrl || null,
    model: copy ? MODEL : "fallback",
  };

  const now = new Date();
  const expires = new Date(now.getTime() + PREVIEW_TTL_DAYS * 86_400_000);

  // Reuse an existing claim code; otherwise mint one, retrying once on the (rare) unique clash.
  let claimCode = site.claimCode || generateClaimCode();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await db
        .update(forgeSites)
        .set({
          preview: content,
          claimCode,
          previewGeneratedAt: now.toISOString(),
          previewScrapedAt: now.toISOString(),
          previewExpiresAt: expires.toISOString(),
        })
        .where(eq(forgeSites.id, siteId));
      await db.insert(activityLog).values({
        actor: "system",
        eventType: "forge_preview_generated",
        summary: `Preview generated for ${site.businessName} (${site.slug})${copy ? "" : " — fallback copy"}`,
        metadata: { auto: true, target: site.slug, detail: { siteId, usedGemini: Boolean(copy) } },
      });
      return { ok: true, claimCode, usedGemini: Boolean(copy) };
    } catch (e) {
      if (!site.claimCode && attempt === 0) {
        claimCode = generateClaimCode();
        continue;
      }
      return { ok: false, error: e instanceof Error ? e.message : "update failed" };
    }
  }
  return { ok: false, error: "could not persist preview" };
}
