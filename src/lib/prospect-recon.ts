export type ProspectRecon = {
  websiteUrl: string;
  photoUrl: string;
  websiteStatus: string;
  websiteRating: number | null;
  websiteNotes: string;
  salesOpportunities: string[];
};

type ReconObject = Record<string, unknown>;

function asObject(value: unknown): ReconObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ReconObject)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRating(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(asString).filter(Boolean).slice(0, 5);
  }
  const text = asString(value);
  return text ? [text] : [];
}

export function parseProspectRecon(value: unknown): ProspectRecon {
  const recon = asObject(value);
  const website = asObject(recon.website);
  const linkedin = asObject(recon.linkedin);

  return {
    websiteUrl:
      asString(recon.websiteUrl) ||
      asString(recon.website_url) ||
      asString(website.url),
    photoUrl:
      asString(recon.photoUrl) ||
      asString(recon.photo_url) ||
      asString(linkedin.photoUrl) ||
      asString(linkedin.photo_url),
    websiteStatus:
      asString(recon.websiteStatus) ||
      asString(recon.website_status) ||
      asString(website.status),
    websiteRating:
      asRating(recon.websiteRating) ??
      asRating(recon.website_rating) ??
      asRating(website.rating),
    websiteNotes:
      asString(recon.websiteNotes) ||
      asString(recon.website_notes) ||
      asString(website.notes),
    salesOpportunities:
      asStringList(recon.salesOpportunities).length
        ? asStringList(recon.salesOpportunities)
        : asStringList(recon.sales_opportunities).length
          ? asStringList(recon.sales_opportunities)
          : asStringList(website.salesOpportunities).length
            ? asStringList(website.salesOpportunities)
            : asStringList(website.sales_opportunities),
  };
}
