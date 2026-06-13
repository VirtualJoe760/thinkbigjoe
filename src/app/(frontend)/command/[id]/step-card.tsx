"use client";

import { useState, useTransition } from "react";

import { approveDraft, denyDraft, editDraft, markSent } from "../actions";

export type Step = {
  id: string;
  step: string;
  body: string;
  status: string;
};

const STEP_LABEL: Record<string, string> = {
  connection: "1 · Connection request",
  diagnostic: "2 · Diagnostic question (after they accept)",
  reflect: "3 · Reflect (after they reply)",
  invite: "4 · Invite to book (when they're interested)",
  followup: "Follow-up",
};

const STEP_HINT: Record<string, string> = {
  connection: "Sent as the connection-request note. ≤300 characters.",
  diagnostic: "Send once they accept. One low-friction question — earns the reply.",
  reflect: "Reply-dependent — pick the branch that matches what they say.",
  invite: "Send when they're interested. Routes them to the gated intake to book.",
};

function statusBadge(status: string) {
  const map: Record<string, { t: string; c: string }> = {
    draft: { t: "draft", c: "bg-surface text-ink-soft" },
    edited: { t: "edited", c: "bg-surface text-ink-soft" },
    approved: { t: "approved", c: "bg-brand-tint text-brand" },
    denied: { t: "denied", c: "bg-surface text-red-600" },
    sent: { t: "sent", c: "bg-green-50 text-green-700" },
  };
  const s = map[status] || map.draft;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.c}`}>{s.t}</span>;
}

export function StepCard({
  step,
  prospectId,
  canApprove,
}: {
  step: Step;
  prospectId: string;
  canApprove: boolean;
}) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(step.body);
  const [status, setStatus] = useState(step.status);

  return (
    <div className="rounded-2xl border border-line bg-background p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold tracking-tight">
          {STEP_LABEL[step.step] || step.step}
        </span>
        {statusBadge(status)}
      </div>
      {STEP_HINT[step.step] && (
        <p className="mb-3 text-xs text-ink-soft">{STEP_HINT[step.step]}</p>
      )}

      {editing ? (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm leading-relaxed focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
      ) : (
        <div className="rounded-xl bg-surface px-4 py-3 text-sm leading-relaxed">
          <span className="mb-1 block text-xs text-ink-soft">{body.length} chars</span>
          {body}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button
              disabled={pending}
              onClick={() => start(async () => { await editDraft(step.id, body); setStatus("edited"); setEditing(false); })}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              Save
            </button>
            <button
              disabled={pending}
              onClick={() => { setBody(step.body); setEditing(false); }}
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setEditing(true)}
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface"
            >
              Edit
            </button>
            {canApprove && status !== "approved" && status !== "sent" && (
              <button
                disabled={pending}
                onClick={() => start(async () => { await approveDraft(step.id); setStatus("approved"); })}
                className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
              >
                Approve
              </button>
            )}
            {canApprove && status === "approved" && (
              <button
                disabled={pending}
                onClick={() => start(async () => { await markSent(step.id, prospectId); setStatus("sent"); })}
                className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
              >
                Mark sent
              </button>
            )}
            {canApprove && status !== "sent" && (
              <button
                disabled={pending}
                onClick={() => start(async () => { await denyDraft(step.id); setStatus("denied"); })}
                className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-surface disabled:opacity-60"
              >
                Deny
              </button>
            )}
            <button
              onClick={() => navigator.clipboard?.writeText(body)}
              className="ml-auto rounded-full border border-line px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface"
            >
              Copy
            </button>
          </>
        )}
      </div>
    </div>
  );
}
