import { ImageResponse } from "next/og";

export const alt = "ThinkBigJoe — Agentic AI & MCP development";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0a0a0b";
const BRAND = "#2f6bff";

export default function OpengraphImage() {
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
        }}
      >
        {/* logo lockup */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              borderRadius: 16,
              background: BRAND,
            }}
          >
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
              <path d="M9 18h6" />
              <path d="M10 22h4" />
            </svg>
          </div>
          <div style={{ display: "flex", fontSize: 38, fontWeight: 700, color: "#fff" }}>
            <span>think</span>
            <span style={{ color: BRAND }}>big</span>
            <span>joe</span>
          </div>
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              fontSize: 84,
              fontWeight: 800,
              color: "#fff",
              lineHeight: 1.05,
              letterSpacing: -2,
              maxWidth: 1000,
            }}
          >
            Deploy AI&nbsp;<span style={{ color: BRAND }}>agents</span>&nbsp;that
            run your business.
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#9aa0ad" }}>
            Agentic software · MCP development · AI strategy
          </div>
        </div>

        {/* accent bar */}
        <div style={{ display: "flex", width: 160, height: 8, borderRadius: 8, background: BRAND }} />
      </div>
    ),
    { ...size },
  );
}
