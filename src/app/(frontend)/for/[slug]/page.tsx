import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BookingWizard } from "@/components/booking/booking-wizard";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteNav } from "@/components/marketing/site-nav";
import { getIndustry, INDUSTRIES } from "@/lib/industries";

export function generateStaticParams() {
  return INDUSTRIES.map((i) => ({ slug: i.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const industry = getIndustry(slug);
  if (!industry) return {};
  return {
    title: `AI for ${industry.name}`,
    description: industry.subhead,
  };
}

export default async function IndustryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const industry = getIndustry(slug);
  if (!industry) notFound();

  return (
    <>
      <SiteNav />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.4]"
            style={{
              backgroundImage:
                "linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
              backgroundSize: "64px 64px",
              maskImage:
                "radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 75%)",
            }}
          />
          <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-16 md:pt-28 md:pb-24">
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold tracking-wide text-ink-soft uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              AI for {industry.name}
            </div>
            <h1 className="mt-8 max-w-4xl text-4xl font-extrabold leading-[1.05] tracking-tight text-balance md:text-6xl">
              {industry.headline}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft md:text-xl">
              {industry.subhead}
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link
                href="#intake"
                className="inline-flex items-center justify-center rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
              >
                Book a strategy call
              </Link>
              <Link
                href="#use-cases"
                className="inline-flex items-center justify-center rounded-full border border-line bg-background px-7 py-3.5 text-base font-semibold text-ink transition-colors hover:bg-surface"
              >
                See what we&apos;d automate
              </Link>
            </div>
          </div>
        </section>

        {/* Pain points */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">
              Sound familiar?
            </p>
            <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight md:text-4xl">
              The work that's eating your team alive.
            </h2>
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
              {industry.painPoints.map((p) => (
                <div key={p.title} className="bg-background p-8">
                  <h3 className="text-xl font-bold tracking-tight">{p.title}</h3>
                  <p className="mt-3 leading-relaxed text-ink-soft">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Use cases */}
        <section id="use-cases">
          <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">
              What we build
            </p>
            <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight md:text-4xl">
              Custom agents for {industry.short} — not another SaaS login.
            </h2>
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-2">
              {industry.useCases.map((u, i) => (
                <div
                  key={u.title}
                  className="group bg-background p-8 transition-colors hover:bg-brand-tint md:p-10"
                >
                  <span className="text-sm font-bold text-brand">0{i + 1}</span>
                  <h3 className="mt-4 text-2xl font-bold tracking-tight">
                    {u.title}
                  </h3>
                  <p className="mt-3 leading-relaxed text-ink-soft">{u.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Intake → booking */}
        <section id="intake" className="border-t border-line bg-surface">
          <div className="mx-auto max-w-3xl px-6 py-20 md:py-28">
            <p className="text-center text-sm font-semibold tracking-wide text-brand uppercase">
              Free strategy call
            </p>
            <h2 className="mt-3 text-center text-3xl font-extrabold tracking-tight md:text-4xl">
              {industry.ctaHeading}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-center leading-relaxed text-ink-soft">
              {industry.ctaBody}
            </p>
            <div className="mt-10">
              <BookingWizard industry={industry.slug} />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
