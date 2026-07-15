# Monthly customer newsletter ($99 plan)

Part of the **$99 Website plan**: clients keep their own customers top of mind with an AI-drafted
monthly newsletter they compose + send from the portal — a small **newsletter studio** with rich
content, images, and AI co-editing.

## The three layers (full-stack rule)

1. **UI** — `/portal/newsletter` (`page.tsx` + `newsletter-client.tsx`). One-page studio:
   - **List** — upload the customer list (CSV/paste) or **Sync Google Contacts**.
   - **Compose** — AI-draft from a prompt (or **Start from scratch**), then edit in a lightweight
     **rich editor** (contentEditable: heading / bold / italic / list / link / image). A **banner
     image** shows across the top; **inline images** drop into the body at the cursor.
   - **AI co-edit** — an instruction box ("shorten the intro", "add our winter hours", "warmer
     tone") rewrites the *current* draft via `reviseDraft` → `reviseNewsletter()`, preserving the
     owner's edits + images instead of regenerating from scratch.
   - **Live preview** — a client-side mirror of `renderNewsletter` shows the **actual branded email**
     (banner, call button, unsubscribe footer) as you type. ⚠️ If you change the email shell in
     `src/lib/newsletter.ts`, change the `previewHtml()` mirror in `newsletter-client.tsx` too.
   - Server actions in `portal/newsletter/actions.ts` (all scoped to the caller's claimed site):
     `generateDraft`, `createBlankDraft`, `reviseDraft`, `saveDraft`, `setBanner`, `approveAndSend`,
     `setNewsletterPaused`, `uploadContacts`, `syncGoogleContacts`, `removeContact`.
2. **Engine** — `src/lib/newsletter.ts`: `draftNewsletter()` and `reviseNewsletter()` (Gemini
   `gemini-2.5-flash`, JSON out; note the **4096 output budget** so thinking tokens don't truncate
   the JSON), `renderNewsletter()` (business-branded shell + **banner hero** + email-safe inline
   images via `constrainInlineImages` + CAN-SPAM unsubscribe footer), `unsubscribeByToken()`.
3. **Sending** — the **paced SES queue**, not a synchronous loop: `approveAndSend` → `enqueueNewsletter`
   (`src/lib/newsletter-queue.ts`) writes one `newsletter_sends` row per recipient; the launchd tick
   `com.thinkbigjoe.newslettersend` → `/api/newsletter/send-batch` drains it via `sendNewsletterViaSes`
   (Amazon SES SMTP). Bounces/complaints suppress automatically (SNS webhook → `email_suppressions`).
   See **[`EMAIL_SCALE.md`](EMAIL_SCALE.md)** + **[`DELIVERABILITY.md`](DELIVERABILITY.md)**.

## Images (banner + inline)

- **Storage:** **Vercel Blob** (`src/lib/blob.ts` → `uploadImage`, one abstraction so an R2/S3 swap
  is one file). Uploaded via **`/api/newsletter/upload`** (auth'd, site-scoped): validates type/size,
  downscales + re-encodes with `sharp` (banner ≤1200px, inline ≤800px → WebP; GIFs pass through),
  returns a **public CDN URL**. Never base64 in the email (clients strip it) and never served from
  Neon (egress). `setBanner` only accepts `*.public.blob.vercel-storage.com` URLs.
- **Why CDN, not Postgres:** emailed images load on every open. Big clients (Gmail/Yahoo) proxy+cache
  images, so origin bandwidth stays tiny — but it must be object storage, not the DB.

## Data
- `newsletter_contacts` — a client's uploaded list (per `site_id`): email, name, status
  (subscribed/unsubscribed), `unsubscribe_token` (unique). Unique on `(site_id, email)`.
- `newsletters` — one row per business per month (`period` = `YYYY-MM`): subject, `body_html`,
  **`banner_url`**, `prompt`, status (draft → sending → sent / cancelled), recipient_count, sent_at.
- `newsletter_sends` — the per-recipient send queue (see `EMAIL_SCALE.md`).

## Cost / compliance
SES ≈ **$0.10 / 1,000 emails**; Blob free tier (1 GB) covers banners for a long runway. Compliance:
one-click `List-Unsubscribe` (RFC 8058) + the business's identity in the footer (CAN-SPAM); the UI
tells clients to only add customers who agreed to hear from them; bounce/complaint suppression is
enforced on every batch.
