import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { initials, nicheStockImage } from "@/lib/preview-assets";

export const dynamic = "force-dynamic";

type PreviewContent = {
  eyebrow?: string;
  headline?: string;
  subcopy?: string;
  heroUrl?: string | null;
  services?: { name: string; blurb: string }[];
  features?: string[];
  stats?: { value: string; label: string }[];
};
type Review = { stars?: number; name?: string; text?: string };

function titleCase(s: string) {
  return s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Monogram logo — the company's initials on a brand-color tile. Used when there's no real logo. */
function Logo({ name, brand, size = 40 }: { name: string; brand: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-xl font-bold text-white"
      style={{ background: brand, width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export default async function SitePreview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.slug, slug)).limit(1);
  if (!site) notFound();

  const brand = site.brandColor?.match(/^#?[0-9a-fA-F]{3,8}$/)
    ? site.brandColor.startsWith("#")
      ? site.brandColor
      : `#${site.brandColor}`
    : "#2563eb";

  const preview = (site.preview ?? null) as PreviewContent | null;
  const reviews = (Array.isArray(site.reviewQuotes) ? site.reviewQuotes : []) as Review[];
  const nicheLabel = site.niche ? titleCase(site.niche.split(/[—-]/)[0].trim()) : "Local service";
  const place = site.city || site.serviceArea || "your area";

  const eyebrow = preview?.eyebrow || `${nicheLabel} · ${place}`;
  const headline = preview?.headline || `${nicheLabel} in ${place}, done right.`;
  const subcopy =
    preview?.subcopy ||
    `${site.businessName} — ${site.serviceArea ? `proudly serving ${site.serviceArea}` : "trusted, local, and reliable"}. Get a fast, no-pressure quote today.`;
  const services = preview?.services?.length ? preview.services : [];
  const features = preview?.features?.length ? preview.features : ["Licensed & insured", "Upfront pricing", "Local & family-owned"];
  const stats = preview?.stats?.length ? preview.stats : [];
  const heroImg = preview?.heroUrl || nicheStockImage(site.niche);

  const rating = site.googleRating;
  const reviewCount = site.reviewCount;
  const daysLeft = site.previewExpiresAt
    ? Math.max(0, Math.ceil((new Date(site.previewExpiresAt).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      {/* preview banner */}
      <div className="w-full px-4 py-2 text-center text-sm text-white" style={{ background: brand }}>
        Free preview of a new website for {site.businessName}.
        {daysLeft !== null && daysLeft > 0 ? ` Reserved for ${daysLeft} more day${daysLeft === 1 ? "" : "s"}.` : ""}{" "}
        <Link href="/portal/claim" className="font-semibold underline underline-offset-2">
          Claim &amp; build it →
        </Link>
      </div>

      {/* nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <span className="flex items-center gap-3">
          <Logo name={site.businessName} brand={brand} size={36} />
          <span className="text-lg font-bold tracking-tight">{site.businessName}</span>
        </span>
        <div className="flex items-center gap-4 text-sm">
          {site.phone ? <span className="hidden font-semibold sm:inline">{site.phone}</span> : null}
          <Link href="/portal/claim" className="rounded-full px-4 py-2 text-sm font-semibold text-white" style={{ background: brand }}>
            Claim this site
          </Link>
        </div>
      </header>

      {/* hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-2 lg:py-16">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: brand }}>{eyebrow}</p>
          <h1 className="mt-3 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">{headline}</h1>
          <p className="mt-5 max-w-xl text-lg text-neutral-600">{subcopy}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            {site.phone ? (
              <a href={`tel:${site.phone.replace(/[^0-9+]/g, "")}`} className="rounded-full px-6 py-3 font-semibold text-white" style={{ background: brand }}>
                Call {site.phone}
              </a>
            ) : null}
            <Link href="/portal/claim" className="rounded-full border-2 px-6 py-3 font-semibold" style={{ borderColor: brand, color: brand }}>
              Claim &amp; launch this site
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-neutral-500">
            {rating ? <span className="font-semibold text-neutral-700">★ {rating}{reviewCount ? ` · ${reviewCount} reviews` : ""}</span> : null}
            <span>Licensed &amp; insured</span>
            <span>Free estimates</span>
          </div>
        </div>

        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroImg} alt={`${nicheLabel} work`} className="aspect-[4/5] w-full rounded-3xl object-cover shadow-xl" />
          <div className="absolute inset-0 rounded-3xl" style={{ boxShadow: `inset 0 -80px 80px -40px ${brand}55` }} />
          <div className="absolute left-5 top-5 flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 shadow">
            <Logo name={site.businessName} brand={brand} size={24} />
            <span className="text-sm font-bold">{site.businessName}</span>
          </div>
        </div>
      </section>

      {/* stats band */}
      {stats.length > 0 ? (
        <section className="py-4">
          <div className="mx-auto grid max-w-5xl grid-cols-3 gap-4 px-6">
            {stats.map((s, i) => (
              <div key={i} className="rounded-2xl border border-neutral-100 bg-neutral-50 py-5 text-center">
                <div className="text-2xl font-bold sm:text-3xl" style={{ color: brand }}>{s.value}</div>
                <div className="mt-1 text-xs font-medium uppercase tracking-wide text-neutral-500">{s.label}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* services */}
      {services.length > 0 ? (
        <section className="py-16">
          <div className="mx-auto max-w-6xl px-6">
            <p className="text-center text-sm font-semibold uppercase tracking-wide" style={{ color: brand }}>What we do</p>
            <h2 className="mt-2 text-center text-3xl font-bold tracking-tight">{nicheLabel} services you can rely on</h2>
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {services.map((s, i) => (
                <div key={i} className="rounded-2xl border border-neutral-200 p-6">
                  <div className="text-2xl font-bold" style={{ color: brand }}>{String(i + 1).padStart(2, "0")}</div>
                  <h3 className="mt-2 text-lg font-semibold">{s.name}</h3>
                  <p className="mt-1.5 text-neutral-600">{s.blurb}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* why us / features */}
      <section className="border-y border-neutral-100 bg-neutral-50 py-12">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6">
          {features.map((f, i) => (
            <span key={i} className="flex items-center gap-2 font-medium text-neutral-700">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-xs text-white" style={{ background: brand }}>✓</span>
              {f}
            </span>
          ))}
        </div>
      </section>

      {/* reviews */}
      {reviews.length > 0 ? (
        <section className="py-16">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight">What your customers already say</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {reviews.slice(0, 3).map((r, i) => (
                <div key={i} className="rounded-2xl border border-neutral-200 p-6">
                  <div className="text-sm" style={{ color: brand }}>{"★".repeat(Math.min(5, Math.round(r.stars || 5)))}</div>
                  <p className="mt-3 text-neutral-700">{r.text}</p>
                  {r.name ? <p className="mt-3 text-sm font-medium text-neutral-500">— {r.name}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* service area */}
      {(site.serviceArea || site.city) ? (
        <section className="pb-4 text-center text-neutral-500">
          <p className="mx-auto max-w-3xl px-6 text-sm">Proudly serving {site.serviceArea || site.city} and the surrounding area.</p>
        </section>
      ) : null}

      {/* claim CTA */}
      <section className="px-6 py-20 text-center text-white" style={{ background: brand }}>
        <Logo name={site.businessName} brand="#ffffff20" size={48} />
        <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-bold">Like it? Make it yours in a few clicks.</h2>
        <p className="mx-auto mt-3 max-w-xl text-white/80">
          Claim {site.businessName}{" "}with the code we sent you and we&apos;ll build and launch the full site — you can even pick a different design.
        </p>
        <Link href="/portal/claim" className="mt-8 inline-block rounded-full bg-white px-8 py-3 font-semibold" style={{ color: brand }}>
          Claim &amp; build my site
        </Link>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-8 text-center text-xs text-neutral-400">
        Preview by ThinkBigJoe · not yet a live site
      </footer>
    </main>
  );
}
