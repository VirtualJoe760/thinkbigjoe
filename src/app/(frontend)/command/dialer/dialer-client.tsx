"use client";

import { useState, useTransition } from "react";

import { logDialOutcome, type DialDisposition } from "./actions";

export type DialerLead = {
  id: number;
  businessName: string;
  ownerName: string | null;
  phone: string;
  niche: string | null;
  city: string | null;
  rating: string | null;
  reviews: string | null;
  notes: string | null;
  callPrep: string | null;
  previewUrl: string;
  existingSite: string | null;
  claimCode: string | null;
  callbackDue: boolean;
  callbackNote: string | null;
};

const DISPOSITIONS: Array<{ key: DialDisposition; label: string; tone: "muted" | "warm" | "hot" | "cold" }> = [
  { key: "no_answer", label: "No answer", tone: "muted" },
  { key: "voicemail", label: "Voicemail", tone: "muted" },
  { key: "callback", label: "Callback", tone: "warm" },
  { key: "interested", label: "Interested", tone: "hot" },
  { key: "booked", label: "Booked 🎉", tone: "hot" },
  { key: "not_interested", label: "Not interested", tone: "cold" },
  { key: "bad_number", label: "☎️ Bad number", tone: "muted" },
];

/**
 * The call session. One lead at a time: tap Call (native dialer on the Boost phone), come back,
 * tap the outcome — the next lead loads instantly. Optimistic + fire-and-forget logging so the
 * flow never waits on the network between calls.
 */
export function DialerClient({ queue }: { queue: DialerLead[] }) {
  const [i, setI] = useState(0);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<Record<number, DialDisposition>>({});
  const [, start] = useTransition();

  const lead = queue[i];
  const doneCount = Object.keys(done).length;

  if (!lead) {
    return (
      <div className="py-16 text-center">
        <p className="text-4xl">🏁</p>
        <h1 className="mt-3 text-xl font-bold">Session done</h1>
        <p className="mt-1 text-sm text-ink-soft">{doneCount} calls logged. Refresh for a fresh queue.</p>
      </div>
    );
  }

  function next(d: DialDisposition) {
    const target = lead!;
    const n = note.trim();
    setDone((cur) => ({ ...cur, [target.id]: d }));
    setNote("");
    setI((cur) => cur + 1);
    start(async () => {
      try {
        await logDialOutcome({ siteId: target.id, disposition: d, note: n });
      } catch {
        /* logged optimistically; a miss here loses one log line, never the session */
      }
    });
  }

  const telHref = `tel:${lead.phone.replace(/[^0-9+]/g, "")}`;

  return (
    <div>
      {/* progress */}
      <div className="flex items-center justify-between text-xs text-ink-soft">
        <span className="font-semibold uppercase tracking-widest text-brand">Dialer</span>
        <span className="tabular-nums">{i + 1} / {queue.length} · {doneCount} logged</span>
      </div>

      {/* the lead */}
      <div className="mt-3 rounded-2xl border border-line bg-surface p-5">
        {lead.callbackDue && (
          <p className="mb-2 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800">
            ⏰ Callback due{lead.callbackNote ? ` — ${lead.callbackNote}` : ""}
          </p>
        )}
        <h1 className="text-2xl font-extrabold tracking-tight">{lead.businessName}</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          {[lead.ownerName && `owner: ${lead.ownerName}`, lead.niche, lead.city].filter(Boolean).join(" · ")}
          {lead.rating ? ` · ${lead.rating}★${lead.reviews ? ` (${lead.reviews})` : ""}` : ""}
        </p>

        <a
          href={telHref}
          className="mt-4 flex min-h-14 items-center justify-center rounded-2xl bg-green-600 text-lg font-bold text-white active:bg-green-700"
        >
          📞 Call {lead.phone}
        </a>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <a href={lead.previewUrl} target="_blank" rel="noopener noreferrer" className="rounded-full border border-line px-3 py-1.5 font-semibold text-brand">
            Preview site ↗
          </a>
          {lead.claimCode && <span className="rounded-full border border-line px-3 py-1.5 text-ink-soft">code {lead.claimCode}</span>}
        </div>

        {/* FACTS — only what the DB actually holds; website status is hedged, never asserted. */}
        <div className="mt-4 rounded-xl border border-line bg-background px-4 py-3 text-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink-soft">Facts</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {lead.rating && <li>⭐ {lead.rating}★{lead.reviews ? ` · ${lead.reviews} reviews` : ""} (Google)</li>}
            <li>
              {lead.existingSite
                ? <>🌐 has a site on file: <a className="text-brand underline" href={lead.existingSite} target="_blank" rel="noreferrer">{lead.existingSite.replace(/^https?:\/\//, "")}</a> — check its state before claiming anything</>
                : <>🌐 no site on file — <b>ask, don&apos;t assert</b> (our scan can miss one)</>}
            </li>
            {lead.niche && <li>🔧 {lead.niche}</li>}
          </ul>
        </div>

        {/* THE SCRIPT — deterministic, short, question-led. Grounded in the doctrine (Sandler
            up-front contract · SPIN/NEPQ discovery-before-pitch · approved offer frame). */}
        <div className="mt-2 rounded-xl bg-brand-tint px-4 py-3 text-sm leading-relaxed">
          <p className="text-[10px] font-bold uppercase tracking-widest text-brand">Script</p>
          <ol className="mt-1 list-decimal space-y-1.5 pl-4 text-[13px]">
            <li><b>Open:</b> &ldquo;Hey{lead.ownerName ? ` ${lead.ownerName.split(" ")[0]}` : ""}, this is Joe with ThinkBigJoe — I know I&apos;m calling out of the blue. Got 30 seconds?&rdquo;</li>
            <li><b>Ask (never assert):</b> &ldquo;How are you handling your website right now?&rdquo; <span className="text-ink-soft">…listen. Their answer sets the call.</span></li>
            <li><b>The gift:</b> &ldquo;Reason I ask — we made a free preview of what a site for {lead.businessName} could look like. Want me to text you the link right now?&rdquo;</li>
            <li><b>Offer (only if they engage):</b> plans start at $99/mo + a modest site fee; a couple hundred more = our AI receptionist answers every call and books jobs.</li>
            <li><b>Close:</b> book the Zoom, or text the preview + let the follow-up cadence work.</li>
          </ol>
          <p className="mt-2 text-[11px] text-ink-soft">Objections: has a site → &ldquo;is it bringing you calls, or just sitting there?&rdquo; · busy → &ldquo;totally — 30 seconds: can I text you the link?&rdquo; · not interested → thank them, mark it, out.</p>
        </div>

        {(lead.callPrep || lead.notes) && (
          <details className="mt-2 text-sm text-ink-soft">
            <summary className="cursor-pointer font-medium">Research notes</summary>
            {lead.callPrep && <p className="mt-1 whitespace-pre-wrap text-xs">{lead.callPrep}</p>}
            {lead.notes && <p className="mt-1 whitespace-pre-wrap text-xs">{lead.notes}</p>}
          </details>
        )}
      </div>

      {/* outcome */}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Quick note (optional) — objection, promise, detail…"
        className="mt-3 w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        {DISPOSITIONS.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => next(d.key)}
            className={`min-h-12 rounded-xl text-sm font-bold transition-colors ${
              d.tone === "hot" ? "bg-brand text-white active:bg-brand-dark"
              : d.tone === "warm" ? "bg-amber-100 text-amber-900 active:bg-amber-200"
              : d.tone === "cold" ? "bg-red-50 text-red-700 active:bg-red-100"
              : "bg-surface border border-line text-ink active:bg-line"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => { setNote(""); setI((c) => c + 1); }}
        className="mt-2 w-full rounded-xl py-2 text-center text-xs font-semibold text-ink-soft"
      >
        Skip without logging →
      </button>
    </div>
  );
}
