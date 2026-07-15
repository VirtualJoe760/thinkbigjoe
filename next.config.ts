import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/dynamic-require packages external so the bundler doesn't break them:
  // nodemailer uses dynamic requires for its transports; sharp ships a per-platform native
  // binary that must load at runtime (bundling it 500s the newsletter image routes on Vercel).
  serverExternalPackages: ["nodemailer", "sharp"],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
