"use client";

import { useState, useTransition } from "react";

import {
  approveDraft,
  approveMany,
  denyDraft,
  denyMany,
  editDraft,
  markSent,
} from "./actions";

export type QueueItem = {
  id: string;
  body: string;
  status: string;
  prospectId: string;
  name: string;
  title: string;
  company: string;
  vertical: string;
  location: string;
  degree: string;
  hook: string;
  fitScore: number;
  source: string;
  profileUrl: string;
  websiteUrl: string;
  googleMyBusinessUrl: string;
  photoUrl: string;
  email: string;
  phone: string;
  websiteStatus: string;
  websiteRating: number | null;
  websiteNotes: string;
  salesOpportunities: string[];
  updatedAt: string;
  approvedAt: string;
  sentAt: string;
};

const VERTICAL_LABEL: Record<string, string> = {
  insurance: "Insurance",
  mortgage: "Mortgage",
  wealth: "Wealth",
  law: "Law",
  msp: "MSP",
  other: "Other",
};

const DIAGNOSTIC: Record<string, string> = {
  insurance:
    "Thanks so much for connecting — no agenda here, just genuinely curious: what's the part of running the agency that eats more of your week than it probably should?",
  mortgage:
    "Thanks for connecting — genuinely curious, no pitch: in your pipeline, what quietly eats the most time — chasing docs and conditions, or keeping borrowers in the loop?",
  wealth:
    "Thanks for connecting — no agenda, just curious: where does the most manual or admin work tend to pile up for your team these days?",
  law: "Thanks for connecting — genuinely curious, and not selling anything: what's the work at the firm that eats the most time but doesn't really need a lawyer's brain to do?",
  msp: "Thanks for connecting — curious, no pitch: what's the most repetitive thing your team handles day to day that you kind of wish just took care of itself?",
  other:
    "Thanks for connecting — no agenda, just curious: what's the one task that eats more of your team's week than it probably should?",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function fitColor(score: number) {
  if (score >= 6) return "bg-green-50 text-green-700";
  if (score >= 4) return "bg-brand-tint text-brand";
  return "bg-surface text-ink-soft";
}

function when(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusLine(item: QueueItem): { text: string; tone: string } {
  switch (item.status) {
    case "approved":
      return { text: `approved ${when(item.approvedAt || item.updatedAt)}`, tone: "text-brand" };
    case "sent":
      return { text: `sent ${when(item.sentAt || item.updatedAt)}`, tone: "text-green-700" };
    case "edited":
      return { text: `edited ${when(item.updatedAt)}`, tone: "text-ink-soft" };
    case "denied":
      return { text: `denied ${when(item.updatedAt)}`, tone: "text-red-600" };
    default:
      return { text: `drafted ${when(item.updatedAt)}`, tone: "text-ink-soft" };
  }
}

const isPending = (s: string) => s === "draft" || s === "edited";

export function ReviewQueue({ items }: { items: QueueItem[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-background p-8 text-center">
        <p className="text-ink-soft">Nothing here yet.</p>
      </div>
    );
  }

  const pendingIds = items.filter((i) => isPending(i.status)).map((i) => i.id);
  const selectedPending = [...sel].filter((id) => pendingIds.includes(id));
  const allSelected = pendingIds.length > 0 && selectedPending.length === pendingIds.length;

  const toggle = (id: string) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-3">
      {pendingIds.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl bg-surface px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSel(allSelected ? new Set() : new Set(pendingIds))}
              className="h-4 w-4 accent-brand"
            />
            {selectedPending.length > 0 ? `${selectedPending.length} selected` : "Select all"}
          </label>
          {selectedPending.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                disabled={pending}
                onClick={() => start(async () => { await approveMany(selectedPending); setSel(new Set()); })}
                className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
              >
                Approve {selectedPending.length}
              </button>
              <button
                disabled={pending}
                onClick={() => start(async () => { await denyMany(selectedPending); setSel(new Set()); })}
                className="rounded-full border border-line bg-background px-4 py-1.5 text-sm font-semibold text-red-600 transition-colors hover:bg-background/60 disabled:opacity-60"
              >
                Deny {selectedPending.length}
              </button>
              <button
                onClick={() => setSel(new Set())}
                className="text-sm font-semibold text-ink-soft hover:text-ink"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
      {items.map((item) => (
        <Card
          key={item.id}
          item={item}
          selectable={isPending(item.status)}
          checked={sel.has(item.id)}
          onToggle={() => toggle(item.id)}
        />
      ))}
    </div>
  );
}

function Card({
  item,
  selectable,
  checked,
  onToggle,
}: {
  item: QueueItem;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [body, setBody] = useState(item.body);
  const [done, setDone] = useState<string | null>(null);

  if (done) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-line bg-surface px-5 py-3 text-sm">
        <span className="text-ink-soft">
          <span className="font-semibold text-ink">{item.name}</span> · {done}
        </span>
      </div>
    );
  }

  const approved = item.status === "approved";
  const sent = item.status === "sent";
  const sline = statusLine(item);
  const diagnostic = DIAGNOSTIC[item.vertical] || DIAGNOSTIC.other;

  return (
    <div className={`rounded-xl border bg-background p-4 sm:p-5 ${approved ? "border-brand" : "border-line"} ${checked ? "ring-2 ring-brand/30" : ""}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {selectable && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="h-4 w-4 flex-shrink-0 accent-brand sm:mt-1"
            aria-label={`Select ${item.name}`}
          />
        )}
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div
            className="grid h-12 w-12 flex-shrink-0 place-items-center overflow-hidden rounded-full bg-brand-tint bg-cover bg-center text-sm font-semibold text-brand"
            style={item.photoUrl ? { backgroundImage: `url("${item.photoUrl}")` } : undefined}
            aria-hidden="true"
          >
            {!item.photoUrl && initials(item.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/command/${item.prospectId}`}
                className="min-w-0 max-w-full truncate font-semibold hover:text-brand hover:underline"
              >
                {item.name}
              </a>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${fitColor(item.fitScore)}`}>
                fit {item.fitScore}/6
              </span>
              {item.websiteRating && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                  site {item.websiteRating}/10
                </span>
              )}
              {item.vertical && (
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-soft">
                  {VERTICAL_LABEL[item.vertical] || item.vertical}
                </span>
              )}
              {item.degree && (
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-soft">
                  {item.degree}
                </span>
              )}
              <span className={`text-xs font-medium ${sline.tone}`}>· {sline.text}</span>
            </div>
            <p className="mt-0.5 text-sm text-ink-soft">
              {[item.title, item.company].filter(Boolean).join(", ")}
              {item.location ? ` · ${item.location}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {item.source && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              item.source === "linkedin" ? "bg-blue-50 text-blue-700" :
              item.source === "google" || item.source === "google_maps" ? "bg-green-50 text-green-700" :
              "bg-surface text-ink-soft"
            }`}>
              {item.source === "google_maps" ? "Google Maps" : item.source.charAt(0).toUpperCase() + item.source.slice(1)}
            </span>
          )}
          {item.profileUrl && (
            <a href={item.profileUrl} target="_blank" rel="noreferrer"
              className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface">
              LinkedIn
            </a>
          )}
          {item.googleMyBusinessUrl && (
            <a href={item.googleMyBusinessUrl} target="_blank" rel="noreferrer"
              className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface">
              Google
            </a>
          )}
          {item.websiteUrl && (
            <a href={item.websiteUrl} target="_blank" rel="noreferrer"
              className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface">
              Website
            </a>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-soft">
        {item.email ? (
          <a href={`mailto:${item.email}`} className="flex items-center gap-1 hover:text-ink">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4zM4 8l8 5 8-5" /></svg>
            {item.email}
          </a>
        ) : (
          <span className="flex items-center gap-1 opacity-40">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4zM4 8l8 5 8-5" /></svg>
            Email not found
          </span>
        )}
        {item.phone && (
          <a href={`tel:${item.phone}`} className="flex items-center gap-1 hover:text-ink">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M6.6 3A2 2 0 014.9 4.2l-1.4 2.8A18 18 0 0017 19.5l2.8-1.4a2 2 0 011.2-1.7l-4-1.7a2 2 0 00-2.1.5l-.8.8A12.1 12.1 0 018 9.3l.8-.8a2 2 0 00.5-2.1z" /></svg>
            {item.phone}
          </a>
        )}
      </div>

      {(item.hook || item.websiteStatus || item.websiteNotes || item.salesOpportunities.length > 0) && (
        <details className="group mt-3 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-ink-soft hover:text-ink">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
            Research &amp; notes
          </summary>
          {item.hook && <p className="mt-2 text-xs text-ink-soft">💡 {item.hook}</p>}
          {(item.websiteStatus || item.websiteNotes || item.salesOpportunities.length > 0) && (
            <div className="mt-2 grid gap-2 rounded-xl border border-line bg-surface p-3 text-xs leading-relaxed text-ink-soft md:grid-cols-[0.9fr_1.1fr]">
              <div>
                <span className="block font-semibold text-ink">Website read</span>
                {item.websiteStatus && <span>{item.websiteStatus}</span>}
                {item.websiteNotes && <p className="mt-1">{item.websiteNotes}</p>}
              </div>
              {item.salesOpportunities.length > 0 && (
                <div>
                  <span className="block font-semibold text-ink">Sales opportunities</span>
                  <ul className="mt-1 space-y-1">
                    {item.salesOpportunities.slice(0, 3).map((opportunity) => (
                      <li key={opportunity}>• {opportunity}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </details>
      )}

      {editing ? (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          className="mt-3 w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm leading-relaxed focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
      ) : (
        <div className="mt-3 rounded-xl bg-surface px-4 py-3 text-sm leading-relaxed">
          <span className="mb-1 block text-xs text-ink-soft">connection note · {body.length} chars</span>
          {body}
        </div>
      )}

      {!sent && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer list-none text-xs font-semibold text-ink-soft hover:text-ink">
            Next step on accept → diagnostic question
          </summary>
          <p className="mt-2 rounded-xl border border-line bg-background px-4 py-3 leading-relaxed text-ink-soft">
            {diagnostic}
          </p>
        </details>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {editing ? (
          <>
            <button
              disabled={pending}
              onClick={() => start(async () => { await editDraft(item.id, body); setEditing(false); })}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              Save
            </button>
            <button
              disabled={pending}
              onClick={() => { setBody(item.body); setEditing(false); }}
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface"
            >
              Cancel
            </button>
          </>
        ) : denying ? (
          <>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why? (optional — improves future drafts)"
              className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <button
              disabled={pending}
              onClick={() => start(async () => { await denyDraft(item.id, reason); setDone("denied"); })}
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
        ) : sent ? (
          <span className="text-sm text-ink-soft">Sent — awaiting their reply.</span>
        ) : approved ? (
          <button
            disabled={pending}
            onClick={() => start(async () => { await markSent(item.id, item.prospectId); setDone("marked sent"); })}
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            Mark sent
          </button>
        ) : (
          <>
            <button
              disabled={pending}
              onClick={() => start(async () => { await approveDraft(item.id); })}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              Approve
            </button>
            <button
              disabled={pending}
              onClick={() => setEditing(true)}
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface"
            >
              Edit
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
        {!denying && (
          <button
            onClick={() => navigator.clipboard?.writeText(body)}
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface sm:ml-auto"
          >
            Copy note
          </button>
        )}
      </div>
    </div>
  );
}
