import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { db, newsletters, newsletterContacts, forgeSites } from "@/db";

/**
 * The $99-plan monthly newsletter: our AI drafts a warm, on-brand note for each client's business,
 * the client approves it in their portal, and we send it to the customer list they uploaded — so
 * their existing customers stay top of mind. Sending reuses our SMTP transport (Zoho) for now, so
 * there's no added cost; the transport is swappable (e.g. Amazon SES) when volume grows.
 */
const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
const MODEL = process.env.GEMINI_NEWSLETTER_MODEL || "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com").replace(/\/+$/, "");
const BRAND = "#2f6bff";

export type NewsletterBiz = {
  id: number;
  businessName: string;
  niche: string | null;
  city: string | null;
  serviceArea: string | null;
  phone: string | null;
  liveUrl: string | null;
  slug: string | null;
};

export function newsletterToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** "YYYY-MM" for the current month (a newsletter's period key) + a human label. */
export function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function bizSiteUrl(b: NewsletterBiz): string | null {
  if (b.liveUrl && b.liveUrl.trim()) return /^https?:\/\//i.test(b.liveUrl) ? b.liveUrl : `https://${b.liveUrl}`;
  return b.slug ? `${SITE}/s/${b.slug}` : null;
}

/**
 * AI-draft a monthly newsletter for the business. Returns { subject, html } where html is simple
 * body markup (<h2>/<p>/<ul>) — the client reviews/edits before it ever sends. Null if unavailable.
 *
 * `userPrompt` (optional) is the owner's own steer — "announce our spring gutter-cleaning special",
 * "warm holiday thank-you, mention we're closed the 25th". It's woven in as the CONTENT direction
 * while the guardrails (voice, length, opt-in tone, HTML-only output) stay fixed so a client can't
 * accidentally produce a spammy or malformed email. Mirrors chatRealty's Groq "Generate" panel:
 * free-text topic → structured draft that fills the form.
 */
export async function draftNewsletter(
  b: NewsletterBiz,
  label: string,
  userPrompt?: string,
): Promise<{ subject: string; html: string } | null> {
  if (!KEY) return null;
  const place = b.city || b.serviceArea || "";
  const steer = (userPrompt || "").trim().slice(0, 800);
  const direction = steer
    ? `The owner asked for this newsletter specifically: "${steer}". Build the newsletter around that — it is the main content. Keep it truthful to a ${b.niche || "local"} business; do not invent specific dates, prices, or offers the owner didn't state.`
    : `Content: a warm hello tied to the season/month, one helpful tip or update relevant to their trade, and a simple call to action (call them or stop by).`;
  const prompt = `Write a short, warm email newsletter that a local business sends to its EXISTING customers to stay top of mind.

Business: ${b.businessName}${b.niche ? ` — ${b.niche}` : ""}${place ? `, ${place}` : ""}.
Month: ${label}.

${direction}

Voice: genuine and friendly, like a quick note from the owner — NOT salesy, no hype. 2–3 short sections, under 200 words total.

Return "html" as clean email body HTML using only <h2>, <p>, and <ul>/<li> tags (no <html>, <head>, <style>, images, or inline styles). Return a compelling "subject" line under 55 characters, no emojis.`;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.85,
          // 2.5-flash spends "thinking" tokens from this budget, so keep it generous or the
          // JSON gets truncated mid-string (the newsletter body itself is only ~250 tokens).
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseSchema: { type: "OBJECT", properties: { subject: { type: "STRING" }, html: { type: "STRING" } }, required: ["subject", "html"] },
        },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => (typeof p.text === "string" ? p.text : "")).join("");
    const parsed = JSON.parse(text);
    if (!parsed?.subject || !parsed?.html) return null;
    return { subject: String(parsed.subject).slice(0, 140), html: String(parsed.html) };
  } catch {
    return null;
  }
}

/**
 * AI co-edit: revise an EXISTING draft per the owner's instruction ("shorten the intro", "add a
 * section about our winter hours", "make it warmer"), instead of regenerating from scratch. The
 * current body is the source of truth — the model edits it and returns the full revised body. Any
 * <img> tags the owner inserted are preserved verbatim (their src URLs must not change). Returns the
 * new body HTML, or null if unavailable.
 */
export async function reviseNewsletter(
  b: NewsletterBiz,
  currentHtml: string,
  instruction: string,
): Promise<{ html: string } | null> {
  if (!KEY) return null;
  const steer = (instruction || "").trim().slice(0, 800);
  if (!steer) return null;
  const prompt = `You are editing an email newsletter for ${b.businessName}${b.niche ? ` (a ${b.niche} business)` : ""}.

Here is the CURRENT newsletter body (HTML):
"""
${currentHtml.slice(0, 6000)}
"""

The owner's instruction: "${steer}".

Apply that instruction and return the FULL revised body. Rules:
- Keep it truthful to the business; do not invent specific dates, prices, or offers not already present or requested.
- Preserve any <img ...> tags EXACTLY as they appear (same src) unless the instruction explicitly says to remove an image.
- Voice: genuine and friendly, like a note from the owner — not salesy. Keep it concise.
- Return "html" using only <h2>, <p>, <ul>/<li>, <a>, <strong>, and <img> tags (no <html>, <head>, <style>, or inline styles except on tags that already have them).`;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseSchema: { type: "OBJECT", properties: { html: { type: "STRING" } }, required: ["html"] },
        },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => (typeof p.text === "string" ? p.text : "")).join("");
    const parsed = JSON.parse(text);
    if (!parsed?.html) return null;
    return { html: String(parsed.html) };
  } catch {
    return null;
  }
}

/**
 * Force every inline <img> in the body to be email-safe: never wider than the column, auto height,
 * block-level with a little breathing room. Email clients ignore <style>, so this must be inline on
 * each tag. We only ADD to imgs that don't already declare a width/style so we never fight the
 * editor's own sizing. Kept deliberately simple (regex over trusted, self-authored HTML).
 */
function constrainInlineImages(html: string): string {
  return html.replace(/<img\b(?![^>]*\bstyle=)([^>]*?)\/?>/gi, (_m, attrs) =>
    `<img${attrs} style="max-width:100%;height:auto;display:block;margin:14px 0;border-radius:10px;" />`,
  );
}

/**
 * Wrap the body in a business-branded email shell + required unsubscribe footer (CAN-SPAM).
 * `bannerUrl` (optional) renders a full-width hero image above the message — the client's uploaded
 * banner. Inline images inside `bodyHtml` are made responsive so they never overflow the column.
 */
export function renderNewsletter(b: NewsletterBiz, bodyHtml: string, unsubscribeUrl: string, bannerUrl?: string | null): string {
  const site = bizSiteUrl(b);
  const contact = [b.phone, b.city || b.serviceArea].filter(Boolean).join(" · ");
  const banner = bannerUrl?.trim()
    ? `<img src="${bannerUrl}" alt="${b.businessName}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border-radius:16px;margin:0 0 16px;" />`
    : "";
  return `
  <div style="margin:0;padding:0;background:#f5f7fb;font-family:Helvetica,Arial,sans-serif;color:#0a0a0b;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      ${banner}
      <div style="font-size:22px;font-weight:800;letter-spacing:-0.3px;color:#0a0a0b;">${b.businessName}</div>
      <div style="margin-top:16px;background:#ffffff;border:1px solid #e6e9ef;border-radius:16px;padding:28px;line-height:1.55;font-size:15px;">
        ${constrainInlineImages(bodyHtml)}
        ${b.phone ? `<p style="margin-top:22px;"><a href="tel:${b.phone.replace(/[^0-9+]/g, "")}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:999px;">Call us: ${b.phone}</a></p>` : ""}
      </div>
      <p style="margin-top:20px;font-size:12px;color:#9aa0ad;text-align:center;line-height:1.6;">
        ${b.businessName}${contact ? ` · ${contact}` : ""}<br/>
        You're receiving this because you're a customer of ${b.businessName}.<br/>
        <a href="${unsubscribeUrl}" style="color:#9aa0ad;">Unsubscribe</a>${site ? ` · <a href="${site}" style="color:#9aa0ad;">Visit our site</a>` : ""}
      </p>
    </div>
  </div>`;
}

// NOTE: the old synchronous sendNewsletter() lived here. It's gone — sending is now the paced,
// resumable queue in `src/lib/newsletter-queue.ts` (enqueueNewsletter + sendNewsletterBatch), which
// scales to thousands without timing out and rides SES, not the Zoho mailbox. See docs/EMAIL_SCALE.md.

/** One-click unsubscribe by token. Returns the business name for the confirmation page. */
export async function unsubscribeByToken(token: string): Promise<{ ok: boolean; business?: string }> {
  if (!token) return { ok: false };
  const rows = (
    await db.execute(sql`
      UPDATE newsletter_contacts SET status = 'unsubscribed'
      WHERE unsubscribe_token = ${token} AND status <> 'unsubscribed'
      RETURNING site_id`)
  ).rows as Array<{ site_id: number }>;
  // Even if already unsubscribed, resolve the business for a friendly page.
  const [c] = await db.select({ siteId: newsletterContacts.siteId }).from(newsletterContacts).where(eq(newsletterContacts.unsubscribeToken, token)).limit(1);
  if (!c && rows.length === 0) return { ok: false };
  const siteId = rows[0]?.site_id ?? c?.siteId;
  const [biz] = siteId ? await db.select({ businessName: forgeSites.businessName }).from(forgeSites).where(eq(forgeSites.id, siteId)).limit(1) : [];
  return { ok: true, business: biz?.businessName };
}
