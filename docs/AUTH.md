# Auth & transactional email

How people sign in, how the command center is gated, and how the app sends
password-reset / welcome / outreach email. If a login or a "didn't get the
email" problem lands on your desk, start here.

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
