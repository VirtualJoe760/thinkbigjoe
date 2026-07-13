"use client";

import { useActionState, useMemo, useRef, useState, useEffect, useTransition } from "react";

import { logContactAttempt, getContactSlots, bookForContact, sendCallbackCodeText, saveLeadNote, denyForgeSite, dropLeadVoicemail, setLeadStage, type ContactSlot, type BookForContactState } from "../actions";
import type { ForgeSiteItem } from "../sites/sites-queue";
import type { LeadHistoryEvent } from "@/lib/forge-outreach";

// `total` = successful touches (delivered email + text + call). `failed` = bounced email sends
// (attempted, not delivered) — kept out of `total` so a bounced lead never reads as "contacted".
export type AttemptStat = { call: number; text: number; email: number; failed: number; total: number; lastAt: string | null };

// The CRM pipeline: a lead becomes a contact (we reach out), then a user profile once they set up
// on the site (claim), then a paying customer. Each stage is computed server-side (see page.tsx).
export type LeadStage = "new" | "contacted" | "replied" | "opted_out" | "bounced" | "claimed" | "customer";
export type LeadMeta = {
  stage: LeadStage;
  accountNumber: string | null;
  plan: string | null;
  paid: boolean;
  subscriptionStatus: string | null;
  paidAt: string | null;
  receptionistStatus: string | null;
  domain: string | null;
  domainStatus: string | null;
  claimedAt: string | null;
};

const STAGE: Record<LeadStage, { label: string; dot: string; chip: string; blurb: string }> = {
  new: { label: "New", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700", blurb: "Not contacted yet" },
  contacted: { label: "Contacted", dot: "bg-blue-500", chip: "bg-blue-50 text-blue-700", blurb: "Reached out — waiting" },
  replied: { label: "Replied", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700", blurb: "They wrote back — follow up" },
  opted_out: { label: "Declined", dot: "bg-rose-600", chip: "bg-rose-50 text-rose-700", blurb: "Texted STOP — call to confirm, then remove" },
  bounced: { label: "Bad contact", dot: "bg-red-500", chip: "bg-red-50 text-red-700", blurb: "Email bounced — hunting a new channel" },
  claimed: { label: "User", dot: "bg-violet-500", chip: "bg-violet-50 text-violet-700", blurb: "Signed up + claimed — not paid yet" },
  customer: { label: "Customer", dot: "bg-brand", chip: "bg-brand-tint text-brand", blurb: "Paying customer" },
};
const STAGE_ORDER: LeadStage[] = ["new", "contacted", "replied", "opted_out", "bounced", "claimed", "customer"];

const tel = (p: string) => p.replace(/[^\d+]/g, "");
const firstName = (n: string) => (n || "").trim().split(/\s+/)[0] || "";
// Deep-link to the business on Google Maps / Business Profile. Prefer the URL the prospector
// captured; otherwise a Maps search on name + city so every contact has a working link.
const mapsSearchUrl = (i: ForgeSiteItem) =>
  i.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([i.businessName, i.city].filter(Boolean).join(", "))}`;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
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
  // First letter of the first two words. Array.from is code-point-aware so an
  // emoji-prefixed name (e.g. "🏎️Valeri Auto") doesn't get its surrogate pair
  // sliced in half — a lone surrogate serializes as � on the server but stays a
  // half-surrogate on the client, causing a hydration text mismatch (React #418).
  // We also skip leading emoji/punctuation so initials read as letters ("VA").
  const firstChar = (w: string) => {
    const chars = Array.from(w);
    return (chars.find((c) => /\p{L}|\p{N}/u.test(c)) || chars[0] || "").toUpperCase();
  };
  const words = (item.businessName || "?").split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map(firstChar).join("") || "?";
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

// Inline stage editor on each leads row — set New/Contacted/Declined straight from the list,
// without opening the contact. Claimed/paying rows aren't editable (those are real states).
function StageDropdown({ itemId, stage }: { itemId: string; stage: LeadStage }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const st = STAGE[stage];
  const set = (v: "new" | "contacted" | "declined") => {
    setBusy(true);
    setOpen(false);
    setLeadStage(Number(itemId), v).finally(() => setBusy(false));
  };
  return (
    <span ref={ref} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        title="Change stage"
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.chip} disabled:opacity-50`}
      >
        {st.label}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="opacity-70"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-32 overflow-hidden rounded-xl border border-line bg-background py-1 text-left shadow-lg">
          {([["new", "New"], ["contacted", "Contacted"], ["declined", "Declined"]] as const).map(([v, l]) => {
            const active = stage === v || (v === "declined" && stage === "opted_out");
            return (
              <button key={v} onClick={() => set(v)} className={`block w-full px-3 py-1.5 text-left text-xs font-medium hover:bg-surface ${active ? "text-brand" : "text-ink"}`}>
                {l}{active ? " ✓" : ""}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
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
  note: { icon: "📝", verb: "Note", outcome: "neutral" },
  code: { icon: "🎟️", verb: "Texted callback code", outcome: "sent" },
  voicemail: { icon: "📞", verb: "Dropped a voicemail", outcome: "sent" },
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
        // A bounced email is a failed delivery — override the "sent" badge.
        const outcome: Outcome = e.failed ? "negative" : h.outcome;
        const verb = e.failed && (e.kind === "email-sent" || e.kind === "email") ? "Emailed — didn't deliver" : h.verb;
        const paras = (e.body || "").split("\n\n").filter(Boolean);
        const expandable = paras.length > 1 || (paras[0]?.length ?? 0) > 140;
        const isOpen = open === i;
        return (
          <li key={i} className="rounded-xl border border-line bg-background p-3">
            <div className="flex items-center gap-2">
              <span aria-hidden>{e.failed && e.kind !== "bounce" ? "⚠️" : h.icon}</span>
              <span className={`font-semibold ${e.failed ? "text-red-700" : "text-ink"}`}>{verb}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${OUTCOME_CLS[outcome]}`}>{OUTCOME_LABEL[outcome]}</span>
              <span className="ml-auto text-xs text-ink-soft" suppressHydrationWarning>{relTime(e.at)}</span>
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

// ── Book an appointment for a lead (compact scheduler in the slide-over) ──
const TZ = "America/Los_Angeles";
const bookInit: BookForContactState = { ok: false, message: "" };

function BookForLead({ siteId, onBooked }: { siteId: string; onBooked: () => void }) {
  const days = useMemo(() => {
    const out: { date: string; label: string }[] = [];
    const nowD = new Date();
    for (let i = 0; out.length < 8 && i < 25; i++) {
      const d = new Date(nowD.getTime() + i * 86400000);
      const wd = d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" });
      if (wd === "Sat" || wd === "Sun") continue;
      out.push({ date: d.toLocaleDateString("en-CA", { timeZone: TZ }), label: `${wd} ${d.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" })}` });
    }
    return out;
  }, []);
  const [date, setDate] = useState(days[0]?.date ?? "");
  const [slots, setSlots] = useState<ContactSlot[]>([]);
  const [slot, setSlot] = useState("");
  const [loading, startLoad] = useTransition();
  const [state, action, pending] = useActionState(bookForContact, bookInit);

  useEffect(() => {
    if (!date) return;
    setSlot(""); setSlots([]);
    startLoad(async () => { const r = await getContactSlots(date); setSlots(r.slots); });
  }, [date]);
  useEffect(() => { if (state.ok) onBooked(); }, [state.ok, onBooked]);

  const fmtSlot = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

  if (state.ok) return <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{state.message}</div>;

  return (
    <form action={action} className="mt-2 rounded-xl border border-line bg-surface p-3">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="startTime" value={slot} />
      <div className="flex flex-wrap gap-1.5">
        {days.map((d) => (
          <button key={d.date} type="button" onClick={() => setDate(d.date)}
            className={`rounded-lg border px-2 py-1 text-xs font-semibold ${d.date === date ? "border-brand bg-brand text-white" : "border-line bg-background text-ink-soft hover:text-ink"}`}>
            {d.label}
          </button>
        ))}
      </div>
      <div className="mt-2 min-h-[2rem]">
        {loading ? <p className="text-xs text-ink-soft">Loading times…</p>
          : slots.length === 0 ? <p className="text-xs text-ink-soft">No open times that day (10–5 PT).</p>
          : (
            <div className="flex flex-wrap gap-1.5">
              {slots.map((sl) => (
                <button key={sl.start} type="button" onClick={() => setSlot(sl.start)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${sl.start === slot ? "border-brand bg-brand text-white" : "border-line bg-background text-ink hover:border-brand"}`}>
                  {fmtSlot(sl.start)}
                </button>
              ))}
            </div>
          )}
      </div>
      {state.message && !state.ok && <p className="mt-1 text-xs font-medium text-red-600">{state.message}</p>}
      <button type="submit" disabled={pending || !slot}
        className="mt-2 w-full rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "Booking…" : slot ? `Book ${fmtSlot(slot)} PT` : "Pick a time"}
      </button>
    </form>
  );
}

// A collapsible section on the contact card — a tappable header (title + optional
// at-a-glance summary + chevron) that shows/hides its body. `action` is an optional
// control rendered beside the toggle (e.g. a Copy button) — kept a sibling, not a
// child, so we never nest a <button> inside the toggle <button>.
function CardSection({
  title,
  summary,
  action,
  defaultOpen = false,
  tone,
  children,
}: {
  title: React.ReactNode;
  summary?: React.ReactNode;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  tone?: "brand";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const brand = tone === "brand";
  return (
    <div className={`mt-3 overflow-hidden rounded-xl border ${brand ? "border-brand/30 bg-brand-tint/40" : "border-line"}`}>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex flex-1 items-center justify-between gap-2 px-3 py-2.5 text-left"
        >
          <span className={`text-xs font-bold uppercase tracking-wide ${brand ? "text-brand" : "text-ink-soft"}`}>{title}</span>
          <span className="flex items-center gap-2 text-xs text-ink-soft">
            {summary}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" /></svg>
          </span>
        </button>
        {action && <div className="pr-2">{action}</div>}
      </div>
      {open && <div className={`px-3 pb-3 ${brand ? "" : "border-t border-line"} pt-2`}>{children}</div>}
    </div>
  );
}

// ── Contact detail (slide-over: full-screen on mobile, right sheet on desktop) ──
function ContactDetail({
  item, meta, attempt, history, onClose, onContact,
}: {
  item: ForgeSiteItem; meta: LeadMeta; attempt: AttemptStat; history: LeadHistoryEvent[];
  onClose: () => void; onContact: (id: string, ch: "call" | "text" | "email") => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [showBook, setShowBook] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [vmBusy, setVmBusy] = useState(false);
  const [vmMsg, setVmMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [stageBusy, setStageBusy] = useState(false);
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  async function handleTextCode() {
    setCodeBusy(true);
    setCodeMsg(null);
    try {
      const r = await sendCallbackCodeText(item.id);
      setCodeMsg({ ok: r.ok, text: r.message });
    } catch {
      setCodeMsg({ ok: false, text: "Something went wrong sending the code." });
    } finally {
      setCodeBusy(false);
    }
  }

  async function handleDropVoicemail() {
    setVmBusy(true);
    setVmMsg(null);
    try {
      const r = await dropLeadVoicemail(Number(item.id), true);
      setVmMsg({ ok: r.ok, text: r.message });
      if (r.ok) onContact(item.id, "call");
    } catch {
      setVmMsg({ ok: false, text: "Something went wrong dropping the voicemail." });
    } finally {
      setVmBusy(false);
    }
  }

  async function handleSaveNote() {
    const text = note.trim();
    if (!text) return;
    setNoteBusy(true);
    try {
      const r = await saveLeadNote(item.id, text);
      if (r.ok) {
        setNote("");
        setNoteSaved(true);
        setTimeout(() => setNoteSaved(false), 1800);
      }
    } finally {
      setNoteBusy(false);
    }
  }

  const [removing, setRemoving] = useState(false);
  // Preview overlay — opens the site inside the app (with a Back button) instead of
  // navigating away. In a standalone PWA, a same-origin link replaces the whole app
  // with no back button, trapping you; this keeps you in the contact view.
  const [showPreview, setShowPreview] = useState(false);
  async function handleRemove() {
    if (!window.confirm(`Remove ${item.businessName} from the database? This denies + blacklists them so they're never re-added.`)) return;
    setRemoving(true);
    try {
      await denyForgeSite(item.id, "Removed after opt-out (called to confirm value)");
      onClose();
    } finally {
      setRemoving(false);
    }
  }

  const s = item.socialStats || {};
  const igF = s.instagram?.followers ? fmtNum(s.instagram.followers) : "";
  const fbF = s.facebook?.followers ? fmtNum(s.facebook.followers) : "";
  // The business's real online footprint — their current site, Google Business, and socials,
  // each a clickable pill (follower counts fold into the IG/FB label). Only rendered when present;
  // Google Business always resolves (captured URL, else a name+city Maps search).
  const presence: Array<{ label: string; href: string; icon: string }> = [
    item.existingWebsiteUrl ? { label: "Current site", href: item.existingWebsiteUrl, icon: "🌐" } : null,
    { label: "Google Business", href: mapsSearchUrl(item), icon: "📍" },
    item.instagramUrl ? { label: igF ? `Instagram · ${igF}` : "Instagram", href: item.instagramUrl, icon: "📷" } : null,
    item.facebookUrl ? { label: fbF ? `Facebook · ${fbF}` : "Facebook", href: item.facebookUrl, icon: "👍" } : null,
    item.linkedinUrl ? { label: "LinkedIn", href: item.linkedinUrl, icon: "💼" } : null,
  ].filter(Boolean) as Array<{ label: string; href: string; icon: string }>;
  const quotes = (item.reviewQuotes || []).filter((q) => q.text).slice(0, 2);
  const isApple = typeof navigator !== "undefined" && /(iphone|ipad|mac)/i.test(navigator.userAgent);
  const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";
  const previewLink = item.liveUrl || (item.slug ? `${SITE}/s/${item.slug}` : SITE);
  const st = STAGE[meta.stage];
  const isUser = meta.stage === "claimed" || meta.stage === "customer";
  // The message the rep texts from Google Voice — the preview link plus, for an un-claimed lead,
  // the claim code. Once they've signed up the claim instructions are dropped (it's just a link).
  const claimMsg = `Hi${firstName(item.ownerName) ? ` ${firstName(item.ownerName)}` : ""}, it's Joe — here's the website preview I built for ${item.businessName}: ${previewLink}${!isUser && item.claimCode ? `. To make it yours, create a free account and enter code ${item.claimCode} at ${SITE}/portal/claim` : ""}. Text me back with any questions!`;
  const smsBody = encodeURIComponent(claimMsg);
  const script = opener(item);
  // Real billing truth: a recurring subscription state wins; else the one-time flag; else nothing.
  const billingLabel = meta.subscriptionStatus
    ? meta.subscriptionStatus.replace(/_/g, " ")
    : meta.paid ? "paid (one-time)" : "not active";
  const billingGood = meta.paid || meta.subscriptionStatus === "active" || meta.subscriptionStatus === "trialing";
  const domainLabel = meta.domain ? (meta.domainStatus && meta.domainStatus !== "live" ? `${meta.domain} · ${meta.domainStatus}` : meta.domain) : null;
  // Hero imagery = the site we made for them. Stored screenshot if we have one, else a live
  // scaled iframe of the deployed site OR — for a preview-stage lead not yet built — the
  // personalized /s/<slug> preview; fall back to the business photo, then a branded gradient.
  const heroUrl = item.liveUrl || (item.hasPreview && item.slug ? `/s/${item.slug}` : null);
  const heroShot = item.screenshotUrl || null;
  const heroFrame = !item.screenshotUrl && heroUrl ? heroUrl : null;
  const heroSite = !!(heroShot || heroFrame);

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
          {/* hero — the SITE WE BUILT is the imagery (our work); business photo / gradient fall back */}
          <div className="relative -mx-4 -mt-4 mb-4">
            {heroShot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={heroShot} alt={`${item.businessName} website`} className="h-48 w-full bg-surface object-cover object-top" />
            ) : heroFrame ? (
              <div className="relative h-48 w-full overflow-hidden bg-surface">
                <iframe
                  src={heroFrame}
                  title={`${item.businessName} website`}
                  loading="lazy"
                  scrolling="no"
                  className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
                  style={{ width: "320%", height: "320%", transform: "scale(0.3125)" }}
                />
              </div>
            ) : item.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.photoUrl} alt={item.businessName} className="h-48 w-full bg-surface object-cover" />
            ) : (
              <div className="flex h-48 w-full flex-col items-center justify-center gap-2 text-white" style={{ background: item.brandColor || "#64748b" }}>
                <span className="text-4xl font-extrabold">{initialsOf(item)}</span>
                <span className="px-4 text-center text-sm font-semibold text-white/85">{item.businessName}</span>
              </div>
            )}
            {heroSite && heroUrl && (
              <button onClick={() => setShowPreview(true)} className="absolute bottom-2 right-2 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white backdrop-blur transition-colors hover:bg-black/85">
                {item.liveUrl ? "Open live site" : "Open preview"}
              </button>
            )}
          </div>

          {/* rating */}
          {item.googleRating && (
            <div className="flex items-center gap-1.5 text-sm text-ink">
              <Stars rating={item.googleRating} />
              <span className="font-semibold">{Number(item.googleRating).toFixed(1)}</span>
              {item.reviewCount && <span className="text-ink-soft">· {item.reviewCount} reviews</span>}
            </div>
          )}

          {/* why this lead — the AI's fit reasoning (highest-signal one-liner) */}
          {item.fitReason && (
            <p className="mt-1.5 text-sm leading-snug text-ink-soft">
              <span className="font-medium text-ink">Why: </span>{item.fitReason}
            </p>
          )}

          {/* online presence — current site · Google Business · socials, all clickable */}
          {presence.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {presence.map((p) => (
                <a
                  key={p.label}
                  href={p.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-background px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface"
                >
                  <span aria-hidden>{p.icon}</span>
                  {p.label}
                  <span className="text-ink-soft">↗</span>
                </a>
              ))}
            </div>
          )}

          {/* stage control — manually move a lead through the pipeline (New · Contacted · Declined) */}
          {!isUser && (
            <div className="mt-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Stage</p>
              <div className="inline-flex overflow-hidden rounded-full border border-line">
                {(["new", "contacted", "declined"] as const).map((s, i) => {
                  const active = meta.stage === s || (s === "declined" && meta.stage === "opted_out");
                  const label = s === "declined" ? "Declined" : s === "contacted" ? "Contacted" : "New";
                  return (
                    <button
                      key={s}
                      disabled={stageBusy}
                      onClick={() => {
                        setStageBusy(true);
                        setLeadStage(Number(item.id), s).finally(() => setStageBusy(false));
                      }}
                      className={`px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${i > 0 ? "border-l border-line" : ""} ${
                        active
                          ? s === "declined" ? "bg-rose-600 text-white" : "bg-brand text-white"
                          : "bg-background text-ink-soft hover:bg-surface"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {(meta.stage === "opted_out" || meta.stage === "new" || meta.stage === "contacted") && (
                <p className="mt-1 text-[11px] text-ink-soft">
                  {meta.stage === "opted_out"
                    ? "Declined — suppressed from outreach, kept live a few days, then removed if unclaimed."
                    : "Set by hand; overrides the auto-computed stage."}
                </p>
              )}
            </div>
          )}

          {/* bounced banner */}
          {meta.stage === "bounced" && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700">
              ⚠️ <b>Email bounced.</b> We retired that address and the research agent is hunting a new email or social. Reach out by phone or text meanwhile.
            </div>
          )}

          {/* user-profile block — the contact who claimed + signed up (Joe's "did they sign up?" view) */}
          {isUser && (
            <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-violet-700">
                <span>👤 Signed-up user</span>
                {billingGood && <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-semibold text-brand">paying</span>}
                {meta.claimedAt && <span className="ml-auto text-[11px] font-medium normal-case text-violet-500" suppressHydrationWarning>claimed {fmtDate(meta.claimedAt)}</span>}
              </div>
              <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
                {meta.accountNumber && (<><dt className="text-ink-soft">Account #</dt><dd className="text-right font-mono font-semibold text-ink">{meta.accountNumber}</dd></>)}
                <dt className="text-ink-soft">Plan</dt><dd className="text-right font-medium text-ink">{meta.plan || "not chosen"}</dd>
                <dt className="text-ink-soft">Billing</dt>
                <dd className={`text-right font-medium capitalize ${billingGood ? "text-emerald-700" : "text-ink"}`}>
                  {billingLabel}{meta.paidAt ? <span className="text-ink-soft" suppressHydrationWarning> · since {fmtDate(meta.paidAt)}</span> : null}
                </dd>
                {meta.receptionistStatus && (<><dt className="text-ink-soft">Receptionist</dt><dd className="text-right font-medium capitalize text-ink">{meta.receptionistStatus}</dd></>)}
                {domainLabel && (<><dt className="text-ink-soft">Domain</dt><dd className="text-right font-medium text-ink">{domainLabel}</dd></>)}
              </dl>
              {!billingGood && <p className="mt-2 text-xs text-violet-700">They claimed their site but haven&apos;t activated a plan — nudge them to subscribe.</p>}
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

          {/* secondary cluster — claim-text (un-signed-up only) + booking, set apart by a divider */}
          <div className="mt-4 border-t border-line pt-4">
            {!isUser && item.claimCode && (
              <>
                <button
                  onClick={() => {
                    onContact(item.id, "text");
                    navigator.clipboard?.writeText(claimMsg).then(() => {
                      setCopiedMsg(true);
                      setTimeout(() => setCopiedMsg(false), 1800);
                    });
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-3 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark active:scale-[0.98]"
                >
                  {copiedMsg ? "✓ Copied — paste into Google Voice" : "📋 Copy claim text for Google Voice"}
                </button>
                <p className="mt-1.5 text-[11px] text-ink-soft">
                  Text the code from your <b>Google Voice</b> — copy, then paste + send in GV. The Call/Text
                  buttons above use your device. Every tap is logged below.
                </p>
              </>
            )}

            {/* Book an appointment for this contact (onto Joe's calendar). */}
            <button
              onClick={() => setShowBook((v) => !v)}
              className={`flex w-full items-center justify-center gap-2 rounded-xl border border-line px-3 py-3 text-sm font-semibold text-ink transition-colors hover:bg-surface ${!isUser && item.claimCode ? "mt-2" : ""}`}
            >
              📅 {showBook ? "Hide booking" : "Book an appointment"}
            </button>
            {showBook && <BookForLead siteId={item.id} onBooked={() => onContact(item.id, "call")} />}

            {/* Drop a ringless voicemail (Drop Cowboy) + follow up with the first-touch text. */}
            {item.phone && (
              <>
                <button
                  onClick={handleDropVoicemail}
                  disabled={vmBusy}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-500/60 bg-indigo-50 px-3 py-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-60 active:scale-[0.98]"
                >
                  📞 {vmBusy ? "Dropping…" : "Drop voicemail + text"}
                </button>
                {vmMsg && (
                  <p className={`mt-1.5 text-[11px] ${vmMsg.ok ? "text-indigo-700" : "text-amber-700"}`}>{vmMsg.text}</p>
                )}
                {!vmMsg && (
                  <p className="mt-1.5 text-[11px] text-ink-soft">
                    Drops a pre-recorded voicemail in their inbox (no ring), then texts them the site link. Callbacks reach Ivy.
                  </p>
                )}
              </>
            )}

            {/* Text a priority callback code — they call the TBJ number, give the code, Ivy transfers them to Joe. */}
            {item.phone && (
              <>
                <button
                  onClick={handleTextCode}
                  disabled={codeBusy}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/60 bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60 active:scale-[0.98]"
                >
                  🎟️ {codeBusy ? "Sending…" : "Text a callback code (rings you)"}
                </button>
                {codeMsg && (
                  <p className={`mt-1.5 text-[11px] ${codeMsg.ok ? "text-emerald-700" : "text-amber-700"}`}>{codeMsg.text}</p>
                )}
                {!codeMsg && (
                  <p className="mt-1.5 text-[11px] text-ink-soft">
                    Auto-texts them a code from our number. When they call it and give the code, Ivy sends the call straight to you.
                  </p>
                )}
              </>
            )}

            {/* Declined / opted-out: they texted STOP. Call once to confirm value, then remove. */}
            {meta.stage === "opted_out" && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-rose-700">🛑 Opted out (texted STOP)</p>
                <p className="mt-1 text-[11px] leading-relaxed text-rose-700">
                  They&apos;re suppressed from texts. Give them a call to make sure they understood the value prop — then remove them for good.
                </p>
                <button
                  onClick={handleRemove}
                  disabled={removing}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-3 py-2.5 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-60 active:scale-[0.98]"
                >
                  {removing ? "Removing…" : "🗑️ Remove from database"}
                </button>
              </div>
            )}
          </div>

          {/* add a note — lands on the timeline below (e.g. what happened on a call) */}
          <CardSection title="Add a note">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="What happened on the call, next steps, anything to remember…"
              className="w-full resize-y rounded-xl border border-line bg-background p-2.5 text-sm text-ink outline-none placeholder:text-ink-soft focus:border-brand"
            />
            <button
              onClick={handleSaveNote}
              disabled={noteBusy || !note.trim()}
              className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-xl border border-line px-3 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-50 active:scale-[0.98]"
            >
              {noteBusy ? "Saving…" : noteSaved ? "✓ Saved" : "📝 Save note"}
            </button>
          </CardSection>

          {/* contact facts */}
          <CardSection title="Contact details" defaultOpen>
            <dl className="grid grid-cols-[7rem,1fr] items-baseline gap-x-3 gap-y-2 text-sm">
              {item.ownerName && (<><dt className="text-xs uppercase tracking-wide text-ink-soft">Owner</dt><dd className="font-medium text-ink">{item.ownerName}</dd></>)}
              {item.phone && (<><dt className="text-xs uppercase tracking-wide text-ink-soft">Phone</dt><dd className="font-medium text-ink">{item.phone}</dd></>)}
              {item.email && (<><dt className="text-xs uppercase tracking-wide text-ink-soft">Email</dt><dd className="truncate font-medium text-ink">{item.email}</dd></>)}
              {[niche1(item), cityState(item)].filter(Boolean).length > 0 && (<><dt className="text-xs uppercase tracking-wide text-ink-soft">Business</dt><dd className="font-medium text-ink">{[niche1(item), cityState(item)].filter(Boolean).join(" · ")}</dd></>)}
              {!isUser && item.claimCode && (<><dt className="text-xs uppercase tracking-wide text-ink-soft">Claim code</dt><dd className="font-mono font-medium text-ink">{item.claimCode}</dd></>)}
            </dl>
          </CardSection>

          {/* communication timeline */}
          <CardSection
            title="Communications"
            summary={
              <span suppressHydrationWarning>
                {attempt.total} reached{attempt.failed > 0 ? <span className="text-red-600"> · {attempt.failed} failed</span> : null}{attempt.lastAt ? ` · ${relTime(attempt.lastAt)}` : ""}
              </span>
            }
          >
            <Timeline history={history} />
          </CardSection>

          {/* reviews */}
          {quotes.length > 0 && (
            <CardSection title="What customers say" summary={`${quotes.length}`}>
              <ul className="space-y-1.5">
                {quotes.map((q, i) => (
                  <li key={i} className="text-sm text-ink"><span className="text-amber-500">{"★".repeat(Math.max(0, Math.min(5, q.stars || 0)))}</span> <span className="italic">“{q.text}”</span>{q.name && <span className="text-ink-soft"> — {q.name}</span>}</li>
                ))}
              </ul>
            </CardSection>
          )}

          {/* calling script */}
          <CardSection
            title="📞 Calling script"
            tone="brand"
            action={
              <button onClick={() => { navigator.clipboard?.writeText(item.callPrep ? `${script}\n\n— Angle —\n${item.callPrep}` : script).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} className="rounded-full border border-brand/40 px-2.5 py-0.5 text-xs font-semibold text-brand hover:bg-brand-tint">
                {copied ? "Copied ✓" : "Copy"}
              </button>
            }
          >
            <div className="whitespace-pre-line text-sm leading-relaxed text-ink">{script}</div>
            {item.callPrep && (
              <div className="mt-3 border-t border-brand/20 pt-2">
                <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">Your angle</div>
                <div className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{item.callPrep}</div>
              </div>
            )}
          </CardSection>
          <div className="h-4" />
        </div>
      </div>

      {/* In-app site preview — stays inside the PWA with a Back button (fixes the
          standalone-PWA trap where tapping the preview navigated away with no way back). */}
      {showPreview && heroUrl && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-background">
          <div className="flex items-center gap-2 border-b border-line bg-background px-3 py-2.5">
            <button
              onClick={() => setShowPreview(false)}
              className="flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-sm font-semibold text-white active:scale-[0.98]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
              Back
            </button>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{item.businessName}</span>
            <a
              href={heroUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand-tint/40"
            >
              Open in browser ↗
            </a>
          </div>
          <iframe src={heroUrl} title={`${item.businessName} site`} className="w-full flex-1 border-0 bg-white" />
        </div>
      )}
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
  const [sortBy, setSortBy] = useState<"activity" | "newest" | "oldest" | "reviews_high" | "reviews_low">("activity");
  const [local, setLocal] = useState<Record<string, AttemptStat>>(attempts);

  const stat = (id: string): AttemptStat => local[id] || { call: 0, text: 0, email: 0, total: 0, lastAt: null };
  const metaOf = (id: string): LeadMeta =>
    meta[id] || { stage: "new", accountNumber: null, plan: null, paid: false, subscriptionStatus: null, paidAt: null, receptionistStatus: null, domain: null, domainStatus: null, claimedAt: null };

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

  // Conversions scoreboard — everyone who claimed + signed up, newest claim first. A glance answer
  // to "did anyone actually sign up?" that stays visible above the cold-call list.
  const signedUp = useMemo(() => {
    return leads
      .filter((l) => { const st = metaOf(l.id).stage; return st === "claimed" || st === "customer"; })
      .sort((a, b) => (metaOf(b.id).claimedAt || "").localeCompare(metaOf(a.id).claimedAt || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, meta]);
  const payingCount = signedUp.filter((l) => metaOf(l.id).stage === "customer").length;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return leads.filter((l) => {
      if (filter !== "all" && metaOf(l.id).stage !== filter) return false;
      if (!needle) return true;
      const textMatch = [l.businessName, l.ownerName, l.city, l.niche, l.email].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle));
      const phoneMatch = digits.length >= 3 && String(l.phone || "").replace(/\D/g, "").includes(digits);
      return textMatch || phoneMatch;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, q, filter, meta]);

  const sorted = useMemo(() => {
    const rc = (l: ForgeSiteItem) => Number(l.reviewCount || 0);
    const created = (l: ForgeSiteItem) => l.createdAt || "";
    const lastAt = (l: ForgeSiteItem) => local[l.id]?.lastAt || "";
    const arr = [...filtered];
    if (sortBy === "activity") arr.sort((a, b) => lastAt(b).localeCompare(lastAt(a)) || created(b).localeCompare(created(a)));
    else if (sortBy === "oldest") arr.sort((a, b) => created(a).localeCompare(created(b)));
    else if (sortBy === "reviews_high") arr.sort((a, b) => rc(b) - rc(a) || created(b).localeCompare(created(a)));
    else if (sortBy === "reviews_low") arr.sort((a, b) => rc(a) - rc(b) || created(b).localeCompare(created(a)));
    else arr.sort((a, b) => created(b).localeCompare(created(a))); // newest
    return arr;
  }, [filtered, sortBy, local]);

  const SORTS: Array<{ key: typeof sortBy; label: string }> = [
    { key: "activity", label: "Recent activity" },
    { key: "newest", label: "Newest" },
    { key: "oldest", label: "Oldest" },
    { key: "reviews_high", label: "Most reviews" },
    { key: "reviews_low", label: "Fewest reviews" },
  ];

  const open = leads.find((l) => l.id === openId) || null;

  return (
    <div>
      {/* conversions scoreboard — who actually signed up (claimed) + who's paying */}
      {signedUp.length > 0 && (
        <div className="mb-4 rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-violet-800">🎉 Signed up</h3>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">{signedUp.length}</span>
            {payingCount > 0 && <span className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-semibold text-brand">{payingCount} paying</span>}
          </div>
          <div className="flex flex-col gap-1.5">
            {signedUp.map((l) => {
              const m = metaOf(l.id);
              return (
                <button
                  key={l.id}
                  onClick={() => setOpenId(l.id)}
                  className="flex items-center gap-3 rounded-xl border border-violet-100 bg-background px-3 py-2 text-left transition-colors hover:bg-surface"
                >
                  <Thumb item={l} size={32} rounded="rounded-md" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">{l.businessName}</div>
                    <div className="truncate text-xs text-ink-soft">
                      {m.accountNumber ? `#${m.accountNumber}` : "no acct #"} · {m.plan || "no plan yet"}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STAGE[m.stage].chip}`}>{STAGE[m.stage].label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* search */}
      <div className="relative mb-3">
        <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, phone, city, email…"
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

      {/* sort */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-ink-soft">Sort:</span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSortBy(s.key)}
            className={`rounded-full px-2.5 py-1 font-medium transition-colors ${sortBy === s.key ? "bg-brand-tint text-brand" : "text-ink-soft hover:text-ink"}`}
          >
            {s.label}
          </button>
        ))}
        <span className="ml-auto text-ink-soft">{sorted.length} contact{sorted.length === 1 ? "" : "s"}</span>
      </div>

      {/* contact list */}
      {sorted.length === 0 ? (
        <p className="py-8 text-sm text-ink-soft">No contacts match.</p>
      ) : (
        <div>
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-y border-line text-left text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                <th className="py-2 pr-3 font-semibold">Business</th>
                <th className="hidden w-28 px-3 py-2 font-semibold md:table-cell">Rating</th>
                <th className="hidden w-36 px-3 py-2 font-semibold sm:table-cell">Activity</th>
                <th className="w-24 py-2 pl-3 text-right font-semibold">Stage</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => {
                const m = metaOf(item.id);
                const a = stat(item.id);
                const st = STAGE[m.stage];
                const touchFailed = a.total === 0 && a.failed > 0;
                const touches = a.total > 0
                  ? `${a.total} touch${a.total === 1 ? "" : "es"}`
                  : touchFailed ? "email bounced" : "no touch";
                return (
                  <tr
                    key={item.id}
                    onClick={() => setOpenId(item.id)}
                    className="cursor-pointer border-b border-line align-middle transition-colors hover:bg-surface"
                  >
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-3">
                        <Thumb item={item} size={44} />
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-ink">{item.businessName}</div>
                          <div className="truncate text-xs text-ink-soft">
                            {[niche1(item), cityState(item)].filter(Boolean).join(" · ") || item.email}
                          </div>
                          {/* mobile-only meta (the desktop columns collapse below sm) */}
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-soft sm:hidden">
                            {item.googleRating && <span className="text-amber-500">★ <span className="text-ink-soft">{Number(item.googleRating).toFixed(1)}</span></span>}
                            <span className={touchFailed ? "font-medium text-red-600" : ""}>{touches}</span>
                            {a.lastAt && !touchFailed && <span suppressHydrationWarning>· {relTime(a.lastAt)}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2.5 text-ink-soft md:table-cell">
                      {item.googleRating ? (
                        <span className="flex items-center gap-1"><Stars rating={item.googleRating} /> <span className="text-ink">{Number(item.googleRating).toFixed(1)}</span>{item.reviewCount ? <span className="text-xs">({item.reviewCount})</span> : null}</span>
                      ) : <span className="text-xs">—</span>}
                    </td>
                    <td className={`hidden whitespace-nowrap px-3 py-2.5 text-xs sm:table-cell ${touchFailed ? "text-red-600" : "text-ink-soft"}`}>
                      {touches}{a.lastAt && !touchFailed ? <span className="block text-[11px]" suppressHydrationWarning>last {relTime(a.lastAt)}</span> : null}
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      {m.stage === "claimed" || m.stage === "customer" ? (
                        <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.chip}`}>{st.label}</span>
                      ) : (
                        <StageDropdown itemId={item.id} stage={m.stage} />
                      )}
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
