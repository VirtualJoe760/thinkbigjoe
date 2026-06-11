import type { NextConfig } from "next";
import { withPayload } from "@payloadcms/next/withPayload";

const nextConfig: NextConfig = {
  // Load sharp from node_modules at runtime instead of bundling it, so its
  // native binaries resolve correctly in the Vercel serverless runtime.
  serverExternalPackages: ["sharp"],
};

export default withPayload(nextConfig);
