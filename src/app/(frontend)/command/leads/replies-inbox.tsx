"use client";

import { useState, useTransition } from "react";

import { sendReply, dismissReply } from "../actions";
import type { PendingReply } from "@/lib/forge-outreach";

/**
 * Inbound-reply review: a prospect wrote back, the inbox poller pre-drafted a response
 * (Gemini), and Joe reviews/edits/sends here. This is the human gate — nothing emails
 * automatically. Send → SMTP (reply-to Joe); Dismiss → clears it without a reply.
 */
function ReplyCard({ reply }: { reply: PendingReply }) {
  const [text, setText] = useState(reply.draft ?? "");
  const [pending, start] = useTransition();
  const [done, setDone] = useState<null | "sent" | "dismissed">(null);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div className="rounded-2xl border border-line bg-background p-4 text-sm text-ink-soft">
        <span className="font-semibold text-ink">{reply.businessName}</span> —{" "}
        {done === "sent" ? "reply sent ✓" : "dismissed"}
      </div>
    );
  }

  const send = () =>
    start(async () => {
      setError(null);
      const res = await sendReply(reply.id, text);
      if (res.ok) setDone("sent");
      else setError(res.message);
    });

  const dismiss = () =>
    start(async () => {
      await dismissReply(reply.id);
      setDone("dismissed");
    });

  const when = new Date(reply.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold">{reply.businessName}</span>
        <span className="text-sm text-ink-soft">{reply.fromEmail}</span>
        {reply.liveUrl && (
          <a href={reply.liveUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand hover:underline">
            view site ↗
          </a>
        )}
        {/* server renders in UTC, client in the viewer's zone → different hour; suppress the mismatch */}
        <span className="ml-auto text-xs text-ink-soft" suppressHydrationWarning>{when}</span>
      </div>
      {reply.subject && <p className="mt-1 text-xs font-medium text-ink-soft">Re: {reply.subject}</p>}

      {/* What they wrote */}
      <p className="mt-3 whitespace-pre-wrap rounded-xl bg-white px-4 py-3 text-sm leading-relaxed text-ink shadow-sm">
        {reply.inboundText || "(no text — check the inbox directly)"}
      </p>

      {/* Draft response — editable */}
      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
        Your reply {reply.draft ? "(auto-drafted — edit freely)" : "(write one)"}
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        disabled={pending}
        placeholder="Write your reply…"
        className="mt-1 w-full rounded-xl border border-line bg-background px-4 py-3 text-sm leading-relaxed text-ink focus:border-brand focus:outline-none disabled:opacity-60"
      />

      {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={send}
          disabled={pending || !text.trim()}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send reply"}
        </button>
        <button
          onClick={dismiss}
          disabled={pending}
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-surface disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function RepliesInbox({ replies }: { replies: PendingReply[] }) {
  return (
    <div className="space-y-3">
      {replies.map((r) => (
        <ReplyCard key={r.id} reply={r} />
      ))}
    </div>
  );
}
