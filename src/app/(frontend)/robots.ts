import type { MetadataRoute } from "next";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep the admin + client portal out of search results.
      disallow: ["/admin", "/portal", "/login", "/api/"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
