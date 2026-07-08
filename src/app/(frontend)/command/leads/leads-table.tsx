"use client";

import { Fragment, useState } from "react";

import { logContactAttempt } from "../actions";
import type { ForgeSiteItem } from "../sites/sites-queue";
import type { LeadHistoryEvent } from "@/lib/forge-outreach";

export type AttemptStat = { call: number; text: number; email: number; total: number; lastAt: string | null };

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
function opener(item: ForgeSiteItem): string {
  const who = firstName(item.ownerName);
  const niche = (item.niche || "business").split(/[—·,]/)[0].trim().toLowerCase();
  const place = cityState(item);
  return [
    `Hi, is this ${who || "the owner"}?`,
    `I saw you're a local ${niche}${place ? ` in ${place}` : ""} — is that right?`,
    `Great — I found your business online and went ahead and built you a website. Do you have a second to look with me on the phone?`,
    `Perfect — I'll text you the link right now. Take a look…`,
    `Love it, right? Let's book a quick time to make any changes and get you set up.`,
  ].join("\n");
}
function Stars({ rating }: { rating: string }) {
  const s = Math.round(Number(rating) || 0);
  if (!rating) return <span className="text-ink-soft">—</span>;
  return <span className="text-amber-500">{"★".repeat(Math.max(0, Math.min(5, s)))}<span className="text-line">{"★".repeat(Math.max(0, 5 - s))}</span></span>;
}
function Photo({ item, size = 56 }: { item: ForgeSiteItem; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials = (item.businessName || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  if (item.photoUrl && !broken)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.photoUrl} alt={item.businessName} onError={() => setBroken(true)} className="shrink-0 rounded-xl object-cover" style={{ width: size, height: size }} />;
  return <div className="flex shrink-0 items-center justify-center rounded-xl font-bold text-white" style={{ width: size, height: size, background: item.brandColor || "#64748b" }}>{initials}</div>;
}

function AttemptChips({ a }: { a: AttemptStat }) {
  if (!a || a.total === 0) return <span className="text-xs text-ink-soft">not yet</span>;
  return (
    <span className="flex items-center gap-2 text-xs font-medium tabular-nums text-ink">
      {a.call > 0 && <span title="calls">📞 {a.call}</span>}
      {a.text > 0 && <span title="texts">💬 {a.text}</span>}
      {a.email > 0 && <span title="emails">✉️ {a.email}</span>}
    </span>
  );
}

export function LeadsTable({ leads, attempts, histories }: { leads: ForgeSiteItem[]; attempts: Record<string, AttemptStat>; histories: Record<string, LeadHistoryEvent[]> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, AttemptStat>>(attempts);

  const stat = (id: string): AttemptStat => local[id] || { call: 0, text: 0, email: 0, total: 0, lastAt: null };

  const record = (id: string, channel: "call" | "text" | "email") => {
    setLocal((m) => {
      const cur = m[id] || { call: 0, text: 0, email: 0, total: 0, lastAt: null };
      return { ...m, [id]: { ...cur, [channel]: cur[channel] + 1, total: cur.total + 1, lastAt: new Date().toISOString() } };
    });
    void logContactAttempt(id, channel); // fire-and-forget; the tel:/sms:/mailto: link proceeds
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-background">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              <th className="px-4 py-2.5">Business</th>
              <th className="px-3 py-2.5">Rating</th>
              <th className="px-3 py-2.5">Attempts</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Last tried</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {leads.map((item) => {
              const a = stat(item.id);
              const isOpen = openId === item.id;
              const contacted = a.total > 0;
              return (
                <Fragment key={item.id}>
                  <tr
                    onClick={() => setOpenId(isOpen ? null : item.id)}
                    className={`cursor-pointer border-b border-line transition-colors hover:bg-surface ${isOpen ? "bg-surface" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-ink">{item.businessName}</div>
                      <div className="text-xs text-ink-soft">{[item.niche?.split(/[—·,]/)[0].trim(), cityState(item)].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap"><Stars rating={item.googleRating} /></td>
                    <td className="px-3 py-3"><AttemptChips a={a} /></td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs text-ink-soft">{relTime(a.lastAt)}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${contacted ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                        {contacted ? "In progress" : "New"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-ink-soft">{isOpen ? "▲" : "▼"}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-line bg-surface/60">
                      <td colSpan={6} className="px-4 py-4">
                        <LeadDetail item={item} onContact={record} history={histories[item.id] || []} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const HIST_ICON: Record<LeadHistoryEvent["kind"], string> = { "email-sent": "✉️", call: "📞", text: "💬", email: "✉️" };
const HIST_VERB: Record<LeadHistoryEvent["kind"], string> = { "email-sent": "Emailed", call: "Called", text: "Texted", email: "Emailed" };

function HistoryTimeline({ history }: { history: LeadHistoryEvent[] }) {
  const [openMsg, setOpenMsg] = useState<number | null>(null);
  return (
    <div className="mt-3">
      <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">Message history — how &amp; what we sent</div>
      {history.length === 0 ? (
        <p className="mt-1 text-xs text-ink-soft">No contact yet — this lead hasn&apos;t been reached.</p>
      ) : (
        <ol className="mt-1.5 space-y-2">
          {history.map((e, i) => {
            const when = new Date(e.at);
            const paras = (e.body || "").split("\n\n").filter(Boolean);
            const stamp = when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
            return (
              <li key={i} className="rounded-lg border border-line bg-background p-2.5 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span>{HIST_ICON[e.kind]}</span>
                  <span className="font-semibold text-ink">{HIST_VERB[e.kind]}</span>
                  {e.kind === "email-sent" && <span className="text-ink-soft">the intro email</span>}
                  {e.kind === "text" && <span className="text-ink-soft">the site link</span>}
                  <span className="text-xs text-ink-soft">· {relTime(e.at)} ({stamp})</span>
                </div>
                {e.subject && <p className="mt-1.5 font-medium text-ink">“{e.subject}”</p>}
                {paras.length > 0 ? (
                  <>
                    <div className="mt-1 space-y-1.5 text-ink-soft">
                      {(openMsg === i ? paras : paras.slice(0, 1)).map((p, j) => <p key={j}>{p}</p>)}
                    </div>
                    {paras.length > 1 && (
                      <button onClick={() => setOpenMsg(openMsg === i ? null : i)} className="mt-1 text-xs font-medium text-brand hover:underline">
                        {openMsg === i ? "show less" : "read full message"}
                      </button>
                    )}
                  </>
                ) : (
                  <p className="mt-0.5 text-xs text-ink-soft">Phone call — no message.</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function LeadDetail({ item, onContact, history }: { item: ForgeSiteItem; onContact: (id: string, ch: "call" | "text" | "email") => void; history: LeadHistoryEvent[] }) {
  const [copied, setCopied] = useState(false);
  const s = item.socialStats || {};
  const reach: string[] = [];
  if (s.instagram?.followers) reach.push(`📷 ${fmtNum(s.instagram.followers)}`);
  if (s.facebook?.followers) reach.push(`👍 ${fmtNum(s.facebook.followers)}`);
  const quotes = (item.reviewQuotes || []).filter((q) => q.text).slice(0, 3);
  const script = opener(item);
  const isApple = typeof navigator !== "undefined" && /(iphone|ipad|mac)/i.test(navigator.userAgent);
  const smsBody = encodeURIComponent(`Hi${firstName(item.ownerName) ? ` ${firstName(item.ownerName)}` : ""}, it's Joe — here's the site I built for ${item.businessName}: ${item.liveUrl || ""}`);

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <Photo item={item} size={72} />
      <div className="min-w-0 flex-1">
        {reach.length > 0 && <div className="text-xs font-medium text-ink-soft">{reach.join("  ·  ")} followers</div>}

        {/* contact actions — each logs an attempt */}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {item.phone && (
            <a href={`tel:${tel(item.phone)}`} onClick={() => onContact(item.id, "call")} className="inline-flex items-center gap-1 rounded-full bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">
              📞 Call {item.phone}
            </a>
          )}
          {item.phone && (
            <a href={`sms:${tel(item.phone)}${isApple ? "&" : "?"}body=${smsBody}`} onClick={() => onContact(item.id, "text")} className="inline-flex items-center gap-1 rounded-full border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand-tint">
              💬 Text the link
            </a>
          )}
          {item.email && (
            <a href={`mailto:${item.email}`} onClick={() => onContact(item.id, "email")} className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-2 text-sm font-medium text-ink-soft hover:text-ink">
              ✉️ Email
            </a>
          )}
          {item.liveUrl && (
            <a href={item.liveUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-2 text-sm font-medium text-ink-soft hover:text-ink">
              🔗 Live site ↗
            </a>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-soft">Text opens your Messages app (sends from your phone, not the 480). Each tap is logged here as an attempt.</p>

        <HistoryTimeline history={history} />

        {quotes.length > 0 && (
          <div className="mt-3">
            <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">What customers say</div>
            <ul className="mt-1.5 space-y-1.5">
              {quotes.map((q, i) => (
                <li key={i} className="text-sm text-ink">
                  <span className="text-amber-500">{"★".repeat(Math.max(0, Math.min(5, q.stars || 0)))}</span>{" "}
                  <span className="italic">“{q.text}”</span>{q.name && <span className="text-ink-soft"> — {q.name}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 rounded-xl border border-brand/30 bg-brand-tint/40 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-brand">📞 Calling script</span>
            <button
              onClick={() => { navigator.clipboard?.writeText(item.callPrep ? `${script}\n\n— Your angle —\n${item.callPrep}` : script).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
              className="rounded-full border border-brand/40 px-2.5 py-0.5 text-xs font-semibold text-brand hover:bg-brand-tint"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <div className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{script}</div>
          {item.callPrep && (
            <div className="mt-3 border-t border-brand/20 pt-2">
              <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">Your angle for this one</div>
              <div className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{item.callPrep}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
