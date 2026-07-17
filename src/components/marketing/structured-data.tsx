const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";

export function StructuredData() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "ThinkBigJoe",
    url: baseUrl,
    logo: `${baseUrl}/opengraph-image`,
    description:
      "AI agency building custom websites, AI receptionists, and agentic software for established businesses.",
    knowsAbout: [
      "Agentic AI",
      "AI receptionists",
      "AI systems integration",
      "Full-stack development",
    ],
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
