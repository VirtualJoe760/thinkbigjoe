"use client";

import { useMemo, useRef, useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { sendConversationMessage, renameContact, setContactAiPaused } from "../actions";

// Curved-edge phones (Galaxy Note 10 et al) bend the last few px of the screen, so an
// outbound bubble flush to the right gutter is genuinely hard to read. The conversation
// pane is full-bleed on mobile, so give it a wider right gutter there; at `md` it sits
// inside an inset rounded card (md:mx-6) and can go back to the normal 12px.
// Android reports safe-area-inset-right: 0 on these screens, so the floor does the work.
const EDGE_RIGHT = "pr-[max(1.25rem,env(safe-area-inset-right))] md:pr-3";

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
  aiPaused: boolean;
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
  // `?site=<id>` opens a thread directly — that's how the lead call room links in here, and
  // how the thread's "Lead" button can round-trip back. replace() (not push) so Back closes
  // the thread instead of walking through every conversation you tapped.
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const siteParam = Number(params.get("site")) || null;

  const [openId, setOpenId] = useState<number | null>(siteParam);
  useEffect(() => { setOpenId(siteParam); }, [siteParam]);

  const openThread = (id: number | null) => {
    setOpenId(id);
    router.replace(id ? `${pathname}?site=${id}` : pathname, { scroll: false });
  };
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
        <div className={`flex min-h-0 min-w-0 flex-col border-line md:border-r ${open ? "hidden md:flex" : "flex"}`}>
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
                  onClick={() => openThread(c.siteId)}
                  className={`flex w-full items-center gap-3 border-b border-line px-3 py-3.5 text-left transition-colors active:bg-surface hover:bg-surface ${
                    openId === c.siteId ? "bg-brand-tint/40" : ""
                  }`}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand">
                    {initials(c.businessName)}
                  </span>
                  {/* min-w-0 on every level: a flex child won't shrink below its content unless
                      its min-width is 0, which is what let the preview text push the timestamp
                      and status dot off the row. */}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{c.businessName}</span>
                      <span
                        className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-ink-soft"
                        suppressHydrationWarning
                        title={c.lastAt ? new Date(c.lastAt).toLocaleString() : ""}
                      >
                        {relTime(c.lastAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">
                        {c.lastDir === "out" ? "You: " : ""}
                        {c.lastText}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {c.aiPaused && c.status !== "opted_out" && (
                          <span className="text-[11px] leading-none" title="AI paused on this contact">⏸️</span>
                        )}
                        {c.needsReply ? (
                          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" title="Awaiting your reply" />
                        ) : c.status === "opted_out" ? (
                          <span className="text-[11px] font-semibold text-rose-600">STOP</span>
                        ) : null}
                      </span>
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Thread */}
        {/* min-w-0: grid items default to min-width:auto, so without this the column can't
            shrink below the header row's min-content width (avatar + name + pills) and the
            whole thread — bubbles included — lays out wider than a phone viewport and gets
            clipped by the overflow-hidden above. */}
        <div className={`min-h-0 min-w-0 flex-col ${open ? "flex" : "hidden md:flex"}`}>
          {open ? (
            <Thread key={open.siteId} c={open} onBack={() => openThread(null)} />
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

  // Per-contact AI pause — when on, the inbound webhook won't auto-reply to this contact.
  const [paused, setPaused] = useState(c.aiPaused);
  const [togglingAi, toggleAiTransition] = useTransition();
  const toggleAi = () => {
    const next = !paused;
    setPaused(next); // optimistic
    toggleAiTransition(async () => {
      const r = await setContactAiPaused(String(c.siteId), next);
      if (!r.ok) setPaused(!next); // revert on failure
    });
  };

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
      <div className={`flex shrink-0 items-center gap-2.5 border-b border-line bg-background pl-3 py-2.5 ${EDGE_RIGHT}`}>
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
        {c.status !== "opted_out" && (
          <button
            onClick={toggleAi}
            disabled={togglingAi}
            title={paused ? "AI is paused — tap to let it auto-reply again" : "AI is answering — tap to pause and handle this contact yourself"}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
              paused
                ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${paused ? "bg-amber-500" : "bg-emerald-500"}`} />
            {paused ? "AI paused" : "AI on"}
          </button>
        )}
        {/* Deep-links to THIS contact's call room (?site=), not the leads list — so you can go
            thread → lead → thread without hunting for the row again. */}
        <Link
          href={`/command/leads?site=${c.siteId}`}
          className="shrink-0 rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand-tint/40"
          title={`Open ${c.businessName} in the call room`}
        >
          Lead ↗
        </Link>
      </div>

      {/* messages */}
      <div ref={scrollRef} className={`min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain bg-surface/40 py-3 pl-3 ${EDGE_RIGHT}`}>
        {c.messages.map((m, i) => {
          const out = m.dir === "out";
          const viaLabel = out && m.via ? VIA_LABEL[m.via] : null;
          return (
            <div key={i} className={`flex flex-col ${out ? "items-end" : "items-start"}`}>
              <div
                // break-words: whitespace-pre-wrap alone only breaks at spaces/hyphens, so a long
                // URL with no break opportunity paints outside the bubble instead of wrapping.
                className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-snug ${
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
        <div className={`shrink-0 border-t border-line bg-background pt-3 pl-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${EDGE_RIGHT}`}>
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
          <p className="mt-1 px-1 text-[10px] text-ink-soft">
            {paused
              ? "⏸️ AI is paused on this contact — replies only go out when you send them."
              : "The AI answers automatically — send here only to jump in yourself."}
          </p>
        </div>
      )}
    </>
  );
}
