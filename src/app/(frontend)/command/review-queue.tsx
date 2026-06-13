"use client";

import { useState, useTransition } from "react";

import { approveDraft, denyDraft, editDraft, markSent } from "./actions";

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
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
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

export function ReviewQueue({ items }: { items: QueueItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-background p-10 text-center">
        <p className="text-ink-soft">Nothing here yet.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <Card key={item.id} item={item} />
      ))}
    </div>
  );
}

function Card({ item }: { item: QueueItem }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
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

  return (
    <div
      className={`rounded-2xl border bg-background p-5 md:p-6 ${
        approved ? "border-brand" : "border-line"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-brand-tint text-sm font-semibold text-brand">
          {initials(item.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{item.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${fitColor(item.fitScore)}`}>
              fit {item.fitScore}/6
            </span>
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
          <span className="mb-1 block text-xs text-ink-soft">
            connection note · {body.length} chars
          </span>
          {body}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {editing ? (
          <>
            <button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await editDraft(item.id, body);
                  setEditing(false);
                })
              }
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              Save
            </button>
            <button
              disabled={pending}
              onClick={() => {
                setBody(item.body);
                setEditing(false);
              }}
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
            onClick={() =>
              start(async () => {
                await markSent(item.id, item.prospectId);
                setDone("marked sent");
              })
            }
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            Mark sent
          </button>
        ) : (
          <>
            <button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await approveDraft(item.id);
                })
              }
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
              onClick={() =>
                start(async () => {
                  await denyDraft(item.id);
                  setDone("denied");
                })
              }
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-surface disabled:opacity-60"
            >
              Deny
            </button>
          </>
        )}
        <button
          onClick={() => navigator.clipboard?.writeText(body)}
          className="ml-auto rounded-full border border-line px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface"
        >
          Copy note
        </button>
      </div>
    </div>
  );
}
