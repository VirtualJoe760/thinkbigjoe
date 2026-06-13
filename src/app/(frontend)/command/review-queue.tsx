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
  profileUrl: string;
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
    "Between application/quote intake, policy docs, and client retention follow-up — which eats the most of your team's day right now?",
  mortgage:
    "In your pipeline, where's the biggest time-sink: pulling loan docs and conditions, or keeping borrowers updated?",
  wealth:
    "Where does the most manual work pile up — client onboarding paperwork, reviews, or compliance comms?",
  law: "If one thing at your firm could draft or process itself — intake, first-draft docs, or case-file research — which would free up the most billable time?",
  msp: "Two things I help MSPs with — tier-1 ticket automation, and white-label AI you resell to clients. Which is more on your radar?",
  other:
    "What's the one workflow that, if it basically ran itself, would give your team the most time back?",
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
      <div className="rounded-2xl border border-line bg-background p-10 text-center">
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
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface px-4 py-2.5">
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
            <div className="flex items-center gap-2">
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
    <div className={`rounded-2xl border bg-background p-5 md:p-6 ${approved ? "border-brand" : "border-line"} ${checked ? "ring-2 ring-brand/30" : ""}`}>
      <div className="flex items-start gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="mt-1 h-4 w-4 flex-shrink-0 accent-brand"
            aria-label={`Select ${item.name}`}
          />
        )}
        <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-brand-tint text-sm font-semibold text-brand">
          {initials(item.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/command/${item.prospectId}`}
              className="font-semibold hover:text-brand hover:underline"
            >
              {item.name}
            </a>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${fitColor(item.fitScore)}`}>
              fit {item.fitScore}/6
            </span>
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
          <p className="text-sm text-ink-soft">
            {[item.title, item.company].filter(Boolean).join(", ")}
            {item.location ? ` · ${item.location}` : ""}
          </p>
        </div>
        {item.profileUrl && (
          <a
            href={item.profileUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface"
          >
            Open profile ↗
          </a>
        )}
      </div>

      {item.hook && <p className="mt-3 text-xs text-ink-soft">💡 {item.hook}</p>}

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

      <div className="mt-4 flex flex-wrap items-center gap-2">
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
              className="flex-1 rounded-full border border-line bg-surface px-4 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
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
            className="ml-auto rounded-full border border-line px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface"
          >
            Copy note
          </button>
        )}
      </div>
    </div>
  );
}
