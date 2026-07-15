# Email delivery — standards, health, and the client-sending runbook

**Read this when** you touch anything that SENDS email — transactional (`src/lib/email.ts`), outreach
(`send-outreach`), the **client newsletter** (`src/lib/newsletter.ts`), or you're onboarding a client
to sending. This is the standards + health doc. `AUTH.md` covers TBJ's own mailbox/DNS mechanics;
this covers **whether the delivery system is healthy and safe to send for clients.**

> **The one rule:** deliverability is a shared, exhaustible reserve. One bad send — to a bounced
> address, without an unsubscribe, from an un-authenticated domain — doesn't just fail; it degrades
> the reputation of **every future send from that domain, for every client on it.** Sending is cheap;
> the reputation you spend is not. Treat a green health board as a **merge gate** for anything that sends.

---

## The sending paths (know which one you're touching)

| Path | Code | From | Volume | Purpose |
|---|---|---|---|---|
| **Transactional** | `sendMail` (`email.ts`) | `no-reply@thinkbigjoe.com` | low | password reset, welcome, booking confirmations |
| **Outreach** | `send-outreach` | `no-reply@thinkbigjoe.com` | ~15/day, paced | first-touch to prospects |
| **Client newsletter** | `sendNewsletterEmail` (`newsletter.ts`) | `no-reply@thinkbigjoe.com`, client's *name* | **thousands (target)** | a client mailing THEIR customers |

All three currently ride **one Zoho mailbox** on **one domain reputation**. That is the central risk
the standards below exist to manage — see `EMAIL_SCALE.md` for the fix (per-client identity + SES).

---

## Non-negotiable standards (every send must satisfy these)

1. **Authenticated domain.** SPF + DKIM aligned, and **DMARC present**. Gmail/Yahoo bulk rules reject
   or spam-file un-authenticated mail outright.
2. **Only send to opted-in, live addresses.** Newsletter lists are opt-in (good). Never send to an
   address that has **hard-bounced** or **complained** — that's the fastest way to get a sender banned.
3. **A bounce is a FAILED attempt, never "contacted."** Suppress the address; never retry it. (The
   principle is already stated in `AUTH.md`; here it's a hard standard.)
4. **One-click unsubscribe on every marketing send.** `List-Unsubscribe` + `List-Unsubscribe-Post`
   headers AND a visible link. Already implemented for the newsletter — never remove it.
5. **Never send bulk through the transactional mailbox.** Zoho Mail is a mailbox, not a bulk sender;
   its ToS forbids marketing volume and it will throttle/suspend the account — which would also kill
   transactional mail. Bulk goes through the dedicated pipe (SES — see `EMAIL_SCALE.md`).
6. **Warm up new sending domains.** A cold domain sending thousands lands in spam. Ramp volume over
   days/weeks; deliverability is a practice, not a one-time build.
7. **Pace it.** Sends are batched + throttled by a background job, never a synchronous request loop
   (which also times out on serverless).

---

## Health board — keep this CURRENT (last checked: 2026-07-14)

The point of this doc, per the working rule in `AGENTS.md`: this board reflects the **live** state.
When you touch the delivery system, re-verify the relevant rows and update the date.

| Component | State | Notes / how verified |
|---|---|---|
| **SPF** | ✅ | `dig TXT thinkbigjoe.com` → `v=spf1 include:zohomail.com ~all` |
| **DKIM** | ✅ | selector `zmail._domainkey` (Zoho) |
| **DMARC** | ❌ **MISSING** | `dig TXT _dmarc.thinkbigjoe.com` → empty. **Add** `v=DMARC1; p=none; rua=mailto:joe@thinkbigjoe.com` at `_dmarc` in **Vercel DNS**. Blocks safe bulk sending. |
| **Transactional send** | ✅ | `GET /api/health/email` (`verify()`); `?to=you@x.com` sends a real test |
| **Inbound bounce/reply poller** | ❌ **DOWN** | `launchctl list \| grep inboxpoll` → **exit 127**. **Bounces are NOT being processed** → we cannot suppress dead addresses → reputation risk. Fix the plist's node path. |
| **Client newsletter at scale** | ⚠️ **NOT READY** | Still on Zoho SMTP (caps + ToS risk), synchronous sender (times out on large lists), shared `no-reply@` identity (no per-client reputation isolation), no bounce suppression for client sends. Safe for **small lists only** until `EMAIL_SCALE.md` ships. |

### How to check delivery health (runbook)

```bash
# transactional transport can auth?
curl -s https://thinkbigjoe.com/api/health/email            # verify() only, sends nothing
curl -s "https://thinkbigjoe.com/api/health/email?to=you@example.com"   # real test send

# DNS auth records live?
dig +short TXT thinkbigjoe.com        | grep -i spf
dig +short TXT zmail._domainkey.thinkbigjoe.com
dig +short TXT _dmarc.thinkbigjoe.com                       # MUST be non-empty before bulk

# is the bounce poller alive? (0 = ok, non-zero = dead → bounces unprocessed)
launchctl list | grep com.thinkbigjoe.inboxpoll
```

---

## Before you let a client send a newsletter (onboarding checklist)

Until per-client identity ships (`EMAIL_SCALE.md`), a client mailing thousands from our shared domain
is **not safe**. The standard, in order:

1. **DMARC exists** on the sending domain (currently ❌ — blocks everything below).
2. **Bounce/complaint suppression is live** — the poller is up (currently ❌) or SES webhooks are wired.
3. **The send is paced + backgrounded**, not the synchronous loop (currently a `for` loop — see gap).
4. **Sending identity is isolated per client** (shared subdomain → their own domain). Not yet built.
5. **List is opt-in** and every send carries one-click unsubscribe (✅ already).
6. **Volume is warmed up** — start small, ramp.

If any of 1–4 is unmet, cap the client to a **small list** and don't promise thousands yet.

---

## Known gaps / risk register (work these down)

- ❌ **DMARC missing** — 5-minute Vercel DNS fix; blocks safe bulk. Highest leverage.
- ❌ **Bounce poller dead (exit 127)** — we're flying blind on bounces; every send to a dead address
  compounds reputation damage. Fix before any volume.
- ⚠️ **Newsletter sender is synchronous + Zoho** — times out on large lists AND risks the mailbox.
  Replaced by the SES + paced-job architecture in `EMAIL_SCALE.md`.
- ⚠️ **Shared sending identity** — one client's complaints hit everyone. Per-client identity is the
  scale blocker, not the send cost.

---

## Related

- [`AUTH.md`](AUTH.md) — TBJ's own mailbox, DNS, SMTP env, and the inbound bounce/reply pipeline.
- [`EMAIL_SCALE.md`](EMAIL_SCALE.md) — the SES + paced-sender + per-client-identity build plan that
  makes "thousands of emails for clients" actually safe, incl. the AWS-console setup steps.
- [`NEWSLETTER.md`](NEWSLETTER.md) — the client newsletter product surface + AI drafting.
