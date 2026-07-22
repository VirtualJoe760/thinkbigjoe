# Voice Multi-Tenancy — implementation spec

> **Status**: BUILT (Stages 1–3 shipped; Stage 4 routes shipped, agent tools still tier-1
> message-only) · **Written**: 2026-07-19 · **Updated**: 2026-07-22 — the body below is the
> historical spec; for what actually shipped vs. the plan, see the
> **[status addendum — 2026-07-22](#status-addendum--2026-07-22)** at the bottom.
> **Supersedes** the per-customer-agent provisioning described in
> [`AGENT_PLATFORM.md`](./AGENT_PLATFORM.md) §"agent catalog" and
> [`ONBOARDING_READINESS.md`](./ONBOARDING_READINESS.md) P0 #5 — see "The decision" below.
> **Prerequisite reading**: [`VOICE.md`](./VOICE.md) (what Ivy is today).

---

## The decision that shrinks this build

**One shared "Receptionist" agent + per-call dynamic variables. NOT one Retell agent per customer.**

Retell supports an **Inbound Call Webhook**, configured per phone number: when a call arrives, Retell
POSTs to our URL and we return `retell_llm_dynamic_variables`, which are interpolated into the
agent's prompt as `{{variable}}`. Transfer destinations accept dynamic variables too
([Retell: Dynamic Variables](https://docs.retellai.com/build/dynamic-variables)).

**Why this is the right call:**

| Per-customer agents (what I specced before) | Shared agent + variables (this spec) |
|---|---|
| Create an LLM + agent per customer | Create the number, point it at the shared agent |
| Prompt improvement = update N agents by hand | Prompt improvement ships to everyone at once |
| Store `retell_agent_id` + `retell_llm_id` per site | Store the phone number |
| Every hand-provisioned agent is migration debt | No debt |

It also directly satisfies the rule in `AGENT_PLATFORM.md`: *"New agents are built once, for
everyone, on our schedule — never per-client."*

**The inbound webhook is also the tenant-resolution point.** It receives the called number, which is
the thing that identifies the business. Same mechanism resolves tenancy inside every tool call.

**Hard constraint:** all dynamic variable values **must be strings**. Numbers, booleans and objects
are rejected. Serialize everything.

---

## ⚠️ Verify before writing code

> **✅ RESOLVED 2026-07-22 — verified while building.** Retell sends the called number as
> `call.to_number` (some events use a flat body; `calledNumber()` in `src/lib/voice-tenant.ts`
> handles both), variables are returned as `{ call_inbound: { dynamic_variables } }`, and
> `/api/voice/inbound` is live. The gate below is kept for history.

I have the mechanism confirmed but not the exact wire format. **Read
`https://docs.retellai.com/features/inbound-call-webhook` and confirm:**

1. Exact request body field names (is the called number `to_number`, and at what nesting?)
2. Exact response shape for returning variables (`{ call_inbound: { dynamic_variables: {...} } }`?)
3. Whether an agent override can be returned per call
4. Timeout and retry behavior on our endpoint

**Do not write `/api/voice/inbound` until these four are confirmed.** Everything else in this spec is
independent of the answer and can be built in parallel.

---

## Schema

Two new tables. **Nothing goes on `forge_sites`** — it's already 98 columns.

```sql
-- Routing: which business owns which phone number. PK lookup on every inbound call.
create table voice_lines (
  phone_number     text primary key,          -- E.164, the number we provisioned
  site_id          integer not null references forge_sites(id),
  status           text not null default 'provisioning', -- provisioning|active|paused|released
  retell_agent_id  text,                      -- null = shared receptionist agent
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index voice_lines_site_idx on voice_lines(site_id);

-- Call history. This is what the portal renders and what the moat is made of.
create table calls (
  id             uuid primary key default gen_random_uuid(),
  site_id        integer not null references forge_sites(id),
  retell_call_id text unique,                 -- idempotency key for the webhook
  from_number    text,
  to_number      text,
  started_at     timestamptz,
  ended_at       timestamptz,
  duration_sec   integer,
  caller_name    text,
  summary        text,
  transcript     text,
  disposition    text,                        -- message|booked|transferred|spam|unknown
  recording_url  text,
  notified_at    timestamptz,                 -- when we texted the owner
  created_at     timestamptz not null default now()
);
create index calls_site_started_idx on calls(site_id, started_at desc);
```

Voice **configuration** (services, hours, FAQs, escalation number) lives in
`site_agents.config` jsonb where `agent_key = 'voice'`, per `AGENT_PLATFORM.md`.

DB first, then `npm run db:pull`. Never hand-edit `src/db/schema.ts`.

### Config shape — `site_agents.config` for `agent_key='voice'`

```ts
type VoiceConfig = {
  greeting?: string;          // "Thanks for calling Ace Plumbing"
  services: string;           // prose
  doNotSay?: string;          // prose
  faqs?: { q: string; a: string }[];
  escalationPhone: string;    // E.164, VALIDATED — required for transfers
  notifyPhone: string;        // E.164, where the message text goes
  notifyEmail?: string;
  emergencyDefinition?: string;
  bookingMode: "message" | "book";  // "book" requires claimed site + Google connected
};
```

`escalationPhone` and `notifyPhone` must be validated E.164 at write time. The current free-text
`forwardTo` field ("e.g. text 480-555-1234, or email owner@business.com") is unparseable and must be
replaced, not reused.

> **⚠️ 2026-07-22 — what shipped differs.** Voice configuration lives in
> `forge_sites.receptionist_config` (jsonb) — the `site_agents` table from `AGENT_PLATFORM.md`
> was never created. All fields are optional (a half-filled config still resolves);
> `deriveRouting()` in `src/lib/voice-tenant.ts` prefers structured `escalationPhone`/`notifyPhone`
> (normalized E.164 at write time in `saveReceptionistSetup`) and falls back to parsing a phone out
> of the legacy free-text `forwardTo` — kept as a fallback, not replaced. The actual shape is
> `VoiceConfig` in `src/lib/voice-tenant.ts`. See the status addendum.

---

## New files

### `src/lib/voice-tenant.ts`
```ts
export type VoiceTenant = {
  siteId: number; slug: string; businessName: string;
  timezone: string; ownerUserId: string | null;
  config: VoiceConfig;
};

/** The number that was CALLED, from a Retell payload. Reads call.to_number. */
export function calledNumber(body: unknown): string | undefined;

/** Resolve the business from an inbound Retell payload. Null if unknown/inactive. */
export async function siteFromCall(body: unknown): Promise<VoiceTenant | null>;

/** Direct lookup, for the inbound webhook and tests. */
export async function tenantByNumber(e164: string): Promise<VoiceTenant | null>;
```
Single join: `voice_lines` → `forge_sites` → `site_agents`. One query, PK-indexed.

> **Shipped additions (2026-07-22):** `export function deriveRouting(config): { escalateTo?, notifyTo? }`
> — the single source for routing destinations; the portal Knowledge page imports it so display
> never diverges from runtime. `VoiceTenant` also carries `lineNumber`, `lineStatus`, `notifyTo`,
> `escalateTo`, `bookingEnabled`.

### `src/lib/voice-vars.ts`
```ts
/** Everything the shared prompt interpolates. ALL VALUES MUST BE STRINGS. */
export function buildDynamicVariables(t: VoiceTenant): Record<string, string>;
```
Emits: `business_name`, `greeting`, `services`, `service_area`, `hours_text`, `faq_text`,
`do_not_say`, `escalation_phone`, `emergency_definition`, `booking_enabled` (`"true"`/`"false"`),
`timezone_label`.

> **Shipped additions (2026-07-22):** `export const TENANT_DEFAULTS` — the verbatim per-field
> fallbacks; any surface quoting "what she says if unset" must import these, never paraphrase.
> `export function fallbackVariables()` — safe generic set for unknown numbers.

### `src/app/api/voice/inbound/route.ts`
Retell inbound webhook. Resolve tenant by called number → return dynamic variables.
**Unknown number must return a safe generic fallback, never a 500** — a 500 here means the caller
gets nothing. Bearer-gated with `voiceAuthed`.

### `src/app/api/voice/message/route.ts` — **the tier-1 product**
The `take_message` tool. Resolve tenant → insert a `calls` row (`disposition='message'`) → SMS the
owner via `src/lib/sms.ts` → set `notified_at`. Returns a spoken confirmation.
**Only return `ok: true` if the notification actually sent** — do not repeat the
`voice/support` bug where the caller is told the message went through when it didn't.

### `src/app/api/voice/site-availability/route.ts` and `site-book/route.ts`
Tenant-scoped booking. Resolve tenant → `getBookableSiteById` → `ownerAccessToken` →
`availableSlots` / `bookForSite`. Spoken labels rendered **in the site's timezone**, not Pacific.
Gate on `config.bookingMode === "book"`; otherwise fall through to `take_message`.

### `src/app/api/voice/webhook/route.ts`
Retell `call_ended` + `call_analyzed`. Upsert the `calls` row on `retell_call_id` (idempotent).
Persists duration, transcript, summary, recording URL, disposition.

### `src/app/api/twilio/voice/failed/route.ts`
Dial-status callback. On any non-`completed` status, return TwiML dialing the business's real number.

### `scripts/retell/receptionist-config.mjs`
The shared receptionist prompt, written entirely against `{{variables}}`. **Separate file from
`agent-config.mjs`** — Ivy stays exactly as she is. Tools: `take_message`, `check_job_availability`,
`book_job`, `transfer_to_human` (destination = `{{escalation_phone}}`).

**Deliberately excluded: `identify_caller`, `verify_code`, `verify_callback_code`.** Those are TBJ
sales tools; including them leaks the prospect database to customers' callers.

### `scripts/retell/provision-line.mjs`
`--site <id> --area-code <nnn>`: buy a Retell number → point it at the shared agent → set the inbound
webhook → insert `voice_lines` → set `site_agents.status='active'`. Idempotent.

---

## Modified files

| File | Change |
|---|---|
| `src/lib/site-booking.ts` | Add `getBookableSiteById(siteId)` alongside the slug version. Move `OPEN_HOUR`/`CLOSE_HOUR`/`OPEN_DAYS`/`SITE_SLOT_MIN` from module constants into per-site config. **Fail closed** on the `stillFree` recheck. |
| `src/lib/google-oauth.ts` | `listCalendarEvents` returns `null` on error instead of `[]`, so callers can distinguish "no events" from "couldn't check." Update both call sites to treat `null` as busy. |
| `src/app/api/twilio/voice/route.ts` | Add `action="/api/twilio/voice/failed"` + `method="POST"` to the `<Dial>`. |
| `src/lib/sms.ts:148-154` | `verifyTwilioSignature` → `return false` when no auth token. **Confirm `TWILIO_AUTH_TOKEN` is set in Vercel first** — this turns a silent hole into a hard 403. |
| `src/app/(frontend)/portal/actions.ts` | `saveReceptionistSetup` writes to `site_agents.config` with validated E.164 fields, not the free-text blob. |
| `mcp-server/tbj-mcp.mjs` | Add `provision_voice_line`, `list_calls`, `get_call`. Bump version, call `audit()`. |

> **Row-by-row status, 2026-07-22:**
> - `site-booking.ts` — **OPEN**: `getBookableSiteById` never needed (tenant resolves by slug via
>   `getBookableSite`); per-site hours still pending (module constants).
> - `google-oauth.ts` — ✅ done.
> - `twilio` route — ✅ done.
> - `sms.ts` — **OPEN**: still returns `true` with no auth token (`sms.ts:153`); confirm
>   `TWILIO_AUTH_TOKEN` in Vercel before flipping.
> - portal `actions.ts` — ✅ done, but into `forge_sites.receptionist_config` (`site_agents` was
>   never created); E.164 normalized on write.
> - `mcp-server` — ✅ `list_calls`/`get_call`; `provision_voice_line` deliberately omitted —
>   provisioning spends money and stays human/drainer-triggered.

---

## The call flow, end to end

```
Caller dials the business's real number
  → carrier conditional forwarding (no-answer, 20-25s) → our Retell number
  → Retell receives the call
  → Retell POSTs /api/voice/inbound  { call: { to_number, from_number } }
      → tenantByNumber(to_number) → VoiceTenant
      → return buildDynamicVariables(tenant)
  → shared Receptionist agent runs with {{business_name}}, {{services}}, {{escalation_phone}}…
  → agent calls a tool → /api/voice/message | site-availability | site-book
      → siteFromCall(body) re-resolves the tenant from call.to_number
  → call ends
  → Retell POSTs /api/voice/webhook (call_ended, call_analyzed)
      → upsert calls row → portal has something to show
```

**Tenancy is resolved from `call.to_number` at every step.** No per-customer URLs, no per-customer
agents, no hardcoded identity anywhere.

---

## Build order

**Stage 1 — routing and safety (no customer needed to test)** — ✅ **DONE 2026-07-19**
1. ✅ `voice_lines` + `calls` tables (`scripts/db/2026-07-19-voice-tables.sql`), `db:pull` clean
2. ✅ `voice-tenant.ts` + `voice-vars.ts` — verified live against the DB: active line resolves,
   unknown number returns the safe fallback, paused line stops resolving
3. ✅ `/api/twilio/voice/failed` + the `action=` attribute
4. ✅ `listCalendarEvents` returns `null` on failure; `availableSlots` offers nothing and
   `bookForSite` refuses, rather than double-booking during a Google outage

> **Finding while building #3 — no automatic failover exists for customers.** Retell's phone-number
> object has `inbound_agents` (weighted routing) and **no failover-to-a-number field**. Because
> tenant identity comes from the dialled Retell number, customers forward their carrier straight to
> Retell and Twilio is never in their path — so the TwiML fallback protects **TBJ's own line only**.
>
> Customer protection is therefore: conditional forwarding (their phone rings first, so an outage
> degrades to the pre-product state rather than killing a working line), the `##61#` kill switch,
> and monitoring. **If genuine automatic failover is ever required, it means putting a Twilio number
> in front of each customer and reaching Retell over SIP so tenancy survives the hop** — a real
> architecture change, not a patch. Not needed at current scale.

**Stage 2 — the shared agent** — ✅ **DONE** (the doc-verification gate above resolved while building)
5. `receptionist-config.mjs` with `{{variables}}`
6. `/api/voice/inbound`
7. `/api/voice/message` + SMS notification
8. `provision-line.mjs`
✅ *Done when:* **the demo line works** — a fictional plumbing company, provisioned by script,
answers a real call and texts a real message. This is also the sales demo from
[`SALES_RUNBOOK.md`](./SALES_RUNBOOK.md).

**Stage 3 — visibility** — ✅ **DONE** (the `/portal/dashboard` scoreboard shipped too;
`provision_voice_line` deliberately NOT exposed as an MCP tool — it spends money, see
`tbj-mcp.mjs`)
9. `/api/voice/webhook` → `calls` persistence
10. `/portal/calls` list + detail, `/portal` hero stat row
11. MCP tools
✅ *Done when:* a customer logs in the day after going live and sees what happened.

**Stage 4 — booking** — ◐ **routes shipped 2026-07** (`site-availability` + `site-book`;
`site-book` writes `calls.disposition='booked'`, the scoreboard's jobs-booked counter) —
REMAINING: add `check_job_availability`/`book_job` to `receptionist-config.mjs`'s tool list
(currently message-only), per-site hours (`site-booking.ts` constants)
12. `site-availability` + `site-book`, per-site hours, timezone at site creation
✅ *Done when:* a call books onto the customer's own calendar in their own timezone.

---

## Dependency worth knowing before you sell booking

`bookForSite` requires `claimedByUserId` **and** a Google Calendar OAuth grant from the owner. A
plumber must sign into Google and approve calendar access. That's real friction, and it's a second
reason (beyond the missing code path) to sell **message-taking first** and treat booking as the
tier-2 upgrade.

Message-taking has no such dependency — it needs only a phone number.

---

## Deployment order — get this wrong and every call breaks silently

Retell's inbound-webhook auth mechanism is **not documented**, so we gate both Retell-called endpoints
with a secret in the URL we register (`?k=<VOICE_WEBHOOK_KEY>`), compared in constant time. Retell
POSTs to exactly the URL we configure, so this works without knowing their signature scheme.

**The routes and the registered URLs must stay in lockstep.** If `VOICE_WEBHOOK_KEY` is set in the
app's environment but a number was registered with a keyless URL, every inbound call is rejected and
the caller hears the **generic fallback greeting instead of the business** — a silent, total product
failure that presents as "the AI forgot who it works for."

Both routes therefore **warn-and-allow when the key is unset** — a half-configured deploy must never
drop live calls. That means an unset key leaves both endpoints open, so it is a state to pass through
quickly, not to sit in.

**Correct order:**

1. Generate a long random `VOICE_WEBHOOK_KEY`.
2. Set it in `.env.local` **and** Vercel (all environments).
3. Deploy the app.
4. Re-run `provision-line.mjs --apply` for **every existing live line** so their registered URLs pick
   up the key. Same after any rotation.

Required env before going live:

| Var | Why |
|---|---|
| `VOICE_WEBHOOK_KEY` | Gates `/api/voice/inbound` and `/api/voice/webhook` |
| `STRIPE_PRICE_SETUP` | `setupPriceId()` no longer falls back to the $300 build price — **checkout is blocked until this exists**, deliberately, because the old fallback quoted $250 and charged $300 |
| `STRIPE_PRICE_{ANSWER,RESPOND,RECOVER}` (+`_ANNUAL`) | The new tiers. Created by `scripts/stripe/setup-products-tiers.mjs --apply` |

> **⚠️ 2026-07-22 — tier envs superseded.** The sellable tiers are
> `STRIPE_PRICE_{WEBSITE,VOICE,COMPLETE}` (+`_ANNUAL`) — $99/$299/$999. The old
> ANSWER/RESPOND/RECOVER price envs are legacy, kept only for `planKeyForPrice()` resolution of
> historic subscriptions (`src/lib/plans.ts`).

## Out of scope

Per-customer prompt *editing* (the shared prompt plus variables covers it) · SMS agent · estimate
follow-up, seasonal, reactivation, reviews (all blocked on the ingress layer in
`AGENT_PLATFORM.md` §D) · automated call-testing for prospecting (blocked on legal review).

---

## Status addendum — 2026-07-22

This spec was written 2026-07-19 as "ready to build." Stages 1–3 shipped and Stage 4's routes
shipped within days; the body above is kept as the historical record (the dated banners inline
point back here). Current truth, section by section:

- **Wire format — verified while building.** Retell sends the called number as `call.to_number`
  (some events use a flat body; `calledNumber()` in `src/lib/voice-tenant.ts` handles both),
  variables come back as `{ call_inbound: { dynamic_variables } }`, and `/api/voice/inbound` is
  live (gates on `?k=VOICE_WEBHOOK_KEY`, warns-and-allows when unset).
- **Config storage.** Lives in `forge_sites.receptionist_config` (jsonb) — `site_agents` was never
  created. All `VoiceConfig` fields are optional; `deriveRouting()` prefers structured
  `escalationPhone`/`notifyPhone` (E.164-normalized at write in `saveReceptionistSetup`) and falls
  back to parsing the legacy free-text `forwardTo` — kept as a fallback, not replaced.
- **Extra load-bearing exports.** `voice-tenant.ts` `deriveRouting()` and `voice-vars.ts`
  `TENANT_DEFAULTS` are shared sources consumed by `/portal/knowledge`, so the portal shows exactly
  what runtime will dial/text and the verbatim fallback lines the agent speaks; `voice-vars.ts`
  also exports `fallbackVariables()` for unknown numbers. `VoiceTenant` additionally carries
  `lineNumber`, `lineStatus`, `notifyTo`, `escalateTo`, `bookingEnabled`.
- **Stage 2 — ✅ DONE.** `receptionist-config.mjs`, `/api/voice/inbound`, `/api/voice/message`,
  `provision-line.mjs` (dry-run default; `--apply` is the only thing that spends).
- **Stage 3 — ✅ DONE.** `/api/voice/webhook` upserts calls idempotently; `/portal/calls` exists
  (plus the `/portal/dashboard` scoreboard); MCP `list_calls` + `get_call` shipped.
  `provision_voice_line` is deliberately NOT an MCP tool — it spends money and stays
  human/drainer-triggered.
- **Stage 4 — ◐ routes shipped.** `site-availability` + `site-book` are live: `site-book` gates on
  `tenant.bookingEnabled`, books in the site's timezone, and stamps `calls.disposition='booked'`
  (which the portal's jobs-booked tile counts). REMAINING: the shared agent's tool list is still
  message-only (`take_message` + `transfer_to_human` in `receptionist-config.mjs`) — add
  `check_job_availability`/`book_job`; hours are still module constants in `site-booking.ts`, not
  per-site.
- **Modified files + env tables** — see the dated row-by-row notes under each table above.
