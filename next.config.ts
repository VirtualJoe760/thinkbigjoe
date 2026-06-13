import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Nodemailer uses dynamic requires for its transports — keep it external so
  // the bundler doesn't choke on it.
  serverExternalPackages: ["nodemailer"],
};

export default nextConfig;
