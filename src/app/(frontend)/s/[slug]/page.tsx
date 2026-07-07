import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";

export const dynamic = "force-dynamic";

type PreviewContent = { headline?: string; subcopy?: string; heroUrl?: string; eyebrow?: string };
type Review = { stars?: number; name?: string; text?: string };

function titleCase(s: string) {
  return s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function SitePreview({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [site] = await db
    .select()
    .from(forgeSites)
    .where(eq(forgeSites.slug, slug))
    .limit(1);

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
  const headline =
    preview?.headline || `${nicheLabel} in ${place}, done right.`;
  const subcopy =
    preview?.subcopy ||
    `${site.businessName} — ${site.serviceArea ? `proudly serving ${site.serviceArea}` : "trusted, local, and reliable"}. Get a fast, no-pressure quote today.`;

  const rating = site.googleRating;
  const reviewCount = site.reviewCount;

  const daysLeft = site.previewExpiresAt
    ? Math.max(0, Math.ceil((new Date(site.previewExpiresAt).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      {/* preview banner */}
      <div className="w-full px-4 py-2 text-center text-sm text-white" style={{ background: brand }}>
        This is a free preview of a new website for {site.businessName}.
        {daysLeft !== null && daysLeft > 0 ? ` Reserved for ${daysLeft} more day${daysLeft === 1 ? "" : "s"}.` : ""}{" "}
        <Link href="/portal/claim" className="font-semibold underline underline-offset-2">
          Claim &amp; build it →
        </Link>
      </div>

      {/* nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-bold tracking-tight">{site.businessName}</span>
        <div className="flex items-center gap-4 text-sm">
          {site.phone ? <span className="hidden font-medium sm:inline">{site.phone}</span> : null}
          <Link
            href="/portal/claim"
            className="rounded-full px-4 py-2 text-sm font-semibold text-white"
            style={{ background: brand }}
          >
            Claim this site
          </Link>
        </div>
      </header>

      {/* hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-12 lg:grid-cols-2 lg:py-20">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: brand }}>
            {eyebrow}
          </p>
          <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            {headline}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-neutral-600">{subcopy}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            {site.phone ? (
              <a
                href={`tel:${site.phone.replace(/[^0-9+]/g, "")}`}
                className="rounded-full px-6 py-3 font-semibold text-white"
                style={{ background: brand }}
              >
                Call {site.phone}
              </a>
            ) : null}
            <Link
              href="/portal/claim"
              className="rounded-full border-2 px-6 py-3 font-semibold"
              style={{ borderColor: brand, color: brand }}
            >
              Claim &amp; launch this site
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-neutral-500">
            {rating ? (
              <span className="font-medium text-neutral-700">
                ★ {rating}
                {reviewCount ? ` · ${reviewCount} reviews` : ""}
              </span>
            ) : null}
            <span>Licensed &amp; insured</span>
            <span>Free estimates</span>
          </div>
        </div>

        <div className="relative">
          {preview?.heroUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.heroUrl}
              alt={`${site.businessName} preview`}
              className="aspect-[4/5] w-full rounded-3xl object-cover shadow-xl"
            />
          ) : (
            <div
              className="flex aspect-[4/5] w-full items-center justify-center rounded-3xl text-center text-2xl font-bold text-white shadow-xl"
              style={{ background: `linear-gradient(140deg, ${brand}, #111)` }}
            >
              {site.businessName}
            </div>
          )}
        </div>
      </section>

      {/* reviews */}
      {reviews.length > 0 ? (
        <section className="border-t border-neutral-100 bg-neutral-50 py-16">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-2xl font-bold">What your customers already say</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {reviews.slice(0, 3).map((r, i) => (
                <div key={i} className="rounded-2xl border border-neutral-200 bg-white p-6">
                  <div className="text-sm" style={{ color: brand }}>
                    {"★".repeat(Math.min(5, Math.round(r.stars || 5)))}
                  </div>
                  <p className="mt-3 text-neutral-700">{r.text}</p>
                  {r.name ? <p className="mt-3 text-sm font-medium text-neutral-500">— {r.name}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* claim CTA */}
      <section className="px-6 py-20 text-center text-white" style={{ background: brand }}>
        <h2 className="mx-auto max-w-2xl text-3xl font-bold">
          Like it? Make it yours in a few clicks.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-white/80">
          Claim {site.businessName}{" "}with the code we sent you and we&apos;ll build and launch the
          full site — you can even pick a different design.
        </p>
        <Link
          href="/portal/claim"
          className="mt-8 inline-block rounded-full bg-white px-8 py-3 font-semibold"
          style={{ color: brand }}
        >
          Claim &amp; build my site
        </Link>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-8 text-center text-xs text-neutral-400">
        Preview by ThinkBigJoe · not yet a live site
      </footer>
    </main>
  );
}
