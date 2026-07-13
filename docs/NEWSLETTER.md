# Monthly customer newsletter ($99 plan)

Part of the **$99 Website plan**: clients keep their own customers top of mind with an AI-drafted
monthly newsletter they review + send from the portal. Low-cost by design.

## The three layers (full-stack rule)

1. **UI** — `/portal/newsletter` (`page.tsx` + `newsletter-client.tsx`). Client uploads their
   customer list (CSV/paste), gets an AI draft, edits it with a live preview, and approves & sends.
   Server actions in `portal/newsletter/actions.ts` (all scoped to the caller's claimed site).
   Added to the portal nav (`portal-header.tsx`).
2. **Engine** — `src/lib/newsletter.ts`: `draftNewsletter()` (Gemini `gemini-2.5-flash`, JSON
   subject+html; note the **4096 output budget** so thinking tokens don't truncate the JSON),
   `renderNewsletter()` (business-branded shell + unsubscribe footer), `sendNewsletter()` (per-
   recipient send with a unique unsubscribe token), `unsubscribeByToken()`. Sending goes through
   `sendNewsletterEmail()` in `src/lib/email.ts` (business from-name, `List-Unsubscribe` one-click,
   no admin BCC). `/api/newsletter/unsubscribe` handles the link click + RFC-8058 one-click POST.
3. **Schedule** — *not built yet.* v1 is client-initiated (they hit "draft" + "send" each month).
   Next step: a monthly cron that auto-drafts for each active client and nudges them to approve.

## Data
- `newsletter_contacts` — a client's uploaded list (per `site_id`): email, name, status
  (subscribed/unsubscribed), `unsubscribe_token` (unique). Unique on `(site_id, email)`.
- `newsletters` — one row per business per month (`period` = `YYYY-MM`): subject, body_html,
  status (draft → sent), recipient_count, sent_at.

## Cost / sending
v1 reuses the existing **Zoho SMTP** transport → **$0 extra**. The transport is intentionally
swappable — move `sendNewsletterEmail` to **Amazon SES** (~$0.10 / 1,000 emails) when volume grows.
Compliance: one-click unsubscribe + the business's identity in the footer (CAN-SPAM); the UI tells
clients to only add customers who agreed to hear from them.
