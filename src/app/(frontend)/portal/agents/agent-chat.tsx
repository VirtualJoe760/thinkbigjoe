"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { getAgentThread, sendAgentMessage, type AgentMsg } from "./org-actions";

/**
 * Chat panel for one OpenClaw agent. Messages queue in agent_messages; the Mac-side bridge
 * (scripts/agent-bridge.mjs, every minute) delivers them to the gateway and writes the reply
 * back — so a reply typically lands in 1–3 minutes. The panel polls while open.
 */
export function AgentChat({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<AgentMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const load = () => start(async () => {
      try {
        const t = await getAgentThread(agentId);
        if (live) setThread(t);
      } catch {
        /* transient — next poll retries */
      }
    });
    load();
    const iv = setInterval(load, 6000);
    return () => { live = false; clearInterval(iv); };
  }, [open, agentId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread.length]);

  function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    start(async () => {
      await sendAgentMessage(agentId, text);
      setThread(await getAgentThread(agentId));
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center justify-center rounded-full border border-line bg-background px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
      >
        💬 Message {agentName}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-background">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-xs font-semibold text-ink-soft">Chat with {agentName} · replies in ~1–3 min via the bridge</span>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-soft hover:text-ink">✕</button>
      </div>
      <div ref={scrollRef} className="max-h-64 min-h-[6rem] space-y-2 overflow-y-auto px-3 py-3">
        {thread.length === 0 && <p className="text-xs text-ink-soft">No messages yet — say something.</p>}
        {thread.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "to_agent" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-1.5 text-sm ${
                m.direction === "to_agent" ? "bg-brand text-white" : "border border-line bg-surface text-ink"
              }`}
            >
              {m.body}
              {m.direction === "to_agent" && m.status === "queued" && (
                <span className="ml-2 text-[10px] opacity-70">⏳ queued</span>
              )}
              {m.direction === "to_agent" && m.status === "failed" && (
                <span className="ml-2 text-[10px] opacity-90">⚠️ failed</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-end gap-2 border-t border-line px-2 py-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          rows={1}
          placeholder={`Message ${agentName}…`}
          className="max-h-24 min-h-[2.25rem] flex-1 resize-none rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || !draft.trim()}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
