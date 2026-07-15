# Email at scale — the SES build plan

**Read this when** you're building or operating the bulk email sender (client newsletters at
thousands/month). This is the architecture + step-by-step build. Standards + the live health board
live in [`DELIVERABILITY.md`](DELIVERABILITY.md); this is how we make "thousands of emails for
clients" real and safe.

**Decision:** Amazon **SES** for the sending pipe — $0.10 / 1,000 emails, no per-contact fee (we own
the list in `newsletter_contacts`, so per-contact pricing models like Resend Broadcasts are the wrong
shape). SES is cheaper at scale; the tradeoff is we build the bounce/complaint plumbing ourselves,
which is exactly what this doc specs.

---

## Architecture (four pieces)

```
 client approves a newsletter in /portal/newsletter
        │
        ▼
 (1) SEND QUEUE            per-recipient rows: queued → sent | bounced | complained | suppressed
        │  paced background job (launchd tick → endpoint → send N, mark, repeat)
        ▼
 (2) SES TRANSPORT         send via SES API/SMTP, FROM the client's own verified identity
        │
        ▼
 (3) SES → SNS webhook  →  (4) SUPPRESSION LIST   bounces + complaints auto-added; never re-sent
```

1. **Send queue + paced job.** The current `newsletter.ts` `for` loop sends synchronously inside a
   request — it times out on serverless and can't do thousands. Replace with a `newsletter_sends`
   table (one row per recipient, status machine) and a launchd tick that POSTs an endpoint which sends
   a bounded batch, marks each row, and exits. Resumable: a crash/timeout just leaves rows `queued`.
2. **SES transport.** A `sendViaSes()` alongside the Nodemailer path in `src/lib/email.ts`, selected
   for bulk. SES has an SMTP interface (drop-in for Nodemailer) *and* an API; SMTP is the smaller
   change. Sends **from the client's verified domain** (see per-client identity).
3. **Bounce/complaint webhook.** SES publishes delivery events to an **SNS topic**; an
   `/api/ses/notifications` route (verifies the SNS signature) records bounces + complaints.
4. **Suppression list.** A `email_suppressions` table (address + reason + timestamp). Every send
   checks it first. **This is not optional** — SES throttles then bans senders whose bounce/complaint
   rates climb, and without suppression they will.

---

## Per-client sending identity (the reputation-isolation piece)

All mail currently sends from `no-reply@thinkbigjoe.com` — one shared reputation, so one client's
complaints hit everyone. At scale each client sends from **their own identity**:

- **Ideal:** the client's own domain. They add SES **Easy DKIM** CNAMEs (3 records) + an SPF include
  to their DNS; SES verifies; we send `from: newsletter@theirdomain.com`. Full reputation isolation.
- **Faster interim:** a per-client **subdomain we control** (e.g. `<slug>.mail.thinkbigjoe.com`), so a
  bad actor is at least walled off from the apex and from other clients.

Store the verified identity per site (a column on `forge_sites` / the site's settings). Onboarding
gains a "verify your sending domain" step — a few DNS records, same UX as the Google DNS verification.

---

## Browser setup (AWS console — the human-gated steps)

> Claude drives the console for config, but **never creates or handles the SES secret key.** Joe
> generates the SMTP credential and pastes it into Vercel; the secret never passes through Claude.

1. **Sign in / create the AWS account.** (Joe — Claude can't authenticate or create accounts.)
2. **Pick a region** and stay in it (e.g. `us-east-1`). SES is regional; the sending identity,
   suppression, and credentials all live in one region.
3. **Verify the sending domain** — SES → Identities → Create identity → Domain → enable **Easy DKIM**.
   SES generates 3 CNAME records → add them in **Vercel DNS** (thinkbigjoe.com). Add SPF
   `include:amazonses.com` to the existing SPF record (don't create a second SPF TXT).
4. **Add DMARC** if still missing (it is — see DELIVERABILITY board): `_dmarc` TXT
   `v=DMARC1; p=none; rua=mailto:joe@thinkbigjoe.com` in Vercel DNS.
5. **Request production access** — SES → Account dashboard → "Request production access." Use case:
   transactional + opt-in customer newsletters; describe the opt-in, one-click unsubscribe, and
   bounce/complaint handling (all true once (3)+(4) below ship). ~1 business day to approve.
6. **Create the SNS topic** for bounce/complaint events + subscribe the `/api/ses/notifications`
   endpoint. Wire SES identity's event destination to it.
7. **Create the sending credential** — SES → SMTP settings → Create SMTP credentials. **Joe copies
   the SMTP username + password into Vercel** as `SES_SMTP_USER` / `SES_SMTP_PASS` (+ host/region).
   Claude never sees the password.

---

## Code build (what ships in this repo)

| Piece | Where | Notes |
|---|---|---|
| `newsletter_sends` table | DB → `db:pull` | per-recipient status: `queued/sent/bounced/complained/suppressed/failed` |
| `email_suppressions` table | DB → `db:pull` | address · reason · created_at; unique on lower(email) |
| `sendViaSes()` | `src/lib/email.ts` | SES SMTP transport; suppression check before every send |
| Paced sender endpoint | `src/app/api/newsletter/send-batch` | sends a bounded batch, marks rows, honors window/rate |
| launchd tick | `scripts/newsletter-send.sh` + plist | drives the endpoint (mirror the outreach sender) |
| SNS webhook | `src/app/api/ses/notifications` | verify SNS signature → write suppressions + mark rows |
| Per-client identity | `forge_sites` column + onboarding step | verified domain/subdomain per client |

Full-stack rule (AGENTS.md): the UI already exists (`/portal/newsletter`); this adds the schedule
(launchd) + the send path. Keep the [`DELIVERABILITY.md`](DELIVERABILITY.md) health board updated as
each piece lands — flip the "client newsletter at scale" row from ⚠️ toward ✅.

---

## Build order (ship value each step)

1. **DMARC + fix the bounce poller** — unblocks safe sending; both are on the DELIVERABILITY risk register today.
2. **Suppression table + SNS webhook** — before any volume.
3. **SES transport + send queue + paced job** — the actual scale sender; cut newsletter off the Zoho loop.
4. **Per-client identity** — reputation isolation; onboarding DNS step.
5. **Warm-up** — ramp volume over days/weeks; watch bounce/complaint rates in the SES dashboard.

Rough effort: ~5–7 focused build sessions of code, plus calendar time for SES production approval
(~1 day) and per-client DNS propagation. Deliverability is then an ongoing practice, not "done."

---

## Related
- [`DELIVERABILITY.md`](DELIVERABILITY.md) — standards + the live health board (the merge gate).
- [`NEWSLETTER.md`](NEWSLETTER.md) — the client newsletter product surface + AI drafting.
- [`AUTH.md`](AUTH.md) — DNS = Vercel, current SPF/DKIM/DMARC state, the inbound poller.
