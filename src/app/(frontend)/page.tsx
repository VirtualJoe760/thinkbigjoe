import { SiteNav } from "@/components/site-nav";
import { Hero } from "@/components/hero";
import { Services } from "@/components/services";
import { Pricing } from "@/components/pricing";
import { Approach } from "@/components/approach";
import { Founder } from "@/components/founder";
import { ContactCTA } from "@/components/contact-cta";
import { SiteFooter } from "@/components/site-footer";
import { StructuredData } from "@/components/structured-data";

export default function Home() {
  return (
    <>
      <StructuredData />
      <SiteNav />
      <main className="flex-1">
        <Hero />
        <Services />
        <Pricing />
        <Approach />
        <Founder />
        <ContactCTA />
      </main>
      <SiteFooter />
    </>
  );
}
