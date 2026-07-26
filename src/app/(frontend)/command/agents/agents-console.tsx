"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { agentChatTurn } from "./actions";
import type { ChatTurn } from "./models";

export type ProspectOption = {
  id: number;
  name: string;
  niche: string | null;
  city: string | null;
  owner: string | null;
  enriched: boolean;
};

type Bubble = ChatTurn & { model?: string; ms?: number };

/**
 * Live chat bench for the SMS communications agent. You play the prospect ("them"); the agent
 * answers as ThinkBigJoe. Switching prospect or model resets the thread — each conversation is a
 * clean role-play. The whole transcript is replayed to the server each turn, so the agent has the
 * full context exactly as it would in a real thread.
 */
export function AgentsConsole({ prospects, models }: { prospects: ProspectOption[]; models: string[] }) {
  const [siteId, setSiteId] = useState<number>(prospects[0]?.id ?? 0);
  const [model, setModel] = useState<string>(models[0] ?? "glm-5.2");
  const [turns, setTurns] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const prospect = prospects.find((p) => p.id === siteId);

  // New prospect or model → fresh conversation.
  useEffect(() => {
    setTurns([]);
    setError(null);
  }, [siteId, model]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, pending]);

  function send() {
    const text = draft.trim();
    if (!text || pending) return;
    const history = turns.map((t) => ({ from: t.from, text: t.text }));
    const next: Bubble[] = [...turns, { from: "them", text }];
    setTurns(next);
    setDraft("");
    setError(null);
    start(async () => {
      try {
        const res = await agentChatTurn({ siteId, message: text, history, model });
        if (res.reply) {
          setTurns((cur) => [...cur, { from: "us", text: res.reply as string, model: res.model, ms: res.ms }]);
        } else {
          setError("Agent returned nothing (model refused, timed out, or is unavailable). Try another model.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed");
      }
    });
  }

  const quick = [
    "thanks for the 5 minutes of putting this together, I don't need one but thanks",
    "honestly this feels like a scam, what's the catch",
    "how much is this gonna cost me",
    "I get all my work from referrals, don't need a website",
    "let me think about it and I'll get back to you",
    "I already have a website",
  ];

  return (
    <div className="rounded-2xl border border-line bg-surface">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-soft">Texting</span>
          <select
            value={siteId}
            onChange={(e) => setSiteId(Number(e.target.value))}
            className="max-w-[15rem] rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
          >
            {prospects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.enriched ? "★ " : ""}
                {p.name}
                {p.city ? ` · ${p.city}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-soft">Model</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setTurns([])}
          className="ml-auto rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:text-ink"
        >
          Reset
        </button>
      </div>

      {/* who the agent thinks it's talking to */}
      {prospect ? (
        <div className="border-b border-line px-4 py-2 text-xs text-ink-soft">
          Agent knows: <span className="text-ink">{prospect.name}</span>
          {prospect.niche ? ` — ${prospect.niche}` : ""}
          {prospect.owner ? ` · owner ${prospect.owner}` : ""}
          {prospect.enriched ? " · has enrichment on file" : " · thin profile"}
        </div>
      ) : null}

      {/* transcript */}
      <div ref={scrollRef} className="max-h-[46vh] min-h-[16rem] space-y-3 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">
              You&apos;re the prospect. Send a text and the agent answers as ThinkBigJoe. Try one:
            </p>
            <div className="flex flex-wrap gap-2">
              {quick.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setDraft(q)}
                  className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft hover:border-brand hover:text-brand"
                >
                  {q.length > 42 ? q.slice(0, 40) + "…" : q}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.from === "them" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                t.from === "them"
                  ? "bg-brand text-white"
                  : "border border-line bg-surface text-ink"
              }`}
            >
              {t.text}
              {t.from === "us" && (t.model || t.ms) ? (
                <div className="mt-1 text-[10px] text-ink-soft opacity-70">
                  {t.model}
                  {t.ms ? ` · ${(t.ms / 1000).toFixed(1)}s` : ""}
                </div>
              ) : null}
            </div>
          </div>
        ))}

        {pending ? (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-line bg-surface px-3.5 py-2 text-sm text-ink-soft">typing…</div>
          </div>
        ) : null}
      </div>

      {error ? <div className="border-t border-line px-4 py-2 text-xs text-red-600">{error}</div> : null}

      {/* composer */}
      <div className="flex items-end gap-2 border-t border-line px-3 py-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Text the agent as the prospect…"
          className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || !draft.trim()}
          className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
