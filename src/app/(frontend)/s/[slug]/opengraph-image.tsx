import { ImageResponse } from "next/og";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";

export const alt = "Website preview by ThinkBigJoe";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0a0a0b";
const BRAND_FALLBACK = "#2f6bff";

function titleCase(s: string) {
  return s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function normalizeBrand(raw?: string | null): string {
  if (!raw) return BRAND_FALLBACK;
  const v = raw.startsWith("#") ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : BRAND_FALLBACK;
}

/**
 * Per-site Open Graph card — what shows when a prospect's `/s/<slug>` link is texted or shared.
 * A clean branded card with the business name, niche · city, and rating, in the site's brand color,
 * so every site has a real, professional link preview instead of a generic thumbnail.
 */
export default async function SiteOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [site] = await db
    .select({
      businessName: forgeSites.businessName,
      niche: forgeSites.niche,
      city: forgeSites.city,
      serviceArea: forgeSites.serviceArea,
      googleRating: forgeSites.googleRating,
      reviewCount: forgeSites.reviewCount,
      brandColor: forgeSites.brandColor,
    })
    .from(forgeSites)
    .where(eq(forgeSites.slug, slug))
    .limit(1);

  const businessName = site?.businessName || "Your new website";
  const brand = normalizeBrand(site?.brandColor);
  const nicheLabel = site?.niche ? titleCase(site.niche.split(/[—-]/)[0].trim()) : "Local service";
  const place = site?.city || site?.serviceArea || "";
  const eyebrow = [nicheLabel, place].filter(Boolean).join(" · ");
  const rating = site?.googleRating ? Number(site.googleRating) : 0;
  const reviews = site?.reviewCount ? Number(site.reviewCount) : 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: INK,
          padding: "72px 80px",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* brand glow */}
        <div
          style={{
            position: "absolute",
            top: -200,
            right: -160,
            width: 560,
            height: 560,
            borderRadius: 560,
            background: brand,
            opacity: 0.35,
            filter: "blur(40px)",
            display: "flex",
          }}
        />

        {/* top: preview pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 20px",
              borderRadius: 999,
              background: "#ffffff14",
              border: "1px solid #ffffff26",
              fontSize: 26,
              color: "#e7e9ee",
              fontWeight: 600,
            }}
          >
            <div style={{ display: "flex", width: 14, height: 14, borderRadius: 14, background: brand }} />
            Free website preview
          </div>
        </div>

        {/* middle: business name + eyebrow + rating */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {eyebrow ? (
            <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: brand, letterSpacing: 1 }}>
              {eyebrow.toUpperCase()}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              fontSize: businessName.length > 26 ? 76 : 96,
              fontWeight: 800,
              color: "#fff",
              lineHeight: 1.02,
              letterSpacing: -2,
              maxWidth: 1040,
            }}
          >
            {businessName}
          </div>
          {rating ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 32, color: "#e7e9ee" }}>
              <div style={{ display: "flex", gap: 4 }}>
                {Array.from({ length: Math.min(5, Math.max(1, Math.round(rating))) }).map((_, i) => (
                  <svg key={i} width="34" height="34" viewBox="0 0 24 24" fill="#f6c945">
                    <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 18.9 5.9 21.4l1.4-6.8L2.2 9.9l6.9-.8z" />
                  </svg>
                ))}
              </div>
              <span style={{ display: "flex", fontWeight: 700 }}>{rating.toFixed(1)}</span>
              {reviews ? <span style={{ display: "flex", color: "#9aa0ad" }}>· {reviews} reviews</span> : null}
            </div>
          ) : null}
        </div>

        {/* bottom: brand accent + wordmark */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", width: 160, height: 8, borderRadius: 8, background: brand }} />
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#fff" }}>
            <span>think</span>
            <span style={{ color: brand }}>big</span>
            <span>joe</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
