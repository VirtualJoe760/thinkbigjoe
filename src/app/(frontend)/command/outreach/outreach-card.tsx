"use client";

import { useState, useTransition } from "react";

import { setOutreachSkip } from "../actions";
import type { OutreachQueueItem } from "@/lib/forge-outreach";
import { cardClass, StatusPill } from "@/components/ui";

const BADGE: Record<OutreachQueueItem["status"], { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  queued: { label: "Queued · sends 10am", tone: "info" },
  sent: { label: "✓ Sent", tone: "success" },
  skipped: { label: "Skipped", tone: "neutral" },
  "needs-email": { label: "Needs an email", tone: "warning" },
};

export function OutreachCard({ item }: { item: OutreachQueueItem }) {
  const [status, setStatus] = useState(item.status);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const badge = BADGE[status];

  const toggleSkip = (skip: boolean) => {
    setStatus(skip ? "skipped" : "queued");
    start(() => void setOutreachSkip(String(item.id), skip));
  };

  return (
    <div className={cardClass({ padding: "sm", className: status === "skipped" ? "opacity-60" : "" })}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{item.businessName}</span>
        <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
        {item.liveUrl && (
          <a href={item.liveUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand hover:underline">
            View site ↗
          </a>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
        <span>{item.email ? `→ ${item.email}` : "no email on file yet"}</span>
        {item.claimCode && <span className="font-mono">code {item.claimCode}</span>}
        <button onClick={() => setOpen((v) => !v)} className="font-medium text-brand hover:underline">
          {open ? "hide message" : "read message"}
        </button>
      </div>

      {open && (
        <div className={cardClass({ radius: "xl", tone: "surface", padding: "none", className: "mt-3 p-3 text-sm" })}>
          <p className="font-semibold text-ink">{item.subject}</p>
          <div className="mt-2 space-y-2 text-ink-soft">
            {item.body.split("\n\n").map((p, i) => <p key={i}>{p}</p>)}
          </div>
          <p className="mt-3 border-t border-line pt-2 text-[11px] text-ink-soft">
            + the branded footer adds a “See your new site” button, the claim-code block, and a “Book a call with Joe”
            button. Replies go to your inbox.
          </p>
        </div>
      )}

      {status !== "sent" && status !== "needs-email" && (
        <div className="mt-3">
          {status === "skipped" ? (
            <button onClick={() => toggleSkip(false)} disabled={pending} className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink hover:bg-background disabled:opacity-50">
              ↺ Include in the send
            </button>
          ) : (
            <button onClick={() => toggleSkip(true)} disabled={pending} className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-soft hover:text-ink disabled:opacity-50">
              Skip this one
            </button>
          )}
        </div>
      )}
    </div>
  );
}
