import type { NextConfig } from "next";
import { withPayload } from "@payloadcms/next/withPayload";

const nextConfig: NextConfig = {
  // Load sharp from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["sharp"],
  // sharp loads its libvips binary via runtime dlopen, which file tracing
  // (@vercel/nft) can't follow — so force sharp + its @img native libs into
  // every server function bundle. Without this, /admin and upload routes 500
  // on Vercel with sharp ERR_DLOPEN_FAILED (libvips-cpp.so).
  outputFileTracingIncludes: {
    "/*": ["node_modules/sharp/**/*", "node_modules/@img/**/*"],
    "/**": ["node_modules/sharp/**/*", "node_modules/@img/**/*"],
  },
};

export default withPayload(nextConfig);
