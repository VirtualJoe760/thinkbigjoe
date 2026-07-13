"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { denyForgeSite, deleteForgeSite, sendForgeOutreach, skipForgeOutreach, approveForMarketing, unapproveMarketing, requestForgeRevision, requestForgeRebuild } from "../actions";
import { toast } from "@/components/toast";

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
  hasPreview?: boolean;
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
  outreachStatus: string;
  leadStage?: string;
  outreachSubject: string;
  outreachDraft: string;
  contactedAt: string;
  followupCount: number;
  ownerName: string;
  instagramUrl: string;
  facebookUrl: string;
  contactNotes: string;
  socialStats: { facebook?: { followers?: number; likes?: number }; instagram?: { followers?: number }; linkedin?: { followers?: number } } | null;
  reviewQuotes: Array<{ stars?: number; name?: string; text?: string }>;
  callPrep: string;
  photoUrl: string;
  marketingApprovedAt: string;
  revisionNote: string;
};

const fmtNum = (n?: number) => (n == null ? "" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/** Call-prep card: social reach digest, a few review quotes, and a talking-points
 *  script so Joe has real context before he dials. Collapsed by default. */
function CallPrepCard({ item }: { item: ForgeSiteItem }) {
  const [open, setOpen] = useState(false);
  const s = item.socialStats || {};
  const reach: string[] = [];
  if (s.instagram?.followers) reach.push(`📷 ${fmtNum(s.instagram.followers)} IG`);
  if (s.facebook?.followers) reach.push(`👍 ${fmtNum(s.facebook.followers)} FB`);
  if (s.linkedin?.followers) reach.push(`in ${fmtNum(s.linkedin.followers)} LinkedIn`);
  const quotes = (item.reviewQuotes || []).filter((q) => q.text).slice(0, 3);
  if (!item.callPrep && !quotes.length && !reach.length) return null;

  return (
    <div className="mt-2 rounded-xl border border-brand/30 bg-brand-tint/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-ink">
          📋 Call prep
          {reach.length > 0 && <span className="text-xs font-medium text-ink-soft">{reach.join(" · ")}</span>}
          {quotes.length > 0 && <span className="text-xs font-medium text-ink-soft">· {quotes.length} review quotes</span>}
        </span>
        <span className="text-xs text-brand">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-brand/20 px-3 py-2.5">
          {quotes.length > 0 && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">What customers say</div>
              <ul className="mt-1 space-y-1.5">
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
          {item.callPrep && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">Talking points</div>
              <div className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{item.callPrep}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
  "VA", "WA", "WV", "WI", "WY", "DC",
]);

/** Pull a US state code out of a free-text location (service area usually ends "…, AZ"). */
function stateFrom(s: string): string {
  const tokens = (s || "").toUpperCase().match(/\b[A-Z]{2}\b/g);
  if (!tokens) return "";
  // Prefer the last valid state token — the state trails the location string.
  for (let i = tokens.length - 1; i >= 0; i--) if (US_STATES.has(tokens[i])) return tokens[i];
  return "";
}

/** "Mesa, AZ" from city="Mesa" + serviceArea="Mesa, AZ East Valley". */
function cityState(item: ForgeSiteItem): string {
  const st = stateFrom(item.serviceArea) || stateFrom(item.city);
  const city = (item.city || "").replace(/,\s*[A-Za-z]{2}\s*$/, "").trim();
  if (!city) return st;
  return st ? `${city}, ${st}` : city;
}

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

/** The one-glance contact card: owner + click-to-call + click-to-email + socials,
 *  so Joe can start dialing straight from the lead. */
function ContactCard({ item }: { item: ForgeSiteItem }) {
  const previewUrl = item.hasPreview && item.slug ? `/s/${item.slug}` : null;
  const socials: Array<{ label: string; href: string }> = [
    { label: "Maps", href: mapsSearchUrl(item) },
    item.instagramUrl && { label: "Instagram", href: item.instagramUrl },
    item.facebookUrl && { label: "Facebook", href: item.facebookUrl },
    item.linkedinUrl && { label: "LinkedIn", href: item.linkedinUrl },
  ].filter(Boolean) as Array<{ label: string; href: string }>;
  return (
    <div className="mt-2 rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {item.ownerName && <span className="text-sm font-semibold text-ink">{item.ownerName}</span>}
        {item.phone ? (
          <a href={`tel:${item.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 rounded-full bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700">
            📞 Call {item.phone}
          </a>
        ) : (
          <span className="rounded-full bg-background px-2.5 py-1 text-xs font-medium text-ink-soft">no phone</span>
        )}
        {item.email ? (
          <a href={`mailto:${item.email}`} className="inline-flex items-center gap-1 rounded-full border border-brand px-3 py-1 text-xs font-semibold text-brand hover:bg-brand-tint">
            ✉️ {item.email}
          </a>
        ) : (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">no email — enriching</span>
        )}
      </div>

      {/* The site we built (their preview) vs their existing site — compare both. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {previewUrl ? (
          <a href={previewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-dark">
            🔎 Site preview ↗
          </a>
        ) : (
          <span className="rounded-full bg-background px-2.5 py-1 text-xs font-medium text-ink-soft">preview generating…</span>
        )}
        {item.existingWebsiteUrl ? (
          <a href={item.existingWebsiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-line bg-background px-3 py-1 text-xs font-semibold text-ink hover:bg-surface">
            🌐 Existing site ↗
          </a>
        ) : (
          <span className="rounded-full bg-background px-2.5 py-1 text-xs font-medium text-ink-soft">no existing site</span>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {socials.map((s) => (
          <a key={s.label} href={s.href} target="_blank" rel="noreferrer" className="font-medium text-brand underline underline-offset-2">
            {s.label} ↗
          </a>
        ))}
      </div>
      {item.contactNotes && <p className="mt-1.5 text-xs text-ink-soft">{item.contactNotes}</p>}
    </div>
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
  const router = useRouter();
  const [pending, start] = useTransition();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [removed, setRemoved] = useState(false);

  // Approved/denied prospects vanish (toast confirms); router.refresh pulls the next
  // prospect into the page so the queue stays full.
  if (removed) return null;

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
              <div className="text-sm text-ink-soft">{item.niche} · {cityState(item)}</div>
            </div>
            <StatusPill status={item.status} />
          </div>
          {item.fitReason && <p className="mt-2 text-sm text-ink-soft">{item.fitReason}</p>}
          <ContactCard item={item} />
          <CallPrepCard item={item} />
          {item.source && <p className="mt-1.5 text-xs text-ink-soft">found via {item.source}</p>}
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
              onClick={() => start(async () => { await denyForgeSite(item.id, reason); toast(`${item.businessName} denied`); setRemoved(true); router.refresh(); })}
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
              onClick={() => start(async () => {
                const r = await approveForMarketing(item.id);
                if (r.ok) { toast(`${item.businessName} approved for marketing`); setRemoved(true); router.refresh(); }
                else { toast(r.message || "Couldn't approve"); }
              })}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              Approve for marketing
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

/** Built-site controls: review tools (edit / studio / AI revision) + the marketing gate.
 *  A built site is NOT a lead until "Approve for marketing" is clicked. */
function BuiltActions({ item }: { item: ForgeSiteItem }) {
  const [revising, setRevising] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const approved = !!item.marketingApprovedAt;

  const send = (fn: () => Promise<{ ok: boolean; message: string }>) => {
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg(r.message);
      if (r.ok) { setRevising(false); setPrompt(""); }
    });
  };

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <a href={`/portal/edit/${item.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-line bg-background px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface">
          ✏️ Edit site
        </a>
        <a href={`/portal/edit/${item.id}?tab=studio`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-line bg-background px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface">
          🎨 Image studio
        </a>
        <button onClick={() => setRevising((v) => !v)} className="inline-flex items-center gap-1 rounded-full border border-line bg-background px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface">
          🛠 Ask forge to revise
        </button>
        <button
          onClick={() => { if (confirm("Rebuild this site from scratch with a completely different design? The current build is replaced.")) send(() => requestForgeRebuild(item.id)); }}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-background px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface disabled:opacity-50"
        >
          🎲 Rebuild differently
        </button>
        {confirmDel ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-xs">
            <span className="font-semibold text-red-700">Delete this site?</span>
            <button
              onClick={() => send(() => deleteForgeSite(item.id))}
              disabled={pending}
              className="rounded-full bg-red-600 px-2.5 py-0.5 font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Yes, delete
            </button>
            <button onClick={() => setConfirmDel(false)} className="px-1 font-medium text-ink-soft hover:text-ink">cancel</button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmDel(true)}
            disabled={pending}
            title="Remove from every view (recoverable in the DB). For demos/tests/mistakes — use Deny to reject a real business."
            className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-background px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            🗑 Delete
          </button>
        )}
        <span className="flex-1" />
        {approved ? (
          <span className="inline-flex items-center gap-2">
            <span className="rounded-full bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-700">✓ Approved for marketing — it&apos;s a lead</span>
            <button onClick={() => send(() => unapproveMarketing(item.id).then(() => ({ ok: true, message: "Pulled back to review." })))} disabled={pending} className="text-xs font-medium text-ink-soft hover:text-ink disabled:opacity-50">
              undo
            </button>
          </span>
        ) : (
          <button onClick={() => send(() => approveForMarketing(item.id))} disabled={pending} className="inline-flex items-center gap-1 rounded-full bg-green-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50">
            ✓ Approve for marketing →
          </button>
        )}
      </div>

      {item.revisionNote && !approved && (
        <p className="mt-2 text-xs text-amber-700">🛠 Revision in progress: &ldquo;{item.revisionNote}&rdquo; — the forge is rebuilding it.</p>
      )}

      {revising && (
        <div className="mt-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder='Tell the forge what to change, e.g. "change the hero to an image carousel" or "make the services a 3-column grid"'
            className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => send(() => requestForgeRevision(item.id, prompt))} disabled={pending || prompt.trim().length < 4} className="rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {pending ? "Sending…" : "Send to forge"}
            </button>
            <button onClick={() => { setRevising(false); setPrompt(""); }} className="text-xs font-medium text-ink-soft hover:text-ink">Cancel</button>
            <span className="text-xs text-ink-soft">rebuilds the site with your change (a few min)</span>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-xs font-medium text-brand">{msg}</p>}
    </div>
  );
}

function SimpleRow({ item }: { item: ForgeSiteItem }) {
  const showOutreach = item.status === "built" && !item.claimed;
  return (
    <div className="rounded-2xl border border-line bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-ink">{item.businessName}</span>
            <Rating item={item} />
          </div>
          <div className="text-sm text-ink-soft">{item.niche} · {cityState(item)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {item.liveUrl && (
            <a href={item.liveUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand underline">
              View live site
            </a>
          )}
          {item.claimCode && <ClaimCode item={item} />}
          <StatusPill status={item.status} />
        </div>
      </div>
      {item.status === "built" && <BuiltActions item={item} />}
      <ContactCard item={item} />
      {/* Outreach only after the site is approved for marketing (it's a lead then). */}
      {showOutreach && item.marketingApprovedAt && <OutreachPanel item={item} />}
    </div>
  );
}

const OUTREACH_PILL: Record<string, string> = {
  none: "bg-amber-100 text-amber-800",
  drafted: "bg-blue-100 text-blue-800",
  sent: "bg-green-100 text-green-800",
  replied: "bg-violet-100 text-violet-800",
  scheduled: "bg-green-100 text-green-800",
  skipped: "bg-surface text-ink-soft",
};

function OutreachPanel({ item }: { item: ForgeSiteItem }) {
  const status = item.outreachStatus || "none";
  const [open, setOpen] = useState(status === "drafted");
  const [subject, setSubject] = useState(
    item.outreachSubject || `Your new website is ready, ${item.businessName}`,
  );
  const [body, setBody] = useState(
    item.outreachDraft ||
      `Hi ${item.businessName} team,\n\nI'm Joe with ThinkBigJoe. I built your business a modern website — it's live and ready to see.\n\nTake a look, and if you like it, use the claim code below to sign in and make it yours. Happy to hop on a quick call to walk you through it or tweak anything.\n\n— Joe`,
  );
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(status === "sent");

  const hasEmail = Boolean(item.email);

  if (sent) {
    const touches = item.followupCount || 1;
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-ink-soft">
        <span className="rounded-full bg-green-100 px-2.5 py-1 font-semibold text-green-800">✓ AI first-touch sent · {touches}/3</span>
        {item.phone && (
          <a href={`tel:${item.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 rounded-full bg-green-600 px-3 py-1 font-semibold text-white hover:bg-green-700">
            📞 Your turn — call {item.phone}
          </a>
        )}
        <span className="text-ink-soft">{touches >= 3 ? "· sequence complete" : "· follow-up auto-drafts in 3 days"}</span>
        <button onClick={() => { setSent(false); setOpen(true); }} className="font-semibold text-brand hover:underline">
          Send another
        </button>
        {msg && <span className="text-green-700">{msg}</span>}
      </div>
    );
  }
  const isFollowup = (item.followupCount || 0) >= 1;

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-1 font-semibold ${OUTREACH_PILL[status] || OUTREACH_PILL.none}`}>
            {status === "drafted"
              ? isFollowup
                ? `follow-up #${(item.followupCount || 0) + 1} ready`
                : "draft ready"
              : status === "none"
                ? "needs outreach"
                : status}
          </span>
          {!hasEmail && <span className="text-red-600">No owner email — can&apos;t send.</span>}
        </div>
        <div className="flex items-center gap-3 text-xs">
          {!open && hasEmail && (
            <button onClick={() => setOpen(true)} className="font-semibold text-brand hover:underline">
              {status === "drafted" ? "Review draft" : "Write outreach"}
            </button>
          )}
          {status !== "skipped" && (
            <button
              disabled={pending}
              onClick={() => start(async () => { await skipForgeOutreach(item.id); setMsg("Skipped."); })}
              className="text-ink-soft hover:text-ink disabled:opacity-50"
            >
              Skip
            </button>
          )}
        </div>
      </div>

      {open && hasEmail && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-ink-soft">
            To {item.email}. The claim code, a link to their live site, and a “book a call” button are added
            automatically — just write the note.
          </p>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await sendForgeOutreach(item.id, subject, body);
                  setMsg(r.message);
                  if (r.ok) setSent(true);
                })
              }
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              {pending ? "Sending…" : "Approve & send"}
            </button>
            <button onClick={() => setOpen(false)} className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-surface">
              Close
            </button>
            {msg && <span className="text-xs text-ink-soft">{msg}</span>}
          </div>
        </div>
      )}
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
