import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Nodemailer uses dynamic requires for its transports — keep it external so
  // the bundler doesn't choke on it.
  serverExternalPackages: ["nodemailer"],
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
