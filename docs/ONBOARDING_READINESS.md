# Onboarding Readiness Audit — can we take a paying customer live?

> **Status**: POINT-IN-TIME AUDIT · **Date**: 2026-07-18 · **Branch**: `refactor/phase0-foundation`
> **Method**: six parallel code audits — payments, auth/claim, voice provisioning, booking/calendar,
> portal experience, operational reliability. Read-only. Verified against live Stripe, live SMTP
> health, production env, and the production database.
> **Question asked**: a customer says yes on Thursday — what has to work for them to be live Saturday?

---

## Verdict

**No. Not as "the AI answers your phone and books your jobs." That product does not exist in this
codebase yet.**

What exists is **Ivy — ThinkBigJoe's own front desk.** One Retell agent, one number
(480-764-2121), hardcoded to Joe's calendar, Joe's Telegram, and Joe's personal cell. It is a good
single-tenant product. It is not a multi-tenant one, and several of its behaviors are actively
harmful if pointed at a customer's callers.

`docs/VOICE.md` was honest about this ("the automated per-client version is **not built yet**"). The
gap is bigger than "provisioning is manual" implies: **provisioning is the entire product.**

**The good news, and it's real:** `src/lib/site-booking.ts` is already a correct multi-tenant booking
engine — per-owner Google OAuth, tenant resolution, the customer's own calendar. The voice path
simply doesn't use it. Most of the P0 work below is **wiring, not building.**

---

## P0 — would actively harm a customer. Non-negotiable before any live line.

These aren't polish. Each one damages the *customer's* business, not just ours.

### 1. The phone line fails CLOSED — dead air, then hangup

> **✅ FIXED 2026-07-19 for TBJ's own line**, and **partially retracted for customers.**
>
> The `<Dial>` now carries `action="/api/twilio/voice/failed"`, which routes to a human on any
> non-answered status instead of hanging up.
>
> **The correction:** this finding assumed customers' calls flow through Twilio the way TBJ's do.
> They don't. Tenant identity comes from *which Retell number was dialled*
> ([`VOICE_TENANCY_SPEC.md`](./VOICE_TENANCY_SPEC.md)), so each customer's carrier forwards
> **directly to their own Retell number** — Twilio is not in their call path and this TwiML fallback
> cannot apply to them. I checked Retell's phone-number object: it exposes `inbound_agents`
> (weighted routing) and **no failover-to-a-number field**. There is no automatic customer failover
> to build right now.
>
> **Severity was overstated.** With conditional forwarding on no-answer — the documented default in
> [`SALES_RUNBOOK.md`](./SALES_RUNBOOK.md) — the customer's own phone rings first for 20–25 seconds
> on every call. A Retell outage therefore degrades to roughly the pre-product state: they miss the
> calls they were already missing. It is not "we killed their working line."
>
> Customer protection is: their phone ringing first, the `##61#` kill switch they control, and
> monitoring (still missing — see "No observability at all").

The original finding, for TBJ's own number:

`src/app/api/twilio/voice/route.ts:43` is the entire call path:

```
<Response><Dial answerOnBridge="true" timeout="25">${VOICE_FORWARD_TO}</Dial></Response>
```

No `action=`, no second `<Number>`, no `<Say>`, no `<Voicemail>`. If Retell doesn't answer within
25 seconds, TwiML ends and **Twilio hangs up**. If the Vercel route 500s, the caller hears Twilio's
generic error. There is no path in this repo where a failure reaches a human.

**For a plumbing company, a dead line is a catastrophic outage we caused.**

**Fix:** add `action="/api/twilio/voice/failed"` and on any non-`completed` DialCallStatus, `<Dial>`
the business's real number. Requires storing that number per site — the column doesn't exist. Also
set the Twilio console's **"Primary handler fails" fallback URL** to a static TwiML bin forwarding
to the business; that's the only thing that saves us when Vercel itself is down, and it can't be
configured from this repo.

### 2. `identify_caller` leaks our prospect database to customers' callers

`src/app/api/voice/identify/route.ts:38-45` scans **all** of `forge_sites` by phone, unscoped by
tenant. A random person calling the plumber gets matched against our 1,806-row prospecting list, and
the agent is instructed *"This looks like [SomeOtherBusiness]… walk them through creating an account
and claiming it."*

Cross-tenant data exposure plus a nonsensical call.

**Fix:** `identify_caller`, `verify_code` and `verify_callback_code` are **TBJ sales tools, not
receptionist tools.** Exclude them from customer agents entirely. Faster and more correct than
scoping them.

### 3. `transfer_to_joe` sends the customer's callers to Joe's personal cell

`scripts/retell/agent-config.mjs:73` defaults `transferTo` to Joe's mobile, duplicated at
`create-tbj-agent.mjs:40` and `update-tbj-agent.mjs:63`. `create_support_ticket` likewise hardcodes
`joe@thinkbigjoe.com` (`api/voice/support/route.ts:12`).

Any customer agent built from the blueprint routes *their* callers to *our* phone.

**Fix:** `buildTools()` takes a business context; transfer target comes from a validated per-tenant
escalation number. **Remove the default literal** so omitting it fails loudly instead of silently
routing to Joe.

### 4. `book_appointment` books Joe's calendar, in Joe's timezone, during Joe's sales hours

`api/voice/book/route.ts:85` calls `createEvent` from `lib/gcal.ts`, hardcoded to `GCAL_REFRESH_TOKEN`
/ `GCAL_CALENDAR_ID` — one global Google account. `check_availability` offers **Mon–Fri 10–5
Pacific** (`voice-booking.ts:4-6`) and always speaks "Pacific."

A caller booking a drain cleaning lands on **Joe's** calendar and Joe gets the Telegram.

**Fix:** new `/api/voice/site-availability` + `/api/voice/site-book` that resolve the tenant and
delegate to the existing, correct `bookForSite` / `availableSlots`. **The engine already exists** —
this is an entry point, not a rewrite. Roughly a day.

### 5. No tenant identity on inbound calls

Every webhook derives context from the *caller's* number. `call.to_number` — the number that would
identify **which business was called** — is never read anywhere in the repo. There is no column
mapping a Retell number to a site.

**Fix:** add `retell_agent_id`, `retell_llm_id`, `voice_number`, `escalation_phone` to `forge_sites`
(or better, onto the `site_agents` table from [`AGENT_PLATFORM.md`](./AGENT_PLATFORM.md)). Add a
`siteFromCall(body)` helper resolving `to_number` → site. **Do this before customer #1** — every
hand-provisioned agent built on today's blueprint becomes migration debt.

---

## P1 — will look broken, or lose money

### 6. Nothing ever sets `receptionist_status = 'active'`

`portal/actions.ts:87` *preserves* `active` but never *assigns* it. No code, script, or webhook
produces that state. A paying customer's portal reads **"⏳ Setup submitted — our team is
provisioning your receptionist"** on day 2, day 10, and day 60.

### 7. Call data is never persisted — so the portal shows nothing

**There is no calls table and no Retell `call_ended` / `call_analyzed` webhook.** Grepping `portal/`
for `retell|transcript|call_log|calls` returns **zero matches across 39 files**.

If the AI answers 12 calls and books 3 jobs overnight, **the portal is byte-for-byte identical to if
it answered zero.** The "portal is the moat" pitch is not implemented in any form — today it is the
opposite of a moat, because a customer has no way to verify they got anything.

Every day this ships late is a day of call history **permanently lost** — Retell's retention is not
our database.

### 8. A failed Stripe webhook loses the sale silently

`api/stripe/webhook/route.ts:219-223` catches every handler error and **returns 200 anyway**, so
Stripe never retries. A DB blip during `checkout.session.completed` = money captured, nothing
provisioned, no alert. No `event.id` dedupe table exists, and `domainCredits` is *set* not
incremented, so a replayed event re-grants a spent free domain.

### 9. Every customer is in `America/New_York`

`forge_sites.booking_timezone` defaults to Eastern (`schema.ts:506`) and is **never written
anywhere** — repo-wide grep returns only the schema default. A Phoenix roofer's 9–5 generates slots
at **6am–2pm local**. This alone breaks booking for most of the country.

### 10. Fail-OPEN double-booking

`listCalendarEvents` returns `[]` on *any* error (`google-oauth.ts:209,230`). `availableSlots` reads
that as "nothing busy" and offers every slot; the pre-book recheck (`site-booking.ts:164`) computes
`stillFree = true` from the same empty array. **During a Google outage we book over existing
appointments.** `gcal.ts:352-355` correctly fails closed — the customer path does the opposite.

### 11. No path for a new customer to buy

Public CTAs go to `/portal/book`. Paying requires: sign up → verify → claim code → **site must be
built** (`portal/billing/page.tsx:122-126`) → then pay. There is no way for a stranger to hand us
money today. Also: the `website-first-month-99` coupon is attached to **every** checkout
(`actions.ts:531`) — on a $497 plan that's an unintended $99 discount.

---

## Live production bug — unrelated to launch, fix today

**`inbox-poll` has failed 1,461 consecutive times over ~10 days.** Its plist uses `/usr/bin/env node`
with no PATH block; launchd's minimal PATH has no `node`. Exit 127 every run.

Consequence: **zero bounce detection and zero reply routing for ten days.** Prospects who replied got
silence, and dead addresses keep getting mailed — directly burning the shared deliverability reserve
that [`DELIVERABILITY.md`](./DELIVERABILITY.md) gates on.

**Fix: swap `/usr/bin/env node` for `/usr/local/bin/node`, matching every other plist. One line.**

---

## P2 — before scale, not before customer #1

- `verifyTwilioSignature` **fails open** (`src/lib/sms.ts:148-154`) — unset `TWILIO_AUTH_TOKEN` makes
  both public webhooks unauthenticated. Verify the var is set in Vercel, then flip to `return false`.
- `voice/support` returns `ok: true` unconditionally — **tells the caller their ticket reached Joe
  when the email failed** (`support/route.ts:51-76`).
- better-auth falls back to a **publicly-known default secret** if `BETTER_AUTH_SECRET` is missing;
  `DATABASE_URL` missing boots clean against a placeholder host. Both should hard-fail in production.
- Uncaught DB calls mid-call in `voice/identify`, `voice/verify`, `voice/callback-code`.
- Public booking endpoint validates neither business hours nor rate — an arbitrary `startISO` books
  **3am Sunday** onto a customer's calendar.
- Customer job bookings have **no DB record at all** (`bookForSite` writes only `activity_log`) — no
  reschedule, no no-show handling, and nothing to build "your AI booked N jobs" reporting on.
- `?redirect=` after login is ignored at six call sites — friction on the single most important step.
- No admin un-claim/reassign action; claim codes are printed publicly on `/s/[slug]`.
- Account-number enumeration oracle in `voice/verify` (sequential from 100001, no attempt cap).

---

## No observability at all

- **No error tracking.** No Sentry/Datadog/OTel anywhere. Every error path ends at `console.error`.
- **No uptime monitoring, no synthetic test call, no 5xx alerting.** Nothing would detect a dead
  phone line. At 2am Joe finds out when the customer calls him — and per P2, the customer's
  escalation path may not reach him either.
- **All alerting is on happy paths only** — Telegram fires on a sale or a booking, never on failure.
- Background jobs log to `/tmp` (macOS purges it), use `curl -s` with no `-f` and no exit check.
- **Missing/expired `GCAL_*` returns HTTP 200** with "Booking isn't available right now" — no 5xx,
  so booking can be dead for days with every monitor green.

**Every customer-facing background job runs on Joe's Mac Mini**, with `RunAtLoad => 0` on every
plist. They're LaunchAgents — a reboot to the login window leaves all 16 jobs dead until someone
physically logs in, with no catch-up for missed intervals.

---

## What's solid

- **`pnpm run build` passes clean.** Next 16.2.9, 0 type errors, 41/41 pages. Branch is 14 ahead of
  `main`, 0 behind.
- **Auth is genuinely good** — better-auth on its own schema, mandatory email verification, Google +
  Facebook + password live, Turnstile on, live SMTP verified. Admin gating is three layers deep with
  45 `assertAdmin()` calls.
- **Claim flow works end to end** — unambiguous 31-char alphabet, collision retry, session-gated
  redemption, activity logged.
- **Stripe is live and correct for today's model** — signature-verified webhook, setup fee and
  subscription charged together on the first invoice, all price IDs live and active.
- **Voice webhooks are bearer-gated and fail closed**; Retell payload parsing is defensive; the
  agent-config single-source pattern prevents prompt drift.
- **`src/lib/site-booking.ts` + `google-oauth.ts` are real multi-tenancy done well** — per-owner
  tokens, scope-union on reconnect, correct DST-safe zone math.
- **Portal empty states are handled properly** throughout. Mobile is adequate.

---

## The realistic sequence

**Week 0 (now):** fix `inbox-poll` (one line). Fix the Stripe 200-on-error. Both are live bugs
costing money and deliverability today, independent of launch.

**Week 1 — make one customer safe.** P0 items 1–5. Roughly: tenant columns + `siteFromCall`, a voice
tool pair pointed at `bookForSite`, parameterized `buildTools()`, drop the three sales-only tools
from customer agents, and the fallback dial. This is the week that converts a demo into a product.

**Week 2 — make it visible and provisionable.** Calls table + Retell `call_ended` webhook (P1 #7),
`provision_receptionist` MCP tool that flips status to `active` (P1 #6), timezone at site creation
(P1 #9), fail-closed calendar reads (P1 #10). Add Sentry and a daily synthetic test call.

**Week 3 — sell and onboard for real.**

---

## What can honestly be sold this week

**Sell the conversation, not the instant install.** The demo line works today and it is genuinely
impressive — that sells. What follows is a start date, not a same-day activation.

If a customer wants to commit now, the defensible offer is **"answers 24/7 and texts you a
qualified message"** — message-taking, no booking — because that removes the entire calendar problem
(P0 #4, P1 #9, P1 #10). Even then, P0 #1, #2, #3 and #5 must ship first: a dead line, a leaked
prospect list, and their callers reaching Joe's cell are not acceptable at any price.

**Do not sell "the AI books your jobs" until P0 #4 ships.** That is the half plumbers actually pay
for, and it currently has no code path.
