import type { NextConfig } from "next";
import { withPayload } from "@payloadcms/next/withPayload";

const nextConfig: NextConfig = {
  // Nodemailer uses dynamic requires for its transports — keep it external so
  // the bundler doesn't choke on it.
  serverExternalPackages: ["nodemailer"],
};

export default withPayload(nextConfig);
