import type { MetadataRoute } from "next";

import { INDUSTRIES } from "@/lib/industries";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/solutions`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...INDUSTRIES.map((i) => ({
      url: `${baseUrl}/for/${i.slug}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.9,
    })),
  ];
}
