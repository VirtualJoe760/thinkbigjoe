"use client";

import { useState, useTransition } from "react";
import { approveReply, pauseReply } from "./reply-actions";

type Props = {
  draftId: number;
  prospectId: number;
  draft: string;
};

export function ReplyPanel({ draftId, prospectId, draft }: Props) {
  const [text, setText] = useState(draft);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function handleApprove() {
    startTransition(async () => {
      await approveReply(draftId, text.trim());
      setDone(true);
    });
  }

  function handlePause() {
    startTransition(async () => {
      await pauseReply(draftId, prospectId);
      setDone(true);
    });
  }

  if (done) {
    return (
      <p className="text-sm font-medium text-green-700">
        ✓ Reply queued — Venus will send it in the next outreach window.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="w-full rounded-xl border border-line bg-background px-4 py-3 text-sm leading-relaxed focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
      />
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleApprove}
          disabled={pending || !text.trim()}
          className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Saving…" : "Approve & queue"}
        </button>
        <button
          onClick={handlePause}
          disabled={pending}
          className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-surface disabled:opacity-50"
        >
          Pause prospect
        </button>
      </div>
    </div>
  );
}
