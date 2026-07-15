"use client";

import { useRef, useState, useTransition } from "react";

import { uploadContacts, removeContact, generateDraft, saveDraft, approveAndSend, setNewsletterPaused, syncGoogleContacts } from "./actions";

export type NewsletterView = {
  siteId: number;
  businessName: string;
  monthLabel: string;
  subscribed: number;
  totalContacts: number;
  contacts: { id: number; email: string; name: string | null; status: string }[];
  current: { id: number; subject: string; bodyHtml: string; prompt: string | null; status: string } | null;
  history: { id: number; label: string; subject: string; sentAt: string | null; recipients: number }[];
};

export function NewsletterClient({ view }: { view: NewsletterView }) {
  const [pending, start] = useTransition();

  // ── list upload ──
  const [paste, setPaste] = useState("");
  const [listMsg, setListMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addContacts = (raw: string) => {
    if (!raw.trim()) return;
    start(async () => {
      const r = await uploadContacts(view.siteId, raw);
      setListMsg(r.message || (r.ok ? "Added." : "Couldn't add those."));
      if (r.ok) setPaste("");
    });
  };
  const onFile = (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => addContacts(String(reader.result || ""));
    reader.readAsText(f);
  };

  // ── draft editor ──
  const [subject, setSubject] = useState(view.current?.subject ?? "");
  const [body, setBody] = useState(view.current?.bodyHtml ?? "");
  const [prompt, setPrompt] = useState(view.current?.prompt ?? "");
  const [editorMsg, setEditorMsg] = useState<string | null>(null);
  const alreadySent = view.current?.status === "sent";
  const paused = view.current?.status === "cancelled";
  const doPause = (next: boolean) =>
    start(async () => {
      setEditorMsg(null);
      const r = await setNewsletterPaused(view.siteId, view.current!.id, next);
      setEditorMsg(r.message || null);
    });

  const doGenerate = () =>
    start(async () => {
      setEditorMsg(null);
      const r = await generateDraft(view.siteId, prompt);
      if (!r.ok) setEditorMsg(r.message || "Couldn't draft right now.");
      // page revalidates with the new draft; reflect it locally too on next load
    });

  const doSave = () => {
    if (!view.current) return;
    start(async () => {
      await saveDraft(view.siteId, view.current!.id, subject, body);
      setEditorMsg("Saved.");
    });
  };

  const doSend = () => {
    if (!view.current) return;
    if (!confirm(`Send this newsletter to ${view.subscribed} customer${view.subscribed === 1 ? "" : "s"}?`)) return;
    start(async () => {
      setEditorMsg(null);
      const r = await approveAndSend(view.siteId, view.current!.id, subject, body);
      setEditorMsg(r.message || (r.ok ? "Sent!" : "Couldn't send."));
    });
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Monthly Newsletter</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Stay top of mind with your customers. We draft a friendly monthly note for {view.businessName} — you review it and send it to your list.
        </p>
      </header>

      {/* ── Your customer list ── */}
      <section className="rounded-2xl border border-line bg-background p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">Your customers</h2>
          <span className="text-sm text-ink-soft">
            <span className="font-semibold text-ink">{view.subscribed}</span> subscribed
            {view.totalContacts > view.subscribed ? ` · ${view.totalContacts - view.subscribed} unsubscribed` : ""}
          </span>
        </div>
        <p className="mt-1 text-xs text-ink-soft">Upload a CSV or paste emails (one per line, or “email, name”). Only add customers who agreed to hear from you.</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          <button onClick={() => fileRef.current?.click()} disabled={pending} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
            ⬆︎ Upload CSV
          </button>
          <button
            onClick={() => start(async () => { setListMsg(null); const r = await syncGoogleContacts(view.siteId); setListMsg(r.message || null); })}
            disabled={pending}
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-50"
          >
            ⟳ Sync Google Contacts
          </button>
          <span className="text-xs text-ink-soft">or paste below</span>
        </div>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={3}
          placeholder={"jane@example.com, Jane\njohn@example.com"}
          className="mt-2 w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <div className="mt-2 flex items-center gap-3">
          <button onClick={() => addContacts(paste)} disabled={pending || !paste.trim()} className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-50">
            Add these
          </button>
          {listMsg && <span className="text-xs text-ink-soft">{listMsg}</span>}
        </div>

        {view.contacts.length > 0 && (
          <div className="mt-4 max-h-52 overflow-y-auto rounded-xl border border-line">
            {view.contacts.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-sm last:border-b-0">
                <span className="min-w-0 flex-1 truncate">
                  {c.name ? <span className="font-medium">{c.name}</span> : null} <span className="text-ink-soft">{c.email}</span>
                  {c.status !== "subscribed" && <span className="ml-1 text-[11px] font-semibold text-rose-600">unsubscribed</span>}
                </span>
                <button onClick={() => start(async () => { await removeContact(view.siteId, c.id); })} className="shrink-0 text-xs text-ink-soft hover:text-rose-600">
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── This month's newsletter ── */}
      <section className="rounded-2xl border border-line bg-background p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">{view.monthLabel} newsletter</h2>
          {alreadySent && <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Sent ✓</span>}
          {paused && <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Paused</span>}
        </div>

        {view.current && !alreadySent && (
          <div className={`mt-2 rounded-xl border px-3 py-2 text-xs ${paused ? "border-amber-200 bg-amber-50 text-amber-800" : "border-sky-200 bg-sky-50 text-sky-800"}`}>
            {paused
              ? "⏸ Paused — this month's newsletter won't send automatically. Resume it below to put it back on schedule."
              : "📅 This sends automatically on the 15th at 12:00 PM Pacific. Review and edit it below anytime before then — or send it now, or pause this month."}
          </div>
        )}

        {!view.current ? (
          <div className="mt-3">
            <p className="text-sm text-ink-soft">
              Tell the AI what to write about — a special, a seasonal note, an update — and it drafts the whole
              email. Leave it blank for a friendly monthly check-in. You review and edit before anything sends.
            </p>
            <label className="mt-3 block text-xs font-semibold text-ink-soft">What should this newsletter be about? (optional)</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="e.g. Announce our spring gutter-cleaning special — we're booking now. Warm, not pushy."
              className="mt-1 w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <button onClick={doGenerate} disabled={pending} className="mt-3 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
              {pending ? "Writing…" : "✨ Draft this newsletter"}
            </button>
            {editorMsg && <p className="mt-2 text-xs text-ink-soft">{editorMsg}</p>}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {!alreadySent && (
              <div className="rounded-xl border border-brand/30 bg-brand-tint/30 p-3">
                <label className="block text-xs font-semibold text-ink">Steer the AI — what should this newsletter be about?</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={2}
                  placeholder="e.g. Thank customers for a great year, mention we're closed Dec 25, wish them happy holidays."
                  className="mt-1 w-full resize-y rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-brand"
                />
                <p className="mt-1 text-[11px] text-ink-soft">Edit this and hit “Re-draft with AI” to rewrite the message below.</p>
              </div>
            )}

            <label className="block text-xs font-semibold text-ink-soft">Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={alreadySent} className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-60" />

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-ink-soft">Message</label>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={alreadySent} rows={12} className="mt-1 w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-brand disabled:opacity-60" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-soft">Preview</label>
                <div className="prose-sm mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface p-3 text-sm leading-relaxed [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-bold [&_li]:ml-4 [&_li]:list-disc [&_p]:my-2" dangerouslySetInnerHTML={{ __html: body }} />
              </div>
            </div>

            {!alreadySent && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button onClick={doSend} disabled={pending || view.subscribed === 0} className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
                  {pending ? "Working…" : `Approve & send to ${view.subscribed}`}
                </button>
                <button onClick={doSave} disabled={pending} className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-50">Save draft</button>
                <button onClick={doGenerate} disabled={pending} className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-50">↻ Re-draft with AI</button>
                <button onClick={() => doPause(!paused)} disabled={pending} className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-ink-soft hover:bg-surface disabled:opacity-50">
                  {paused ? "▶ Resume auto-send" : "⏸ Pause this month"}
                </button>
                {view.subscribed === 0 && <span className="text-xs text-amber-700">Add customers above before sending.</span>}
                {editorMsg && <span className="text-xs text-ink-soft">{editorMsg}</span>}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── History ── */}
      {view.history.length > 0 && (
        <section>
          <h2 className="text-base font-bold">Sent</h2>
          <div className="mt-2 space-y-1.5">
            {view.history.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate"><span className="font-medium">{h.label}</span> <span className="text-ink-soft">— {h.subject}</span></span>
                <span className="shrink-0 text-xs text-ink-soft">{h.recipients} sent</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
