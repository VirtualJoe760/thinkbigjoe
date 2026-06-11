import { SiteNav } from "@/components/site-nav";
import { Hero } from "@/components/hero";
import { Services } from "@/components/services";
import { Approach } from "@/components/approach";
import { ContactCTA } from "@/components/contact-cta";
import { SiteFooter } from "@/components/site-footer";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main className="flex-1">
        <Hero />
        <Services />
        <Approach />
        <ContactCTA />
      </main>
      <SiteFooter />
    </>
  );
}
