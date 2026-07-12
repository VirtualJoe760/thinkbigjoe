"use client";

import { useMemo, useRef, useState, useTransition, useEffect } from "react";
import Link from "next/link";

import { sendConversationMessage, renameContact } from "../actions";

export type Msg = { dir: "in" | "out"; text: string; at: string; via?: string };
export type Conversation = {
  siteId: number;
  businessName: string;
  customName: boolean;
  phone: string;
  city: string;
  niche: string;
  rating: string;
  reviews: string;
  claimCode: string;
  status: "active" | "opted_out" | "claimed";
  messages: Msg[];
  lastText: string;
  lastAt: string;
  lastDir: "in" | "out";
  needsReply: boolean;
};

function initials(name: string): string {
  const words = (name || "?").split(/\s+/).filter(Boolean).slice(0, 2);
  const firstChar = (w: string) => {
    const chars = Array.from(w);
    return (chars.find((c) => /\p{L}|\p{N}/u.test(c)) || chars[0] || "").toUpperCase();
  };
  return words.map(firstChar).join("") || "?";
}

function relTime(iso: string): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const VIA_LABEL: Record<string, string> = { agent: "🤖 AI", manual: "You", outreach: "First touch" };

export function MessagesClient({ conversations }: { conversations: Conversation[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    if (!needle) return conversations;
    return conversations.filter((c) => {
      const text = [c.businessName, c.city, c.niche, c.lastText].filter(Boolean).some((v) => v.toLowerCase().includes(needle));
      const phone = digits.length >= 3 && c.phone.replace(/\D/g, "").includes(digits);
      return text || phone;
    });
  }, [conversations, q]);

  const open = conversations.find((c) => c.siteId === openId) || null;
  const needsReplyCount = conversations.filter((c) => c.needsReply).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Page header — hidden on mobile while a thread is open, so the thread goes full-screen */}
      <div className={`shrink-0 px-4 pt-5 pb-3 sm:px-6 ${open ? "hidden md:block" : "block"}`}>
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight">Messages</h1>
            <p className="mt-0.5 text-sm text-ink-soft">
              Every text conversation with your contacts — the AI&apos;s replies included. Jump in anytime.
            </p>
          </div>
          {needsReplyCount > 0 && (
            <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
              {needsReplyCount} awaiting reply
            </span>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden border-t border-line md:mx-6 md:mb-6 md:rounded-2xl md:border md:grid-cols-[340px_1fr]">
        {/* Conversation list */}
        <div className={`flex min-h-0 flex-col border-line md:border-r ${open ? "hidden md:flex" : "flex"}`}>
          <div className="shrink-0 border-b border-line p-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search contacts…"
              className="w-full rounded-full border border-line bg-surface px-4 py-2.5 text-base text-ink outline-none placeholder:text-ink-soft focus:border-brand sm:text-sm"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-ink-soft">No conversations yet.</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.siteId}
                  onClick={() => setOpenId(c.siteId)}
                  className={`flex w-full items-center gap-3 border-b border-line px-3 py-3.5 text-left transition-colors active:bg-surface hover:bg-surface ${
                    openId === c.siteId ? "bg-brand-tint/40" : ""
                  }`}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand">
                    {initials(c.businessName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-ink">{c.businessName}</span>
                      <span className="shrink-0 text-[11px] text-ink-soft" suppressHydrationWarning>{relTime(c.lastAt)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span className="truncate text-xs text-ink-soft">
                        {c.lastDir === "out" ? "You: " : ""}
                        {c.lastText}
                      </span>
                    </span>
                  </span>
                  {c.needsReply ? (
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" title="Awaiting your reply" />
                  ) : c.status === "opted_out" ? (
                    <span className="shrink-0 text-[11px] font-semibold text-rose-600">STOP</span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Thread */}
        <div className={`min-h-0 flex-col ${open ? "flex" : "hidden md:flex"}`}>
          {open ? (
            <Thread key={open.siteId} c={open} onBack={() => setOpenId(null)} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-ink-soft">
              Select a conversation to view the thread.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Thread({ c, onBack }: { c: Conversation; onBack: () => void }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Editable contact name (works for any number, incl. ones with no matching business).
  const [name, setName] = useState(c.businessName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.businessName);
  const [savingName, saveNameTransition] = useTransition();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [c.messages.length]);

  const send = () => {
    const body = text.trim();
    if (!body || pending) return;
    setError(null);
    start(async () => {
      const r = await sendConversationMessage(String(c.siteId), body);
      if (r.ok) setText("");
      else setError(r.message || "Couldn't send.");
    });
  };

  const saveName = () => {
    const next = draft.trim();
    saveNameTransition(async () => {
      const r = await renameContact(c.phone, next);
      if (r.ok) {
        setName(next || c.businessName);
        setEditing(false);
      }
    });
  };

  return (
    <>
      {/* header */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-background px-3 py-2.5">
        <button onClick={onBack} className="-ml-1 rounded-full p-2 text-ink-soft active:bg-surface hover:bg-surface md:hidden" aria-label="Back">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">{initials(name)}</span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveName();
              }}
              className="flex items-center gap-1.5"
            >
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditing(false);
                }}
                placeholder="Contact name"
                className="min-w-0 flex-1 rounded-lg border border-brand bg-surface px-2 py-1 text-sm font-semibold text-ink outline-none"
              />
              <button type="submit" disabled={savingName} className="shrink-0 rounded-lg bg-brand px-2 py-1 text-xs font-semibold text-white disabled:opacity-40" aria-label="Save name">Save</button>
              <button type="button" onClick={() => setEditing(false)} className="shrink-0 rounded-lg px-1.5 py-1 text-xs text-ink-soft hover:bg-surface" aria-label="Cancel">✕</button>
            </form>
          ) : (
            <button
              onClick={() => {
                setDraft(name);
                setEditing(true);
              }}
              className="group flex max-w-full items-center gap-1.5 text-left"
              title="Rename contact"
            >
              <span className="truncate text-sm font-bold text-ink">{name}</span>
              <svg className="shrink-0 text-ink-soft opacity-0 transition-opacity group-hover:opacity-100" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
            </button>
          )}
          {!editing && (
            <div className="truncate text-[11px] text-ink-soft">
              {c.phone}
              {c.rating ? ` · ${Number(c.rating).toFixed(1)}★${c.reviews ? ` (${c.reviews})` : ""}` : ""}
              {c.status === "opted_out" ? " · opted out" : c.status === "claimed" ? " · claimed ✓" : ""}
            </div>
          )}
        </div>
        <Link href="/command/leads" className="shrink-0 rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand-tint/40">
          Lead ↗
        </Link>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain bg-surface/40 p-3">
        {c.messages.map((m, i) => {
          const out = m.dir === "out";
          const viaLabel = out && m.via ? VIA_LABEL[m.via] : null;
          return (
            <div key={i} className={`flex flex-col ${out ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-snug ${
                  out ? "rounded-br-md bg-brand text-white" : "rounded-bl-md bg-ink text-white"
                }`}
              >
                {m.text}
              </div>
              <div className="mt-0.5 px-1 text-[10px] text-ink-soft" suppressHydrationWarning>
                {viaLabel ? `${viaLabel} · ` : ""}
                {clockTime(m.at)}
              </div>
            </div>
          );
        })}
      </div>

      {/* compose */}
      {c.status === "opted_out" ? (
        <div className="shrink-0 border-t border-line bg-rose-50 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-xs font-medium text-rose-700">
          🛑 This contact opted out — texting is disabled.
        </div>
      ) : (
        <div className="shrink-0 border-t border-line bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {error && <p className="mb-1.5 text-[11px] text-rose-600">{error}</p>}
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Type a message…"
              className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-line bg-surface px-4 py-2.5 text-base text-ink outline-none placeholder:text-ink-soft focus:border-brand sm:text-sm"
            />
            <button
              onClick={send}
              disabled={pending || !text.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white transition-colors hover:bg-brand-dark disabled:opacity-40"
              aria-label="Send"
            >
              {pending ? (
                <svg width="18" height="18" viewBox="0 0 24 24" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-6.2-8.5" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></svg>
              )}
            </button>
          </div>
          <p className="mt-1 px-1 text-[10px] text-ink-soft">The AI answers automatically — send here only to jump in yourself.</p>
        </div>
      )}
    </>
  );
}
