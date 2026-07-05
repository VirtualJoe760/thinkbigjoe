"use client";

import { useState, useTransition } from "react";

import { approveForgeSite, denyForgeSite } from "../actions";

export type ForgeSiteItem = {
  id: string;
  slug: string;
  businessName: string;
  niche: string;
  city: string;
  serviceArea: string;
  phone: string;
  email: string;
  existingWebsiteUrl: string;
  brandColor: string;
  theme: string;
  googleRating: string;
  reviewCount: string;
  googleMapsUrl: string;
  linkedinUrl: string;
  status: string;
  fitReason: string;
  source: string;
  notes: string;
  liveUrl: string;
  screenshotUrl: string;
  buildStatus: string;
  deniedReason: string;
  claimCode: string;
  claimed: boolean;
  createdAt: string;
};

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    discovered: "bg-amber-100 text-amber-800",
    approved: "bg-blue-100 text-blue-800",
    building: "bg-blue-100 text-blue-800",
    built: "bg-green-100 text-green-800",
    denied: "bg-surface text-ink-soft",
    build_failed: "bg-red-100 text-red-700",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status] || "bg-surface text-ink-soft"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function Rating({ item }: { item: ForgeSiteItem }) {
  if (!item.googleRating) return null;
  const stars = Math.round(Number(item.googleRating) || 0);
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-ink">
      <span className="text-amber-500">
        {"★".repeat(Math.max(0, Math.min(5, stars)))}
        {"☆".repeat(Math.max(0, 5 - Math.min(5, stars)))}
      </span>
      <span>{item.googleRating}</span>
      {item.reviewCount && <span className="text-ink-soft">· {item.reviewCount} reviews</span>}
    </span>
  );
}

function mapsQuery(item: ForgeSiteItem) {
  return encodeURIComponent([item.businessName, item.city].filter(Boolean).join(", "));
}
// Deep-link to the business on Google Maps. Prefer the URL the prospector captured;
// otherwise a Maps search on name + city (so every lead has a working link).
function mapsSearchUrl(item: ForgeSiteItem) {
  return item.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${mapsQuery(item)}`;
}

function ExternalLinks({ item }: { item: ForgeSiteItem }) {
  const links: Array<{ label: string; href: string }> = [
    { label: "Google", href: mapsSearchUrl(item) },
  ];
  if (item.linkedinUrl) links.push({ label: "LinkedIn", href: item.linkedinUrl });
  if (item.existingWebsiteUrl) links.push({ label: "Existing site", href: item.existingWebsiteUrl });
  return (
    <>
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-brand underline underline-offset-2"
        >
          {l.label} ↗
        </a>
      ))}
    </>
  );
}

// Google's free Maps Embed API (needs a key; Google blocks the old keyless embed).
// Set NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY to show a live map; without it we render a
// clean clickable placeholder that opens the listing — never a blank box.
const MAPS_EMBED_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY;

function BusinessMap({ item }: { item: ForgeSiteItem }) {
  if (!item.city && !item.businessName) return null;
  const href = mapsSearchUrl(item);

  if (MAPS_EMBED_KEY) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={`Open ${item.businessName} in Google Maps`}
        className="group relative block h-40 overflow-hidden rounded-xl border border-line sm:h-full sm:min-h-[9rem]"
      >
        <iframe
          title={`Map of ${item.businessName}`}
          src={`https://www.google.com/maps/embed/v1/place?key=${MAPS_EMBED_KEY}&q=${mapsQuery(item)}&zoom=13`}
          className="pointer-events-none h-full w-full"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
        <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft opacity-0 transition-opacity group-hover:opacity-100">
          Open in Maps ↗
        </span>
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex h-32 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-surface text-center text-sm text-ink-soft transition-colors hover:border-brand hover:text-brand sm:h-full sm:min-h-[9rem]"
    >
      <span className="text-2xl leading-none">📍</span>
      <span className="font-medium">View on Google Maps ↗</span>
      {item.city && <span className="text-xs">{item.city}</span>}
    </a>
  );
}

function DiscoveredRow({ item }: { item: ForgeSiteItem }) {
  const [pending, start] = useTransition();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<string | null>(null);

  if (done) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-4 text-sm text-ink-soft">
        {item.businessName} — {done}.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-background p-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_15rem]">
        <div className="order-2 min-w-0 sm:order-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-ink">{item.businessName}</span>
                <Rating item={item} />
              </div>
              <div className="text-sm text-ink-soft">{item.niche} · {item.city}</div>
            </div>
            <StatusPill status={item.status} />
          </div>
          {item.fitReason && <p className="mt-2 text-sm text-ink-soft">{item.fitReason}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
            {item.phone && <span>{item.phone}</span>}
            {item.email && <span>{item.email}</span>}
            <ExternalLinks item={item} />
            {item.source && <span>found via {item.source}</span>}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
        {denying ? (
          <>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why? (optional)"
              className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <button
              disabled={pending}
              onClick={() => start(async () => { await denyForgeSite(item.id, reason); setDone("denied"); })}
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-surface disabled:opacity-60"
            >
              Confirm deny
            </button>
            <button
              disabled={pending}
              onClick={() => { setDenying(false); setReason(""); }}
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              disabled={pending}
              onClick={() => start(async () => { await approveForgeSite(item.id); setDone("approved — queued to build"); })}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              Approve to build
            </button>
            <button
              disabled={pending}
              onClick={() => setDenying(true)}
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-surface disabled:opacity-60"
            >
              Deny
            </button>
          </>
        )}
          </div>
        </div>
        <div className="order-1 sm:order-2">
          <BusinessMap item={item} />
        </div>
      </div>
    </div>
  );
}

function SimpleRow({ item }: { item: ForgeSiteItem }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-background p-4">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold text-ink">{item.businessName}</span>
          <Rating item={item} />
        </div>
        <div className="text-sm text-ink-soft">{item.niche} · {item.city}</div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <ExternalLinks item={item} />
        {item.liveUrl && (
          <a href={item.liveUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand underline">
            View live site
          </a>
        )}
        {item.claimCode && <ClaimCode item={item} />}
        <StatusPill status={item.status} />
      </div>
    </div>
  );
}

function ClaimCode({ item }: { item: ForgeSiteItem }) {
  if (item.claimed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 font-semibold text-green-800">
        ✓ Claimed
      </span>
    );
  }
  return (
    <span
      title="Give this code to the owner — they redeem it at /portal/claim after signing up."
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 font-mono font-semibold text-ink"
    >
      <span className="text-ink-soft">claim:</span> {item.claimCode}
    </span>
  );
}

export function SitesQueue({ items }: { items: ForgeSiteItem[] }) {
  if (!items.length) {
    return <p className="text-sm text-ink-soft">Nothing here yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) =>
        item.status === "discovered" ? (
          <DiscoveredRow key={item.id} item={item} />
        ) : (
          <SimpleRow key={item.id} item={item} />
        ),
      )}
    </div>
  );
}
