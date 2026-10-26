const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";

export function StructuredData() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "ThinkBigJoe",
    url: baseUrl,
    logo: `${baseUrl}/opengraph-image`,
    description:
      "24/7 call answering and websites for home service businesses in the Coachella Valley — contractors, plumbers, HVAC, roofers and remodelers.",
    areaServed: [
      "Palm Springs, CA", "Cathedral City, CA", "Rancho Mirage, CA", "Palm Desert, CA",
      "Indian Wells, CA", "La Quinta, CA", "Indio, CA", "Coachella, CA", "Desert Hot Springs, CA",
    ],
    knowsAbout: [
      "AI receptionists",
      "Call answering for contractors",
      "Websites for home service businesses",
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
