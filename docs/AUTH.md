# Auth & transactional email

How people sign in, how the command center is gated, and how the app sends
password-reset / welcome / outreach email. If a login or a "didn't get the
email" problem lands on your desk, start here.

## Domain, DNS & email — where everything lives (check here first)

The authoritative map of the domain/DNS/email topology. **Check this before asking where
anything is** — don't guess or ask the user.

| Thing | Where | Notes |
|---|---|---|
| **Domain** | `thinkbigjoe.com` | the one production domain |
| **DNS** | **Vercel** (Vercel → Domains → `thinkbigjoe.com` → DNS) | *all* DNS records live here — MX, SPF, DKIM, DMARC, verification. To add/change any record, do it in Vercel. |
| **Email (mailboxes + receiving)** | **Zoho Mail** (free tier) | mailbox `joe@thinkbigjoe.com`; MX → `mx.zoho.com` / `mx2` / `mx3` |
| **Transactional + outreach sending** | Zoho **SMTP** (`smtp.zoho.com`) as `joe@thinkbigjoe.com` | see "Transactional email" below |
| **App hosting** | Vercel (project `thinkbigjoe-cyio`) | env vars set via `vercel env … production` |

**So: DNS = Vercel, email = Zoho.** Changing a DNS record (e.g. adding DMARC) is a Vercel action;
changing a mailbox/DKIM is a Zoho action.

### Email deliverability status (as of go-live)
- **SPF** ✅ `v=spf1 include:zohomail.com ~all`
- **DKIM** ✅ selector `zmail._domainkey`
- **MX** ✅ `mx.zoho.com` (+ mx2/mx3)
- **DMARC** ⚠️ **MISSING** — add a TXT record at `_dmarc.thinkbigjoe.com` in **Vercel DNS**
  (start `v=DMARC1; p=none; rua=mailto:joe@thinkbigjoe.com`). Gmail/Yahoo bulk-sender rules push
  unauthenticated cold mail to spam, so this matters once outreach volume ramps.
- The mailbox is **day-old with no sending reputation** — burst cold sends bounce/spam-file. Warm up
  with small daily batches; verify recipient addresses (skip guessed `info@`/`hello@`) before sending.

> The old `ACQUISITION_SYSTEM.md` also describes this setup, but that doc is flagged *aspirational* —
> **this table is the current source of truth.**

## The auth system

- **Library:** [better-auth](https://better-auth.com) (`src/lib/auth.ts`,
  `src/lib/auth-client.ts`). This powers **client-portal + command-center login**.
  It is *separate* from Payload's own CMS auth.
- **Storage:** better-auth owns four tables — `user`, `session`, `account`,
  `verification` — in their **own Postgres schema `better_auth`** (not `public`;
  Payload's dev `push` would otherwise drop them). Same Neon DB as everything else.
  Columns are camelCase and case-sensitive (`"emailVerified"`, `"providerId"`,
  `"userId"`) — quote them in raw SQL.
- **Sign-in methods:** email + password, **Google**, and Facebook. A social
  provider only renders if its `*_CLIENT_ID`/`*_CLIENT_SECRET` env vars are set
  (`socialProviderStatus` gates the UI). On **prod** Google is configured; a bare
  local `.env.local` usually has **no** `GOOGLE_CLIENT_ID`, so **the Google button
  does not appear on localhost** — locally you must use email + password.

### Account numbers

Every account carries a human-friendly **account number** — a plain 6-digit id
(`100001`, `100002`, …) a customer can read to the voice receptionist to be looked
up. It's **distinct from a site claim code** (`TBJ-XXXX-XXXX`): the claim code
belongs to a *built site*, the account number to a *person*.

- **Column:** `better_auth."user".account_number` (text, unique), assigned by a
  Postgres **column default** `nextval('better_auth.account_number_seq')` — so every
  new signup auto-gets one. A fallback in the `create.after` hook (`src/lib/auth.ts`)
  stamps one if the default is ever bypassed (idempotent — only fills a NULL).
- **Exposed** on the session as `user.accountNumber` (a read-only better-auth
  `additionalField`, `input:false`); shown to the customer on `/portal/account`.
- **Backfill / re-run:** `node scripts/db/add-account-numbers.mjs` (idempotent —
  creates the sequence/column/default and numbers any account still missing one,
  oldest-first).

### Admin gate (the command center)

`/command/**` is gated by `requireAdmin()` / `assertAdmin()`
(`src/lib/require-admin.ts`): a valid better-auth session **whose email is on the
allowlist** (`src/lib/admin.ts`). The allowlist is `DEFAULT_ADMINS`
(currently **`josephsardella@gmail.com`**) plus anything in the comma-separated
`ADMIN_EMAILS` env var. A logged-in non-admin is redirected to `/login`.

> ⚠️ Joe's admin identity is **josephsardella@gmail.com** (his Google login).
> That is deliberate — do not "correct" it to any other spelling.

### The Google-only-account gotcha

Signing up with Google creates an `account` row with `providerId='google'` and
**no password** — email/password is a *separate* `providerId='credential'` row.
So a Google user has nothing to "reset": requesting a password reset for a
passwordless account can't help them log in until a credential exists. To give a
Google user a password, create/set the `credential` account with a hash from
better-auth's own hasher:

```js
const { hashPassword } = require("better-auth/crypto"); // salt:hash format better-auth verifies
// insert into better_auth.account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
// values (<rand>, <userId>, 'credential', <userId>, <hash>, now(), now())
```

## Transactional email

- **Transport:** SMTP via Nodemailer (`src/lib/email.ts`). Provider is **Zoho Mail
  (`smtp.zoho.com`)**; all mail sends **from `noreply@thinkbigjoe.com`**.
- **Env vars** (all **Production-scoped + Sensitive** in Vercel, so `vercel env
  pull` returns them blank — you can't read them locally):

  | Var | What |
  |---|---|
  | `SMTP_HOST` | `smtp.zoho.com` |
  | `SMTP_PORT` | `465` (SSL) or `587` (STARTTLS) |
  | `SMTP_SECURE` | `true` for 465; else STARTTLS |
  | `SMTP_USER` | the full Zoho mailbox — **must equal the From address**, `noreply@thinkbigjoe.com` |
  | `SMTP_PASS` | a Zoho **app-specific password** (see below) |
  | `EMAIL_FROM` | `ThinkBigJoe <noreply@thinkbigjoe.com>` |
  | `EMAIL_BCC` *(optional)* | blind-copy every transactional email here |

- **Emails sent:** welcome (on signup), password reset, and forge outreach — all
  through the one `sendEmail()` transport.

### It fails silently by design

`sendEmail()` no-ops (just `console.warn`) when SMTP isn't configured, and the
reset/welcome flows **catch and swallow** send errors — the reset UI *always*
shows "check your email" so it can't leak whether an account exists. Net effect:
**a broken SMTP credential is invisible from the outside** — customers just never
get their link. Don't trust the UI; trust the health check.

### Health check — the only place a broken cred surfaces

`GET /api/health/email` (Bearer `CRON_SECRET`) runs `transporter.verify()`
against the live runtime creds:

```bash
CRON=$(…read CRON_SECRET…)
# verify auth only (sends nothing):
curl -s https://thinkbigjoe.com/api/health/email -H "Authorization: Bearer $CRON"
# also send a real end-to-end test email:
curl -s "https://thinkbigjoe.com/api/health/email?to=you@example.com" -H "Authorization: Bearer $CRON"
```

- `{"ok":true,...}` → SMTP authenticates; resets will deliver.
- `502 … "535 Authentication Failed"` → **bad `SMTP_USER`/`SMTP_PASS`** (see fix).
- `503 … configured:false` → SMTP env vars missing in that environment.

### Fixing `535 Authentication Failed` (Zoho)

Zoho rejects a normal account password over SMTP when 2FA is on — you need an
**app-specific password**:

1. Zoho Mail → **Settings → Security → App Passwords** → generate one for "SMTP".
2. Set it as `SMTP_PASS` on Vercel (Production), and make sure `SMTP_USER` is the
   **full** `noreply@thinkbigjoe.com` (matching the From):
   ```bash
   vercel env rm SMTP_PASS production
   printf '%s' '<app-password>' | vercel env add SMTP_PASS production
   vercel --prod   # redeploy so the new value is live
   ```
3. Re-run the health check above — expect `ok:true`, then a real reset arrives.

Also confirm in Zoho that **IMAP/SMTP access is enabled** for the mailbox and the
`noreply@thinkbigjoe.com` mailbox actually exists.

## Inbound email — bounce & reply pipeline

Sending is only half the loop. A deterministic poller watches the Zoho inbox so outreach never
flies blind on what came back.

- **Poller:** [`scripts/inbox-poll.mjs`](../scripts/inbox-poll.mjs) — Zoho **IMAP** (`imap.zoho.com:993`,
  same creds as SMTP: `SMTP_USER`/`SMTP_PASS`), runs every ~10 min via launchd
  `com.thinkbigjoe.inboxpoll`. Never marks mail read (`BODY.PEEK`); a UID watermark in `/tmp` means each
  message is processed once. No LLM in the detection path (pure infra).
- **Bounce** (Mailer-Daemon/DSN naming a lead's address) → **retires the dead address** (stashes it in
  `contact_notes`, NULLs `email`), sets `outreach_status='bounced'`, logs `email_bounced`, pings Telegram.
  Because the email is now NULL, the lead **automatically re-enters the research agent's hunt**
  (`list_forge_needs_contact`, run 3×/day by the prospector) — flagged ⚠️ BOUNCED and listed first, with
  the instruction to find a *different* email or a social (IG/FB/LinkedIn), never the dead one. When
  `enrich_forge_contact` saves a new channel, the bounce clears (`outreach_status='none'`) and it's
  emailable again. In the call room the lead shows a red **Bounced** pill + a "scanning for new contact"
  banner, and Joe can still phone/text it meanwhile.
- **Reply** (From = a lead) → logs `email_reply`, inserts a **`forge_replies`** row, and **pre-drafts a
  warm response with Gemini** (`gemini-2.5-flash`), then pings Telegram. The draft lands in the
  **"Replies to respond to"** panel at the top of `/command/leads`.
- **The gate:** draft → **Joe edits & sends** (server action `sendReply`, `src/lib/email.ts` →
  `sendReplyEmail`, reply-to Joe, threaded on `Re:`) → row marked `sent` + logged `email_reply_sent`.
  **Nothing emails automatically** — same human gate as every outbound. `dismissReply` clears one without
  sending. Bounces (⚠️), replies (↩️), and sent replies all show on each lead's **Message history** timeline
  in the call room.
- **Prereq — IMAP must be ON in Zoho:** mail.zoho.com → Settings → Mail Accounts → `joe@thinkbigjoe.com`
  → IMAP Access → **Enable**. Until then the poller logs `inbox_checked` with an "IMAP not enabled" error
  and does nothing. The launchd plist can stay loaded (it fails gracefully every run). **This is why leads
  that actually bounced can still look "contacted"** — their bouncebacks (DSNs) are sitting unread in the
  inbox. Enable IMAP + run `node scripts/inbox-poll.mjs` to catch up.

### Deliverability principle — a bounce is a FAILED attempt, never "contacted"

We must not record a lead as *contacted* when delivery failed. Enforced in two places:
- **Send-time:** a permanent SMTP rejection (5xx / rejected recipient) in `/api/forge/send-outreach`
  retires the address (nulls `email`, notes it) and logs `email_bounced` — it does **not** mark
  `outreach_status='sent'`. Catches synchronous bounces without IMAP.
- **Async (DSN):** the inbox poller does the same when a bounceback arrives (needs IMAP).
- **In the CRM** (`/command/leads`): a bounced lead's email sends are counted as **failed**, kept out of
  the "successful touches" total, shown as "email bounced" (red) and "Emailed — didn't deliver" on the
  timeline. The lead sits in the **Bad contact** stage, not Contacted — and re-enters the research
  agent's hunt for a working channel.
- The Gemini draft uses `GEMINI_API_KEY` from `.env.local`; Telegram alerts use
  `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` (both optional — the poller degrades gracefully without them).
