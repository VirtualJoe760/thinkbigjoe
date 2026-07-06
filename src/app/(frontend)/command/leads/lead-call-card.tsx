"use client";

import { useState } from "react";

import type { ForgeSiteItem } from "../sites/sites-queue";

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
  "VA", "WA", "WV", "WI", "WY", "DC",
]);
function stateFrom(s: string): string {
  const t = (s || "").toUpperCase().match(/\b[A-Z]{2}\b/g);
  if (!t) return "";
  for (let i = t.length - 1; i >= 0; i--) if (US_STATES.has(t[i])) return t[i];
  return "";
}
function cityState(i: ForgeSiteItem): string {
  const st = stateFrom(i.serviceArea) || stateFrom(i.city);
  const city = (i.city || "").replace(/,\s*[A-Za-z]{2}\s*$/, "").trim();
  return city ? (st ? `${city}, ${st}` : city) : st;
}
const fmtNum = (n?: number) => (n == null ? "" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const tel = (p: string) => p.replace(/[^\d+]/g, "");
const firstName = (n: string) => (n || "").trim().split(/\s+/)[0] || "";

/** Joe's opener, personalized to the business. */
function openerScript(item: ForgeSiteItem): string {
  const who = firstName(item.ownerName) ? firstName(item.ownerName) : "";
  const niche = (item.niche || "business").split(/[—·,]/)[0].trim().toLowerCase();
  const place = cityState(item);
  return [
    `Hi, is this ${who || "the owner"}?`,
    `I saw you're a local ${niche}${place ? ` in ${place}` : ""} — is that right?`,
    `Great — well, I found your business online and I actually went ahead and built you a website. Do you have a second to check it out with me on the phone?`,
    `Perfect — I'll text you the link right now. Take a look…`,
    `Love it, right? Let's book a quick time to make any changes you want and get you fully set up.`,
  ].join("\n");
}

function Stars({ rating }: { rating: string }) {
  const s = Math.round(Number(rating) || 0);
  if (!rating) return null;
  return (
    <span className="text-amber-500">
      {"★".repeat(Math.max(0, Math.min(5, s)))}
      {"☆".repeat(Math.max(0, 5 - Math.min(5, s)))}
    </span>
  );
}

function Photo({ item }: { item: ForgeSiteItem }) {
  const [broken, setBroken] = useState(false);
  const initials = (item.businessName || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  if (item.photoUrl && !broken) {
    // Plain <img> — external Google/FB CDN URLs, no next/image domain config needed.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.photoUrl}
        alt={item.businessName}
        onError={() => setBroken(true)}
        className="h-16 w-16 shrink-0 rounded-xl object-cover sm:h-20 sm:w-20"
      />
    );
  }
  return (
    <div
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white sm:h-20 sm:w-20"
      style={{ background: item.brandColor || "#64748b" }}
    >
      {initials}
    </div>
  );
}

export function LeadCallCard({ item }: { item: ForgeSiteItem }) {
  const [copied, setCopied] = useState(false);
  const s = item.socialStats || {};
  const reach: string[] = [];
  if (s.instagram?.followers) reach.push(`📷 ${fmtNum(s.instagram.followers)}`);
  if (s.facebook?.followers) reach.push(`👍 ${fmtNum(s.facebook.followers)}`);
  const quotes = (item.reviewQuotes || []).filter((q) => q.text).slice(0, 3);
  const opener = openerScript(item);
  const fullScript = item.callPrep ? `${opener}\n\n— Your angle —\n${item.callPrep}` : opener;
  const smsBody = encodeURIComponent(
    `Hi${firstName(item.ownerName) ? ` ${firstName(item.ownerName)}` : ""}, it's Joe — here's the site I built for ${item.businessName}: ${item.liveUrl || ""}`,
  );

  function copyScript() {
    navigator.clipboard?.writeText(fullScript).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-background p-4 sm:p-5">
      {/* Header: photo + identity + reach */}
      <div className="flex gap-3 sm:gap-4">
        <Photo item={item} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-base font-bold text-ink">{item.businessName}</span>
            {item.googleRating && (
              <span className="inline-flex items-center gap-1 text-sm">
                <Stars rating={item.googleRating} />
                <span className="font-medium text-ink">{item.googleRating}</span>
                {item.reviewCount && <span className="text-ink-soft">· {item.reviewCount} reviews</span>}
              </span>
            )}
          </div>
          <div className="text-sm text-ink-soft">
            {[item.niche, cityState(item)].filter(Boolean).join(" · ")}
          </div>
          {reach.length > 0 && (
            <div className="mt-1 text-xs font-medium text-ink-soft">{reach.join("  ·  ")} followers</div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.phone && (
          <a href={`tel:${tel(item.phone)}`} className="inline-flex items-center gap-1 rounded-full bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">
            📞 Call {item.phone}
          </a>
        )}
        {item.phone && (
          <a href={`sms:${tel(item.phone)}${/(iphone|ipad|mac)/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "") ? "&" : "?"}body=${smsBody}`} className="inline-flex items-center gap-1 rounded-full border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand-tint">
            💬 Text the link
          </a>
        )}
        {item.liveUrl && (
          <a href={item.liveUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-2 text-sm font-medium text-ink-soft hover:text-ink">
            🔗 Live site ↗
          </a>
        )}
        {item.email && (
          <a href={`mailto:${item.email}`} className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-2 text-sm font-medium text-ink-soft hover:text-ink">
            ✉️ Email
          </a>
        )}
      </div>

      {/* Reviews */}
      {quotes.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">What customers say</div>
          <ul className="mt-1.5 space-y-1.5">
            {quotes.map((q, i) => (
              <li key={i} className="text-sm text-ink">
                <span className="text-amber-500">{"★".repeat(Math.max(0, Math.min(5, q.stars || 0)))}</span>{" "}
                <span className="italic">“{q.text}”</span>
                {q.name && <span className="text-ink-soft"> — {q.name}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Calling script */}
      <div className="mt-4 rounded-xl border border-brand/30 bg-brand-tint/40 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wide text-brand">📞 Calling script</span>
          <button onClick={copyScript} className="rounded-full border border-brand/40 px-2.5 py-0.5 text-xs font-semibold text-brand hover:bg-brand-tint">
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
        <div className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{opener}</div>
        {item.callPrep && (
          <div className="mt-3 border-t border-brand/20 pt-2">
            <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">Your angle for this one</div>
            <div className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{item.callPrep}</div>
          </div>
        )}
      </div>
    </div>
  );
}
