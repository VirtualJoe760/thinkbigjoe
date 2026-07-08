"use client";

import { useMemo, useState, useEffect } from "react";

import { logContactAttempt } from "../actions";
import type { ForgeSiteItem } from "../sites/sites-queue";
import type { LeadHistoryEvent } from "@/lib/forge-outreach";

export type AttemptStat = { call: number; text: number; email: number; total: number; lastAt: string | null };

// The CRM pipeline: a lead becomes a contact (we reach out), then a user profile once they set up
// on the site (claim), then a paying customer. Each stage is computed server-side (see page.tsx).
export type LeadStage = "new" | "contacted" | "replied" | "bounced" | "claimed" | "customer";
export type LeadMeta = { stage: LeadStage; accountNumber: string | null; plan: string | null; paid: boolean };

const STAGE: Record<LeadStage, { label: string; dot: string; chip: string; blurb: string }> = {
  new: { label: "New", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700", blurb: "Not contacted yet" },
  contacted: { label: "Contacted", dot: "bg-blue-500", chip: "bg-blue-50 text-blue-700", blurb: "Reached out — waiting" },
  replied: { label: "Replied", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700", blurb: "They wrote back — follow up" },
  bounced: { label: "Bad contact", dot: "bg-red-500", chip: "bg-red-50 text-red-700", blurb: "Email bounced — hunting a new channel" },
  claimed: { label: "User", dot: "bg-violet-500", chip: "bg-violet-50 text-violet-700", blurb: "Signed up + claimed — not paid yet" },
  customer: { label: "Customer", dot: "bg-brand", chip: "bg-brand-tint text-brand", blurb: "Paying customer" },
};
const STAGE_ORDER: LeadStage[] = ["new", "contacted", "replied", "bounced", "claimed", "customer"];

const tel = (p: string) => p.replace(/[^\d+]/g, "");
const firstName = (n: string) => (n || "").trim().split(/\s+/)[0] || "";
const fmtNum = (n?: number) => (n == null ? "" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const US_STATES = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"]);
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
function relTime(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
// Clean niche for display: take the first term, dropping verbose "/"-lists like
// "Handyman/Handywoman/Handyperson" → "Handyman".
function niche1(i: ForgeSiteItem): string {
  return (i.niche || "").split(/[—·,/]/)[0].trim();
}

function initialsOf(item: ForgeSiteItem) {
  return (item.businessName || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

// Rectangular business thumbnail (the photo we sourced from Maps/social), monogram fallback.
function Thumb({ item, size = 48, rounded = "rounded-lg" }: { item: ForgeSiteItem; size?: number; rounded?: string }) {
  const [broken, setBroken] = useState(false);
  if (item.photoUrl && !broken)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.photoUrl} alt="" onError={() => setBroken(true)} className={`shrink-0 ${rounded} object-cover`} style={{ width: size, height: size }} />;
  return (
    <div className={`flex shrink-0 items-center justify-center ${rounded} text-sm font-bold text-white`} style={{ width: size, height: size, background: item.brandColor || "#64748b" }}>
      {initialsOf(item)}
    </div>
  );
}

function Stars({ rating }: { rating: string }) {
  const s = Math.round(Number(rating) || 0);
  if (!rating) return null;
  return <span className="text-amber-500 text-xs">{"★".repeat(Math.max(0, Math.min(5, s)))}<span className="text-line">{"★".repeat(Math.max(0, 5 - s))}</span></span>;
}

// ── Communication timeline: each AI/manual attempt with a clear success/failure outcome ──
type Outcome = "positive" | "sent" | "neutral" | "negative";
const HIST: Record<LeadHistoryEvent["kind"], { icon: string; verb: string; outcome: Outcome }> = {
  "email-sent": { icon: "✉️", verb: "Emailed", outcome: "sent" },
  email: { icon: "✉️", verb: "Emailed", outcome: "sent" },
  text: { icon: "💬", verb: "Texted", outcome: "sent" },
  call: { icon: "📞", verb: "Called", outcome: "neutral" },
  reply: { icon: "↩️", verb: "Replied", outcome: "positive" },
  bounce: { icon: "⚠️", verb: "Bounced", outcome: "negative" },
};
const OUTCOME_CLS: Record<Outcome, string> = {
  positive: "bg-emerald-50 text-emerald-700",
  sent: "bg-blue-50 text-blue-700",
  neutral: "bg-surface text-ink-soft",
  negative: "bg-red-50 text-red-700",
};
const OUTCOME_LABEL: Record<Outcome, string> = { positive: "success", sent: "sent", neutral: "attempt", negative: "failed" };

function Timeline({ history }: { history: LeadHistoryEvent[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (history.length === 0)
    return <p className="text-sm text-ink-soft">No outreach yet — this contact hasn&apos;t been reached.</p>;
  return (
    <ol className="space-y-2">
      {[...history].reverse().map((e, i) => {
        const h = HIST[e.kind];
        const paras = (e.body || "").split("\n\n").filter(Boolean);
        const expandable = paras.length > 1 || (paras[0]?.length ?? 0) > 140;
        const isOpen = open === i;
        return (
          <li key={i} className="rounded-xl border border-line bg-background p-3">
            <div className="flex items-center gap-2">
              <span aria-hidden>{h.icon}</span>
              <span className="font-semibold text-ink">{h.verb}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${OUTCOME_CLS[h.outcome]}`}>{OUTCOME_LABEL[h.outcome]}</span>
              <span className="ml-auto text-xs text-ink-soft">{relTime(e.at)}</span>
            </div>
            {e.subject && <p className="mt-1.5 text-sm font-medium text-ink">“{e.subject}”</p>}
            {paras.length > 0 ? (
              <>
                <div className={`mt-1 space-y-1 text-sm text-ink-soft ${!isOpen && expandable ? "line-clamp-2" : ""}`}>
                  {(isOpen ? paras : paras.slice(0, 1)).map((p, j) => <p key={j}>{p}</p>)}
                </div>
                {expandable && (
                  <button onClick={() => setOpen(isOpen ? null : i)} className="mt-1 text-xs font-semibold text-brand hover:underline">
                    {isOpen ? "show less" : "read full message"}
                  </button>
                )}
              </>
            ) : (
              e.kind === "call" && <p className="mt-0.5 text-xs text-ink-soft">Phone call — no transcript.</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function opener(item: ForgeSiteItem): string {
  const who = firstName(item.ownerName);
  const niche = (niche1(item) || "business").toLowerCase();
  const place = cityState(item);
  return [
    `Hi, is this ${who || "the owner"}?`,
    `I saw you're a local ${niche}${place ? ` in ${place}` : ""} — is that right?`,
    `Great — I found your business online and built you a website. Do you have a second to look with me on the phone?`,
    `Perfect — I'll text you the link right now. Take a look…`,
  ].join("\n");
}

// ── Contact detail (slide-over: full-screen on mobile, right sheet on desktop) ──
function ContactDetail({
  item, meta, attempt, history, onClose, onContact,
}: {
  item: ForgeSiteItem; meta: LeadMeta; attempt: AttemptStat; history: LeadHistoryEvent[];
  onClose: () => void; onContact: (id: string, ch: "call" | "text" | "email") => void;
}) {
  const [copied, setCopied] = useState(false);
  const s = item.socialStats || {};
  const reach: string[] = [];
  if (s.instagram?.followers) reach.push(`📷 ${fmtNum(s.instagram.followers)}`);
  if (s.facebook?.followers) reach.push(`👍 ${fmtNum(s.facebook.followers)}`);
  const quotes = (item.reviewQuotes || []).filter((q) => q.text).slice(0, 2);
  const isApple = typeof navigator !== "undefined" && /(iphone|ipad|mac)/i.test(navigator.userAgent);
  const smsBody = encodeURIComponent(`Hi${firstName(item.ownerName) ? ` ${firstName(item.ownerName)}` : ""}, it's Joe — here's the site I built for ${item.businessName}: ${item.liveUrl || ""}`);
  const st = STAGE[meta.stage];
  const isUser = meta.stage === "claimed" || meta.stage === "customer";
  const script = opener(item);
  // Hero: the business photo we sourced dominates the top; fall back to the built-site screenshot.
  const heroImg = item.photoUrl || item.screenshotUrl || null;
  const showSiteShot = item.screenshotUrl && item.screenshotUrl !== heroImg;

  // Lock body scroll while the sheet is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex sm:justify-end">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
      <div className="relative flex h-full w-full flex-col bg-background shadow-2xl sm:w-[460px] sm:border-l sm:border-line">
        {/* header */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-background/95 px-4 py-3 backdrop-blur">
          <button onClick={onClose} className="-ml-1 rounded-full p-1.5 text-ink-soft hover:bg-surface" aria-label="Back">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <Thumb item={item} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold text-ink">{item.businessName}</div>
            <div className="truncate text-xs text-ink-soft">{[niche1(item), cityState(item)].filter(Boolean).join(" · ")}</div>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${st.chip}`}>{st.label}</span>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
          {/* hero — the business image dominates the top of the card */}
          <div className="-mx-4 -mt-4 mb-4">
            {heroImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={heroImg} alt={item.businessName} className="h-44 w-full bg-surface object-cover" />
            ) : (
              <div className="flex h-28 w-full items-center justify-center text-3xl font-extrabold text-white" style={{ background: item.brandColor || "#64748b" }}>
                {initialsOf(item)}
              </div>
            )}
          </div>

          {/* rating + reach */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
            {item.googleRating && <span className="flex items-center gap-1"><Stars rating={item.googleRating} /> {Number(item.googleRating).toFixed(1)}{item.reviewCount ? ` (${item.reviewCount})` : ""}</span>}
            {reach.length > 0 && <span>{reach.join("  ·  ")}</span>}
          </div>

          {/* bounced banner */}
          {meta.stage === "bounced" && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700">
              ⚠️ <b>Email bounced.</b> We retired that address and the research agent is hunting a new email or social. Reach out by phone or text meanwhile.
            </div>
          )}

          {/* user-profile block — the contact enriched into a user */}
          {isUser && (
            <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-violet-700">
                <span>👤 User profile</span>
                {meta.paid && <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-semibold text-brand">paying</span>}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
                {meta.accountNumber && (<><dt className="text-ink-soft">Account #</dt><dd className="text-right font-mono font-semibold text-ink">{meta.accountNumber}</dd></>)}
                <dt className="text-ink-soft">Plan</dt><dd className="text-right font-medium text-ink">{meta.plan || "not chosen"}</dd>
                <dt className="text-ink-soft">Billing</dt><dd className={`text-right font-medium ${meta.paid ? "text-emerald-700" : "text-ink"}`}>{meta.paid ? "active" : "not active"}</dd>
              </dl>
              {!meta.paid && <p className="mt-2 text-xs text-violet-700">They claimed their site but haven&apos;t picked a plan — nudge them to activate.</p>}
            </div>
          )}

          {/* quick actions — big tap targets */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {item.phone && (
              <a href={`tel:${tel(item.phone)}`} onClick={() => onContact(item.id, "call")} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-3 text-sm font-semibold text-white active:scale-[0.98]">
                📞 Call
              </a>
            )}
            {item.phone && (
              <a href={`sms:${tel(item.phone)}${isApple ? "&" : "?"}body=${smsBody}`} onClick={() => onContact(item.id, "text")} className="flex items-center justify-center gap-2 rounded-xl border border-brand px-3 py-3 text-sm font-semibold text-brand active:scale-[0.98]">
                💬 Text link
              </a>
            )}
            {item.email && (
              <a href={`mailto:${item.email}`} onClick={() => onContact(item.id, "email")} className="flex items-center justify-center gap-2 rounded-xl border border-line px-3 py-3 text-sm font-medium text-ink active:scale-[0.98]">
                ✉️ Email
              </a>
            )}
            {item.liveUrl && (
              <a href={item.liveUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl border border-line px-3 py-3 text-sm font-medium text-ink active:scale-[0.98]">
                🔗 Their site
              </a>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-soft">Texts send from your phone (not the 480). Every tap is logged as an attempt below.</p>

          {/* contact facts */}
          <dl className="mt-4 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-sm">
            {item.ownerName && (<><dt className="text-ink-soft">Owner</dt><dd className="text-ink">{item.ownerName}</dd></>)}
            {item.phone && (<><dt className="text-ink-soft">Phone</dt><dd className="text-ink">{item.phone}</dd></>)}
            {item.email && (<><dt className="text-ink-soft">Email</dt><dd className="truncate text-ink">{item.email}</dd></>)}
            {item.claimCode && (<><dt className="text-ink-soft">Claim code</dt><dd className="font-mono text-ink">{item.claimCode}</dd></>)}
          </dl>

          {/* the site we built for them — a screenshot so you can see it at a glance */}
          {showSiteShot && (
            <div className="mt-5">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-soft">The site we built</h3>
              <a href={item.liveUrl || item.screenshotUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-line transition-colors hover:border-brand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.screenshotUrl} alt={`${item.businessName} website`} className="max-h-64 w-full bg-surface object-cover object-top" />
                {item.liveUrl && <div className="border-t border-line bg-surface px-3 py-2 text-xs font-semibold text-brand">Open live site ↗</div>}
              </a>
            </div>
          )}

          {/* communication timeline */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">Communications</h3>
              <span className="text-xs text-ink-soft">{attempt.total} attempt{attempt.total === 1 ? "" : "s"}{attempt.lastAt ? ` · last ${relTime(attempt.lastAt)}` : ""}</span>
            </div>
            <Timeline history={history} />
          </div>

          {/* reviews */}
          {quotes.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-soft">What customers say</h3>
              <ul className="space-y-1.5">
                {quotes.map((q, i) => (
                  <li key={i} className="text-sm text-ink"><span className="text-amber-500">{"★".repeat(Math.max(0, Math.min(5, q.stars || 0)))}</span> <span className="italic">“{q.text}”</span>{q.name && <span className="text-ink-soft"> — {q.name}</span>}</li>
                ))}
              </ul>
            </div>
          )}

          {/* calling script */}
          <div className="mt-5 rounded-xl border border-brand/30 bg-brand-tint/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-brand">📞 Calling script</span>
              <button onClick={() => { navigator.clipboard?.writeText(item.callPrep ? `${script}\n\n— Angle —\n${item.callPrep}` : script).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} className="rounded-full border border-brand/40 px-2.5 py-0.5 text-xs font-semibold text-brand hover:bg-brand-tint">
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <div className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{script}</div>
            {item.callPrep && (
              <div className="mt-3 border-t border-brand/20 pt-2">
                <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">Your angle</div>
                <div className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{item.callPrep}</div>
              </div>
            )}
          </div>
          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}

export function LeadsCRM({
  leads, attempts, histories, meta,
}: {
  leads: ForgeSiteItem[]; attempts: Record<string, AttemptStat>;
  histories: Record<string, LeadHistoryEvent[]>; meta: Record<string, LeadMeta>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<LeadStage | "all">("all");
  const [local, setLocal] = useState<Record<string, AttemptStat>>(attempts);

  const stat = (id: string): AttemptStat => local[id] || { call: 0, text: 0, email: 0, total: 0, lastAt: null };
  const metaOf = (id: string): LeadMeta => meta[id] || { stage: "new", accountNumber: null, plan: null, paid: false };

  const record = (id: string, channel: "call" | "text" | "email") => {
    setLocal((m) => {
      const cur = m[id] || { call: 0, text: 0, email: 0, total: 0, lastAt: null };
      return { ...m, [id]: { ...cur, [channel]: cur[channel] + 1, total: cur.total + 1, lastAt: new Date().toISOString() } };
    });
    void logContactAttempt(id, channel);
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: leads.length };
    for (const l of leads) { const st = metaOf(l.id).stage; c[st] = (c[st] || 0) + 1; }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, meta]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (filter !== "all" && metaOf(l.id).stage !== filter) return false;
      if (!needle) return true;
      return [l.businessName, l.ownerName, l.city, l.niche, l.email].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, q, filter, meta]);

  const open = leads.find((l) => l.id === openId) || null;

  return (
    <div>
      {/* search */}
      <div className="relative mb-3">
        <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts…"
          className="w-full rounded-full border border-line bg-background py-2.5 pl-9 pr-4 text-sm text-ink focus:border-brand focus:outline-none"
        />
      </div>

      {/* stage filters — horizontally scrollable on mobile */}
      <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {(["all", ...STAGE_ORDER] as const).map((key) => {
          const active = filter === key;
          const label = key === "all" ? "All" : STAGE[key].label;
          const n = counts[key] || 0;
          if (key !== "all" && n === 0) return null;
          return (
            <button
              key={key} onClick={() => setFilter(key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${active ? "border-brand bg-brand text-white" : "border-line bg-background text-ink-soft hover:bg-surface"}`}
            >
              {key !== "all" && <span className={`h-1.5 w-1.5 rounded-full ${STAGE[key as LeadStage].dot}`} />}
              {label}<span className={active ? "text-white/80" : "text-ink-soft"}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* contact list */}
      {filtered.length === 0 ? (
        <p className="py-8 text-sm text-ink-soft">No contacts match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-line text-left text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                <th className="py-2 pr-3 font-semibold">Business</th>
                <th className="hidden px-3 py-2 font-semibold md:table-cell">Rating</th>
                <th className="hidden px-3 py-2 font-semibold sm:table-cell">Activity</th>
                <th className="py-2 pl-3 text-right font-semibold">Stage</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const m = metaOf(item.id);
                const a = stat(item.id);
                const st = STAGE[m.stage];
                const touches = a.total > 0 ? `${a.total} touch${a.total === 1 ? "" : "es"}` : "no touch";
                return (
                  <tr
                    key={item.id}
                    onClick={() => setOpenId(item.id)}
                    className="cursor-pointer border-b border-line align-middle transition-colors hover:bg-surface"
                  >
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-3">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} title={st.label} />
                        <Thumb item={item} size={44} />
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-ink">{item.businessName}</div>
                          <div className="truncate text-xs text-ink-soft">
                            {[niche1(item), cityState(item)].filter(Boolean).join(" · ") || item.email}
                          </div>
                          {/* mobile-only meta (the desktop columns collapse below sm) */}
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-soft sm:hidden">
                            {item.googleRating && <span className="text-amber-500">★ <span className="text-ink-soft">{Number(item.googleRating).toFixed(1)}</span></span>}
                            <span>{touches}</span>
                            {a.lastAt && <span>· {relTime(a.lastAt)}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2.5 text-ink-soft md:table-cell">
                      {item.googleRating ? (
                        <span className="flex items-center gap-1"><Stars rating={item.googleRating} /> <span className="text-ink">{Number(item.googleRating).toFixed(1)}</span>{item.reviewCount ? <span className="text-xs">({item.reviewCount})</span> : null}</span>
                      ) : <span className="text-xs">—</span>}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2.5 text-xs text-ink-soft sm:table-cell">
                      {touches}{a.lastAt ? <span className="block text-[11px]">last {relTime(a.lastAt)}</span> : null}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pl-3 text-right">
                      <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.chip}`}>{st.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <ContactDetail
          item={open} meta={metaOf(open.id)} attempt={stat(open.id)}
          history={histories[open.id] || []} onClose={() => setOpenId(null)} onContact={record}
        />
      )}
    </div>
  );
}
