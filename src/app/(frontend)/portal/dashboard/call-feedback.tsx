"use client";

import { useState, useTransition } from "react";

import { rateCall } from "./actions";

/**
 * The feedback control on one call — "handled well" / "got this wrong".
 *
 * This is the one interactive bit on an otherwise zero-JS dashboard (a contractor on bad LTE reads
 * the whole page without hydration; only tapping a rating needs JS). Optimistic: the choice shows
 * immediately, reverts if the server rejects it. A "bad" rating reveals a one-line note box, because
 * "what did it get wrong" is the signal that actually improves the agent.
 */
export function CallFeedback({
  callId,
  initialRating,
}: {
  callId: number;
  initialRating: "good" | "bad" | null;
}) {
  const [rating, setRating] = useState(initialRating);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(next: "good" | "bad") {
    // Tapping the active choice again clears it — a rating you can't undo isn't feedback, it's a trap.
    const value = rating === next ? null : next;
    const prev = rating;
    setRating(value);
    setError(null);
    setShowNote(value === "bad");
    startTransition(async () => {
      const res = await rateCall(callId, value, value === "bad" ? note : undefined);
      if (!res.ok) {
        setRating(prev); // put it back — the write didn't land
        setError(res.message ?? "Couldn't save that.");
      }
    });
  }

  function saveNote() {
    if (rating !== "bad") return;
    startTransition(async () => {
      const res = await rateCall(callId, "bad", note);
      if (!res.ok) setError(res.message ?? "Couldn't save that.");
      else setShowNote(false);
    });
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          How did we do?
        </span>
        <button
          type="button"
          onClick={() => choose("good")}
          disabled={pending}
          aria-pressed={rating === "good"}
          className={`inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
            rating === "good"
              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
              : "border-line bg-background text-ink-soft hover:bg-surface hover:text-ink"
          }`}
        >
          👍 Good
        </button>
        <button
          type="button"
          onClick={() => choose("bad")}
          disabled={pending}
          aria-pressed={rating === "bad"}
          className={`inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
            rating === "bad"
              ? "border-red-400 bg-red-50 text-red-700"
              : "border-line bg-background text-ink-soft hover:bg-surface hover:text-ink"
          }`}
        >
          👎 Got it wrong
        </button>
      </div>

      {showNote && (
        <div className="mt-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="What should it have done? (optional — this is how we fix it)"
            className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none"
          />
          <button
            type="button"
            onClick={saveNote}
            disabled={pending}
            className="mt-2 inline-flex min-h-9 items-center rounded-full bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
          >
            {pending ? "Saving…" : "Send"}
          </button>
        </div>
      )}

      {rating === "good" && !showNote && (
        <p className="mt-2 text-xs text-emerald-700">Thanks — glad it worked.</p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
