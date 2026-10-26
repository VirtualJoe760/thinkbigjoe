const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";

export function StructuredData() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "ThinkBigJoe",
    url: baseUrl,
    logo: `${baseUrl}/opengraph-image`,
    description:
      "Custom websites from small to enterprise-grade, with AI agents (including voice) built in, for home service businesses in the Coachella Valley.",
    areaServed: [
      "Palm Springs, CA", "Cathedral City, CA", "Rancho Mirage, CA", "Palm Desert, CA",
      "Indian Wells, CA", "La Quinta, CA", "Indio, CA", "Coachella, CA", "Desert Hot Springs, CA",
    ],
    knowsAbout: [
      "Website design and development",
      "Custom web applications",
      "AI agents",
      "AI receptionists",
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
