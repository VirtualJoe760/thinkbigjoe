import { SiteNav } from "@/components/marketing/site-nav";
import { Hero } from "@/components/marketing/hero";
import { Services } from "@/components/marketing/services";
import { Testimonials } from "@/components/marketing/testimonials";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { ContactCTA } from "@/components/marketing/contact-cta";
import { SiteFooter } from "@/components/marketing/site-footer";
import { StructuredData } from "@/components/marketing/structured-data";

export default function Home() {
  return (
    <>
      <StructuredData />
      <SiteNav />
      <main className="flex-1">
        <Hero />
        <Services />
        <Testimonials />
        <HowItWorks />
        <ContactCTA />
      </main>
      <SiteFooter />
    </>
  );
}
