import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/dynamic-require packages external so the bundler doesn't break them:
  // nodemailer uses dynamic requires for its transports; sharp ships a per-platform native
  // binary that must load at runtime (bundling it 500s the newsletter image routes on Vercel).
  serverExternalPackages: ["nodemailer", "sharp"],
  // Next's file tracing doesn't reliably pull sharp's native libvips (.so) into the serverless
  // function, so it fails at runtime with ERR_DLOPEN_FAILED. Force the linux binaries into the
  // trace for the routes that use sharp. (@img/** on Vercel's linux build = only the linux libs.)
  outputFileTracingIncludes: {
    "/api/newsletter/upload": ["./node_modules/@img/**"],
    "/api/newsletter/generate-banner": ["./node_modules/@img/**"],
  },
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
