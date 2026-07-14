import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { BookingForm } from "./booking-form";

export const dynamic = "force-dynamic";

/**
 * The public booking page for a CLIENT's business — the page their "Book Online" button points at.
 *
 * Client sites are static (no backend), so booking lives here on TBJ and writes straight onto the
 * owner's own Google Calendar + Contacts. This is the page the Google verification demo video shows.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [site] = await db
    .select({ businessName: forgeSites.businessName })
    .from(forgeSites)
    .where(eq(forgeSites.slug, slug))
    .limit(1);
  const name = site?.businessName || "this business";
  return {
    title: `Book ${name}`,
    description: `Pick a time and book ${name} online.`,
    robots: { index: false, follow: false },
  };
}

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [site] = await db
    .select({
      businessName: forgeSites.businessName,
      brandColor: forgeSites.brandColor,
      phone: forgeSites.phone,
      liveUrl: forgeSites.liveUrl,
      siteDeletedAt: forgeSites.siteDeletedAt,
    })
    .from(forgeSites)
    .where(eq(forgeSites.slug, slug))
    .limit(1);

  if (!site || site.siteDeletedAt) notFound();

  const raw = site.brandColor?.trim() || "";
  const candidate = raw.startsWith("#") ? raw : raw ? `#${raw}` : "";
  const brand = /^#[0-9a-fA-F]{3,8}$/.test(candidate) ? candidate : "#2563eb";

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: brand }}>
        Book online
      </p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">{site.businessName}</h1>
      <p className="mt-3 leading-relaxed text-ink-soft">
        Pick a time that works for you and we&apos;ll confirm it.
        {site.phone ? (
          <>
            {" "}Prefer to talk?{" "}
            <a href={`tel:${site.phone.replace(/[^\d+]/g, "")}`} className="font-semibold hover:underline" style={{ color: brand }}>
              Call {site.phone}
            </a>
            .
          </>
        ) : null}
      </p>

      <div className="mt-10">
        <BookingForm slug={slug} brand={brand} />
      </div>

      {site.liveUrl && (
        <p className="mt-10 border-t border-line pt-6 text-sm text-ink-soft">
          <a href={site.liveUrl} className="font-semibold hover:underline" style={{ color: brand }}>
            ← Back to {site.businessName}
          </a>
        </p>
      )}
    </main>
  );
}
