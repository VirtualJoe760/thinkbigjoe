"use client";

import { useCallback, useRef, useState, useTransition } from "react";

import {
  uploadContacts, removeContact, generateDraft, createBlankDraft, saveDraft, approveAndSend,
  setNewsletterPaused, syncGoogleContacts, reviseDraft, setBanner,
} from "./actions";
import { TiptapEditor } from "./tiptap-editor";

export type NewsletterBizPreview = {
  businessName: string;
  phone: string | null;
  place: string | null;
  siteUrl: string | null;
};

export type NewsletterView = {
  siteId: number;
  businessName: string;
  biz: NewsletterBizPreview;
  monthLabel: string;
  subscribed: number;
  totalContacts: number;
  contacts: { id: number; email: string; name: string | null; status: string }[];
  current: { id: number; subject: string; bodyHtml: string; bannerUrl: string | null; prompt: string | null; status: string } | null;
  history: { id: number; label: string; subject: string; sentAt: string | null; recipients: number }[];
};

const BRAND = "#2f6bff";

/**
 * Client mirror of `renderNewsletter` in src/lib/newsletter.ts — kept in sync so the live preview
 * shows the ACTUAL email the customer receives (branded shell, banner, call button, unsubscribe
 * footer), not raw body HTML. If you change the email shell there, change it here too.
 */
function previewHtml(biz: NewsletterBizPreview, bannerUrl: string | null, bodyHtml: string): string {
  const contact = [biz.phone, biz.place].filter(Boolean).join(" · ");
  const banner = bannerUrl
    ? `<img src="${bannerUrl}" alt="" style="display:block;width:100%;max-width:520px;height:auto;border-radius:14px;margin:0 0 14px;" />`
    : "";
  const body = bodyHtml.replace(/<img\b(?![^>]*\bstyle=)([^>]*?)\/?>/gi,
    (_m, a) => `<img${a} style="max-width:100%;height:auto;display:block;margin:14px 0;border-radius:10px;" />`);
  return `
  <div style="background:#f5f7fb;font-family:Helvetica,Arial,sans-serif;color:#0a0a0b;padding:22px 16px;">
    <div style="max-width:520px;margin:0 auto;">
      ${banner}
      <div style="font-size:20px;font-weight:800;letter-spacing:-0.3px;">${escapeHtml(biz.businessName)}</div>
      <div style="margin-top:14px;background:#fff;border:1px solid #e6e9ef;border-radius:14px;padding:22px;line-height:1.55;font-size:14px;">
        ${body}
        ${biz.phone ? `<p style="margin-top:20px;"><span style="display:inline-block;background:${BRAND};color:#fff;font-weight:600;padding:10px 18px;border-radius:999px;">Call us: ${escapeHtml(biz.phone)}</span></p>` : ""}
      </div>
      <p style="margin-top:16px;font-size:11px;color:#9aa0ad;text-align:center;line-height:1.6;">
        ${escapeHtml(biz.businessName)}${contact ? ` · ${escapeHtml(contact)}` : ""}<br/>
        You're receiving this because you're a customer of ${escapeHtml(biz.businessName)}.<br/>
        <span style="color:#9aa0ad;text-decoration:underline;">Unsubscribe</span>${biz.siteUrl ? ` · <span style="color:#9aa0ad;text-decoration:underline;">Visit our site</span>` : ""}
      </p>
    </div>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Full HTML document for the preview iframe — mobile viewport so it renders like a phone inbox. */
function previewDoc(biz: NewsletterBizPreview, bannerUrl: string | null, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style>html,body{margin:0;padding:0;background:#f5f7fb;}img{max-width:100%;}</style></head>` +
    `<body>${previewHtml(biz, bannerUrl, bodyHtml)}</body></html>`;
}

/**
 * A phone mockup that renders the ACTUAL email inside an isolated iframe — so the client sees exactly
 * how it looks on a phone (where most email is read), with the email's own CSS sandboxed away from
 * the portal. The iframe re-renders whenever the body/banner change (React swaps srcDoc).
 */
function MobilePreview({ biz, bannerUrl, bodyHtml }: { biz: NewsletterBizPreview; bannerUrl: string | null; bodyHtml: string }) {
  return (
    <div className="mx-auto w-full max-w-[330px]">
      <div className="rounded-[2.5rem] border-[11px] border-neutral-800 bg-neutral-800 shadow-xl">
        <div className="relative overflow-hidden rounded-[1.7rem] bg-white">
          <div className="pointer-events-none absolute left-1/2 top-0 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-neutral-800" />
          <iframe
            title="Mobile email preview"
            srcDoc={previewDoc(biz, bannerUrl, bodyHtml)}
            className="block h-[600px] w-full border-0"
          />
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-ink-soft">Preview — what your customers see on their phone</p>
    </div>
  );
}

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

  // ── draft state ──
  // Held in client state (not read from props) so that creating/redrafting a draft within the
  // session updates the editor immediately — a server-action revalidate re-renders with new props
  // but does NOT re-run useState initializers, so props alone would leave these stale.
  const [nlId, setNlId] = useState<number | null>(view.current?.id ?? null);
  const [status, setStatus] = useState<string | null>(view.current?.status ?? null);
  const [subject, setSubject] = useState(view.current?.subject ?? "");
  const [body, setBody] = useState(view.current?.bodyHtml ?? "");
  const [banner, setBannerUrl] = useState<string | null>(view.current?.bannerUrl ?? null);
  const [prompt, setPrompt] = useState(view.current?.prompt ?? "");
  const [aiInstruction, setAiInstruction] = useState("");
  const [editorMsg, setEditorMsg] = useState<string | null>(null);
  const alreadySent = status === "sent";
  const paused = status === "cancelled";

  // Bump this to make the TipTap editor re-seed its content (after AI generate/revise).
  const [editorKey, setEditorKey] = useState(0);
  const reseedEditor = (html: string) => { setBody(html); setEditorKey((k) => k + 1); };

  const adoptDraft = (r: { id?: number; subject?: string; html?: string; bannerUrl?: string | null }) => {
    if (r.id) setNlId(r.id);
    setStatus("draft");
    if (typeof r.subject === "string") setSubject(r.subject);
    if (typeof r.html === "string") reseedEditor(r.html);
    if (r.bannerUrl !== undefined) setBannerUrl(r.bannerUrl);
  };

  const doGenerate = () =>
    start(async () => {
      setEditorMsg(null);
      const r = await generateDraft(view.siteId, prompt);
      if (r.ok) adoptDraft(r);
      else setEditorMsg(r.message || "Couldn't draft right now.");
    });

  const doBlank = () =>
    start(async () => {
      setEditorMsg(null);
      const r = await createBlankDraft(view.siteId);
      if (r.ok) adoptDraft(r);
      else setEditorMsg(r.message || null);
    });

  const doSave = () => {
    if (!nlId) return;
    start(async () => {
      await saveDraft(view.siteId, nlId, subject, body);
      setEditorMsg("Saved.");
    });
  };

  const doRevise = () => {
    if (!nlId || !aiInstruction.trim()) return;
    start(async () => {
      setEditorMsg("Revising…");
      const r = await reviseDraft(view.siteId, nlId, aiInstruction, body);
      if (r.ok && r.html) { reseedEditor(r.html); setAiInstruction(""); setEditorMsg("Updated by AI ✨"); }
      else setEditorMsg(r.message || "Couldn't revise right now.");
    });
  };

  const doSend = () => {
    if (!nlId) return;
    if (!confirm(`Send this newsletter to ${view.subscribed} customer${view.subscribed === 1 ? "" : "s"}?`)) return;
    start(async () => {
      setEditorMsg(null);
      const r = await approveAndSend(view.siteId, nlId, subject, body);
      if (r.ok) setStatus("sent");
      setEditorMsg(r.message || (r.ok ? "Sent!" : "Couldn't send."));
    });
  };

  const doPause = (next: boolean) =>
    start(async () => {
      setEditorMsg(null);
      const r = await setNewsletterPaused(view.siteId, nlId!, next);
      if (r.ok) setStatus(next ? "cancelled" : "draft");
      setEditorMsg(r.message || null);
    });

  // ── image uploads ──
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [bannerUploading, setBannerUploading] = useState(false);

  const uploadFile = useCallback(async (file: File, kind: "banner" | "inline"): Promise<string | null> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("siteId", String(view.siteId));
    fd.append("kind", kind);
    const res = await fetch("/api/newsletter/upload", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) { setEditorMsg(j?.message || "Upload failed."); return null; }
    return j.url as string;
  }, [view.siteId]);

  // Inline images inside the editor: TipTap calls this, then inserts the returned URL itself.
  const uploadInlineImage = useCallback((file: File) => uploadFile(file, "inline"), [uploadFile]);

  const onBannerFile = (f: File | null) => {
    if (!f || !nlId) return;
    setBannerUploading(true); setEditorMsg(null);
    start(async () => {
      const url = await uploadFile(f, "banner");
      if (url) { setBannerUrl(url); await setBanner(view.siteId, nlId, url); }
      setBannerUploading(false);
    });
  };
  const removeBanner = () => {
    if (!nlId) return;
    setBannerUrl(null);
    start(async () => { await setBanner(view.siteId, nlId, null); });
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Monthly Newsletter</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Stay top of mind with your customers. Draft a note for {view.businessName} with AI, make it your own, add
          photos — and preview exactly what lands in their inbox before you send.
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

        {nlId && !alreadySent && (
          <div className={`mt-2 rounded-xl border px-3 py-2 text-xs ${paused ? "border-amber-200 bg-amber-50 text-amber-800" : "border-sky-200 bg-sky-50 text-sky-800"}`}>
            {paused
              ? "⏸ Paused — this month's newsletter won't send automatically. Resume it below to put it back on schedule."
              : "📅 This sends automatically on the 15th at 12:00 PM Pacific. Edit it below anytime before then — or send it now, or pause this month."}
          </div>
        )}

        {/* Prompt + entry (always available until sent) */}
        {!alreadySent && (
          <div className="mt-3 rounded-xl border border-brand/30 bg-brand-tint/30 p-3">
            <label className="block text-xs font-semibold text-ink">
              {nlId ? "Steer the AI — what should this newsletter be about?" : "What should this newsletter be about? (optional)"}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="e.g. Announce our spring gutter-cleaning special — we're booking now. Warm, not pushy."
              className="mt-1 w-full resize-y rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={doGenerate} disabled={pending} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
                {pending ? "Writing…" : nlId ? "↻ Re-draft with AI" : "✨ Draft this newsletter"}
              </button>
              {!nlId && (
                <button onClick={doBlank} disabled={pending} className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-50">
                  Start from scratch
                </button>
              )}
            </div>
          </div>
        )}

        {nlId && (
          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ink-soft">Subject</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={alreadySent} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-60" />
            </div>

            {/* Banner */}
            <div>
              <label className="block text-xs font-semibold text-ink-soft">Banner image <span className="font-normal">(optional — shows across the top)</span></label>
              <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { onBannerFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
              {banner ? (
                <div className="mt-1 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={banner} alt="Banner" className="h-16 w-28 rounded-lg border border-line object-cover" />
                  <button onClick={() => bannerInputRef.current?.click()} disabled={alreadySent || pending} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface disabled:opacity-50">Replace</button>
                  <button onClick={removeBanner} disabled={alreadySent || pending} className="text-xs text-ink-soft hover:text-rose-600 disabled:opacity-50">Remove</button>
                </div>
              ) : (
                <button onClick={() => bannerInputRef.current?.click()} disabled={alreadySent || bannerUploading} className="mt-1 rounded-xl border border-dashed border-line px-4 py-3 text-sm text-ink-soft hover:border-brand hover:text-brand disabled:opacity-50">
                  {bannerUploading ? "Uploading…" : "＋ Add a banner image"}
                </button>
              )}
            </div>

            {/* Editor + mobile preview */}
            <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
              <div className="min-w-0">
                <label className="block text-xs font-semibold text-ink-soft">Message</label>
                {alreadySent ? (
                  <div className="prose prose-sm mt-1 max-w-none rounded-xl border border-line bg-surface p-3" dangerouslySetInnerHTML={{ __html: body }} />
                ) : (
                  <div className="mt-1">
                    <TiptapEditor
                      resetKey={editorKey}
                      initialHtml={body}
                      onChange={setBody}
                      onUploadImage={uploadInlineImage}
                    />
                  </div>
                )}
              </div>

              <div className="lg:sticky lg:top-4 lg:self-start">
                <MobilePreview biz={view.biz} bannerUrl={banner} bodyHtml={body} />
              </div>
            </div>

            {/* AI co-edit */}
            {!alreadySent && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                <label className="block text-xs font-semibold text-violet-900">✨ Ask AI to change it</label>
                <div className="mt-1 flex flex-wrap gap-2">
                  <input
                    value={aiInstruction}
                    onChange={(e) => setAiInstruction(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doRevise(); } }}
                    placeholder="e.g. shorten the intro, add a line about our winter hours, warmer tone"
                    className="min-w-0 flex-1 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500"
                  />
                  <button onClick={doRevise} disabled={pending || !aiInstruction.trim()} className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                    {pending ? "Working…" : "Apply"}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-violet-700">AI edits your current draft — it keeps your images and edits, just changes what you ask for.</p>
              </div>
            )}

            {!alreadySent && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button onClick={doSend} disabled={pending || view.subscribed === 0} className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
                  {pending ? "Working…" : `Approve & send to ${view.subscribed}`}
                </button>
                <button onClick={doSave} disabled={pending} className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-50">Save draft</button>
                <button onClick={() => doPause(!paused)} disabled={pending} className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-ink-soft hover:bg-surface disabled:opacity-50">
                  {paused ? "▶ Resume auto-send" : "⏸ Pause this month"}
                </button>
                {view.subscribed === 0 && <span className="text-xs text-amber-700">Add customers above before sending.</span>}
                {editorMsg && <span className="text-xs text-ink-soft">{editorMsg}</span>}
              </div>
            )}
            {alreadySent && editorMsg && <span className="text-xs text-ink-soft">{editorMsg}</span>}
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
