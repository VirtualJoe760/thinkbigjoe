/**
 * Prospecting scout — searches Google Maps Places and Yelp Fusion for
 * local businesses matching the ICP, then inserts them into the prospects
 * + outreach tables for Joe to review in the Command Center.
 *
 * Env vars required:
 *   GOOGLE_PLACES_API_KEY  — Google Cloud → Places API (New)
 *   YELP_API_KEY           — Yelp Fusion → private key
 */

import { db, prospects, outreach } from "@/db";
import { sql } from "drizzle-orm";

export type ScoutSource = "google_maps" | "yelp";
export type ScoutVertical = "insurance" | "mortgage" | "wealth" | "msp" | "law" | "other";

export interface ScoutOptions {
  vertical: ScoutVertical;
  location: string;
  sources?: ScoutSource[];
  limit?: number;
}

export interface ScoutResult {
  inserted: number;
  skipped: number;
  leads: RawLead[];
}

interface RawLead {
  name: string;
  company: string;
  vertical: ScoutVertical;
  location: string;
  profileUrl: string;
  fitScore: number;
  fitReason: string;
  hook: string;
  niche: string;
  source: string;
  recon: Record<string, unknown>;
}

// ── Vertical search terms ─────────────────────────────────────────────────────

const VERTICAL_TERMS: Record<ScoutVertical, string[]> = {
  insurance: ["insurance agent", "insurance broker", "insurance agency"],
  mortgage: ["mortgage broker", "mortgage lender", "mortgage company"],
  wealth: ["financial advisor", "wealth management", "financial planner"],
  msp: ["managed IT services", "IT support company", "managed service provider"],
  law: ["law firm", "attorney", "legal services"],
  other: ["small business consultant"],
};

// ── Fit scoring ───────────────────────────────────────────────────────────────

function fitScore(reviewCount: number, rating: number): number {
  // Small local firms: sweet spot is 10–200 reviews (active but not a chain)
  if (reviewCount < 5) return 3;
  if (reviewCount > 500) return 4; // likely a large chain
  const ratingScore = rating >= 4.0 ? 2 : 1;
  const sizeScore = reviewCount <= 100 ? 3 : 2;
  return Math.min(3 + ratingScore + sizeScore, 9);
}

// ── Hook generator ────────────────────────────────────────────────────────────

function buildHook(firstName: string, company: string, vertical: ScoutVertical): string {
  const verticalLine: Record<ScoutVertical, string> = {
    insurance: "helping insurance agencies automate client follow-ups and docs",
    mortgage: "helping mortgage brokers cut processing time with AI automation",
    wealth: "helping financial advisors automate client reporting and compliance docs",
    msp: "helping MSPs deliver AI-powered service desk automation to their clients",
    law: "helping law firms automate intake and document drafting",
    other: "helping owner-led businesses automate their back office with AI",
  };
  const note = `Hey ${firstName} — I noticed ${company} and wanted to connect. I work with ${verticalLine[vertical]}. Would love to be in your network.`;
  return note.slice(0, 300);
}

// ── Google Maps Places API ────────────────────────────────────────────────────

interface GooglePlace {
  place_id: string;
  name: string;
  formatted_address: string;
  rating?: number;
  user_ratings_total?: number;
  website?: string;
  types?: string[];
}

async function searchGoogleMaps(
  vertical: ScoutVertical,
  location: string,
  limit: number
): Promise<RawLead[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY not set");

  const terms = VERTICAL_TERMS[vertical];
  const leads: RawLead[] = [];
  const seen = new Set<string>();

  for (const term of terms.slice(0, 2)) {
    if (leads.length >= limit) break;
    const query = encodeURIComponent(`${term} near ${location}`);
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${key}`;

    const res = await fetch(url);
    if (!res.ok) continue;
    const data = await res.json() as { results?: GooglePlace[]; status?: string };
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.warn("Google Places error:", data.status);
      continue;
    }

    for (const place of (data.results ?? []).slice(0, limit)) {
      if (seen.has(place.place_id)) continue;
      seen.add(place.place_id);

      const company = place.name;
      const profileUrl = `gmaps:${place.place_id}`;
      const rating = place.rating ?? 4.0;
      const reviewCount = place.user_ratings_total ?? 20;
      const score = fitScore(reviewCount, rating);

      leads.push({
        name: "Owner",
        company,
        vertical,
        location: place.formatted_address,
        profileUrl,
        fitScore: score,
        fitReason: `Found via Google Maps (${term}); ${reviewCount} reviews, ${rating}★`,
        hook: buildHook("there", company, vertical),
        niche: term,
        source: "google_maps",
        recon: {
          place_id: place.place_id,
          rating,
          review_count: reviewCount,
          types: place.types,
          website: place.website,
          search_term: term,
          search_location: location,
        },
      });

      if (leads.length >= limit) break;
    }
  }

  return leads;
}

// ── Yelp Fusion API ───────────────────────────────────────────────────────────

interface YelpBusiness {
  id: string;
  name: string;
  location: { display_address: string[] };
  rating?: number;
  review_count?: number;
  url?: string;
  categories?: { alias: string; title: string }[];
  phone?: string;
}

async function searchYelp(
  vertical: ScoutVertical,
  location: string,
  limit: number
): Promise<RawLead[]> {
  const key = process.env.YELP_API_KEY;
  if (!key) throw new Error("YELP_API_KEY not set");

  const terms = VERTICAL_TERMS[vertical];
  const leads: RawLead[] = [];
  const seen = new Set<string>();

  for (const term of terms.slice(0, 2)) {
    if (leads.length >= limit) break;
    const params = new URLSearchParams({ term, location, limit: String(limit), sort_by: "rating" });
    const res = await fetch(`https://api.yelp.com/v3/businesses/search?${params}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      console.warn("Yelp error:", res.status, await res.text());
      continue;
    }
    const data = await res.json() as { businesses?: YelpBusiness[] };

    for (const biz of (data.businesses ?? []).slice(0, limit)) {
      if (seen.has(biz.id)) continue;
      seen.add(biz.id);

      const company = biz.name;
      const profileUrl = `yelp:${biz.id}`;
      const rating = biz.rating ?? 4.0;
      const reviewCount = biz.review_count ?? 20;
      const score = fitScore(reviewCount, rating);
      const addr = biz.location.display_address.join(", ");

      leads.push({
        name: "Owner",
        company,
        vertical,
        location: addr,
        profileUrl,
        fitScore: score,
        fitReason: `Found via Yelp (${term}); ${reviewCount} reviews, ${rating}★`,
        hook: buildHook("there", company, vertical),
        niche: term,
        source: "yelp",
        recon: {
          yelp_id: biz.id,
          yelp_url: biz.url,
          rating,
          review_count: reviewCount,
          categories: biz.categories?.map((c) => c.title),
          phone: biz.phone,
          search_term: term,
          search_location: location,
        },
      });

      if (leads.length >= limit) break;
    }
  }

  return leads;
}

// ── DB insert ─────────────────────────────────────────────────────────────────

async function insertLeads(leads: RawLead[]): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const lead of leads) {
    // Check for existing prospect with this profileUrl
    const existing = await db.execute(
      sql`SELECT id FROM prospects WHERE profile_url = ${lead.profileUrl} LIMIT 1`
    ) as unknown as { rows?: { id: number }[] } | { id: number }[];

    const rows = Array.isArray(existing) ? existing : (existing as { rows?: { id: number }[] }).rows ?? [];
    if (rows.length > 0) {
      skipped++;
      continue;
    }

    const result = await db.execute(sql`
      INSERT INTO prospects
        (name, title, company, vertical, location, profile_url, fit_score, fit_reason, hook, niche, source, status, paused, recon)
      VALUES
        (${lead.name}, ${"Owner / Decision Maker"}, ${lead.company}, ${lead.vertical}::enum_prospects_vertical,
         ${lead.location}, ${lead.profileUrl}, ${lead.fitScore}, ${lead.fitReason},
         ${lead.hook}, ${lead.niche}, ${lead.source}, 'new'::enum_prospects_status, false, ${JSON.stringify(lead.recon)}::jsonb)
      RETURNING id
    `) as unknown as { rows?: { id: number }[] } | { id: number }[];

    const newRows = Array.isArray(result) ? result : (result as { rows?: { id: number }[] }).rows ?? [];
    const prospectId = (newRows[0] as { id: number })?.id;

    if (prospectId) {
      await db.execute(sql`
        INSERT INTO outreach (prospect_id, step, status, body)
        VALUES (${prospectId}, 'connection'::enum_outreach_step, 'draft'::enum_outreach_status, ${lead.hook})
      `);
      inserted++;
    }
  }

  return { inserted, skipped };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function runScout(opts: ScoutOptions): Promise<ScoutResult> {
  const sources = opts.sources ?? ["google_maps", "yelp"];
  const perSource = Math.ceil((opts.limit ?? 20) / sources.length);

  const allLeads: RawLead[] = [];

  await Promise.allSettled([
    sources.includes("google_maps")
      ? searchGoogleMaps(opts.vertical, opts.location, perSource).then((l) => allLeads.push(...l))
      : Promise.resolve(),
    sources.includes("yelp")
      ? searchYelp(opts.vertical, opts.location, perSource).then((l) => allLeads.push(...l))
      : Promise.resolve(),
  ]);

  const { inserted, skipped } = await insertLeads(allLeads);
  return { inserted, skipped, leads: allLeads };
}
