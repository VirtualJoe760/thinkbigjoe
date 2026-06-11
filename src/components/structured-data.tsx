const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";

export function StructuredData() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "ThinkBigJoe",
    url: baseUrl,
    logo: `${baseUrl}/opengraph-image`,
    description:
      "AI consulting agency building agentic software and Model Context Protocol (MCP) solutions for businesses.",
    knowsAbout: [
      "Agentic AI",
      "Model Context Protocol",
      "AI strategy",
      "Software development",
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
