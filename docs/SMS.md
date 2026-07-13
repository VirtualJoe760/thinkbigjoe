# SMS — Twilio A2P texting

ThinkBigJoe sends and receives SMS through **Twilio**, on Joe's **existing A2P 10DLC
registration**. No separate brand/campaign was created — TBJ reuses the same setup chatRealty
uses, which is compliant because **both businesses are the one `jsardella` LLC** (one legal entity).

## What's registered (reused, not new)

| Component | Value | Why reusable |
|---|---|---|
| **Brand** | `jsardella` — Registered, **Low Volume Standard** (T-Mobile 2,000–200,000/day) | It's the LLC both businesses share |
| **Campaign** | Verified, use case **"Low Volume Mixed"** (notifications + marketing + customer care) | "Mixed" + a generic description covers TBJ's texts too |
| **Messaging Service** | `MG16903417c850629410adc09b63f7788f` | What we send through; picks the sending number + handles STOP/HELP |

**Opt-out — two paths (`src/lib/sms.ts`):**
- **Hard STOP** (`isOptOut`: stop/stopall/unsubscribe/cancel/end/quit) — the carrier keyword. Twilio's
  **Advanced Opt-Out** auto-suppresses the number *and records it against sender metrics*. We only
  *detect* it in the webhook to label + move the lead to Declined.
- **Soft "No thanks"** (`isSoftOptOut`: "no thanks"/"no thank you"/"not interested"/"remove me"/…) —
  our **internal** opt-out. It never hits Twilio's opt-out records. The inbound webhook suppresses
  the lead ourselves (`markProspectOptedOut(phone, {via:'soft'})` → `outreach_status='opted_out'`,
  `lead_stage='declined'`) and sends **one** courtesy confirmation. This is what our **outreach copy
  advertises** ("reply 'No thanks' and I'll stop") so prospects use the soft path instead of the
  hard STOP. STOP still works as the legally-required backstop (documented in the privacy policy +
  signup consent disclosure); we just don't put "Reply STOP" at the end of every marketing text.

Either path fully stops outreach, and the AI agent won't re-engage an `opted_out` contact.

## The layers

1. **Send** — [`src/lib/sms.ts`](../src/lib/sms.ts): `sendSms(to, body)` POSTs to the Twilio
   Messages API using the Messaging Service SID (plain REST + fetch, no SDK). No-ops with a warning
   until the env vars are set, exactly like `email.ts` / `telegram.ts`.
2. **Two-way SMS relay** — [`/api/sms/inbound`](../src/app/api/sms/inbound/route.ts): the inbound
   webhook (verifies `X-Twilio-Signature`, logs to `activity_log`, pings Telegram). See
   **Conversation mapping** below.
3. **Call forwarding** — [`/api/twilio/voice`](../src/app/api/twilio/voice/route.ts): when someone
   **calls** the number, returns TwiML that `<Dial>`s the Retell AI receptionist (`VOICE_FORWARD_TO`,
   default **+1 480-764-2121** = "Ivy"). The caller's number passes through as caller ID so Retell's
   identify flow still works.
4. **Agent tool** — `send_sms` in [`mcp-server/tbj-mcp.mjs`](../mcp-server/tbj-mcp.mjs) (v2.21.0+):
   lets Venus / the outreach agent text a lead. Calls `audit()`. Same Twilio env vars.

## Conversation mapping (two-way relay)

There's **one Google Voice number** (Joe's, `SMS_FORWARD_TO`) but many leads, and every forward
arrives in a single GV thread (all from the TBJ Twilio number). To let Joe reply to a *specific*
lead, each conversation gets a short code — the `sms_conversations` row id in base36, shown as
`#a3`.

- **Lead → Joe:** the inbound text is forwarded to GV tagged with its code, e.g.
  `📱 #a3 — text from +1480…: <body>  ↩︎ Reply "#a3 your message" to answer…`.
  The `sms_conversations` row is upserted (keyed on `contact_phone`, `last_inbound_at` bumped).
- **Joe → lead** (his GV texts the TBJ number, so `From === SMS_FORWARD_TO`):
  - `#a3 your message` → relayed to conversation #a3's contact.
  - `your message` (no code) → relayed to the **most-recent inbound** conversation; Joe gets a
    one-line confirm naming the number + code.
  - `#list` (or `who` / `threads`) → Joe gets the active threads and their codes.
- **Sticky sender:** Twilio's Messaging Service keeps each lead seeing one consistent TBJ number.
- **`sms_conversations` table** (created in DB, introspected into `schema.ts` via `npm run db:pull`):
  `id, contact_phone (unique), last_inbound_at, last_outbound_at, last_direction, created_at,
  updated_at`. Helpers `encodeThreadCode` / `parseThreadCode` live in `src/lib/sms.ts`.

Outbound relays are logged to `activity_log` (`sms_outbound`), inbound as `sms_inbound` /
`sms_opt_out`. A raw STOP from a lead is labeled (not offered as a thread to reply to).

**Per-contact AI pause.** Each contact has a `forge_sites.ai_paused` flag. When on, the inbound
webhook still logs + forwards the reply to Joe but **skips the agent auto-reply** — Joe handles that
conversation himself (typical once the AI has warmed the lead up). Toggle it from the **AI on / AI
paused** button in the [Messages](../src/app/(frontend)/command/messages) thread header
(`setContactAiPaused` action); paused contacts show a ⏸️ in the inbox list. Automated first-touch
outreach also skips `ai_paused` contacts. Flip it back on to let the AI resume follow-ups.

## Priority callback codes (text → warm call → Joe)

To give a hot lead a direct line to Joe without paying to cold-call, mint a **callback code**
(`issue_callback_code` MCP tool) and drop the returned line into your text:
"Call 760-262-0014 and give code 7788 to reach Joe directly." When they call, Ivy verifies the code
and transfers them to Joe. Full flow + the `callback_codes` table live in
[`VOICE.md`](VOICE.md#priority-callback-codes-cheap-warm-lead-fast-lane).

## Env vars

Set in **`.env.local`** (local + the MCP server reads it) **and in Vercel** (the webhook + send
lib run there). Only the two secrets are missing after setup — the Messaging Service SID and the
forward number are pre-filled.

| Var | Value | Secret? |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | `AC…` (Console → Account → API keys & tokens) | semi |
| `TWILIO_AUTH_TOKEN` | the account auth token — **also verifies inbound webhooks** | **yes** |
| `TWILIO_MESSAGING_SERVICE_SID` | `MG16903417c850629410adc09b63f7788f` | no |
| `SMS_FORWARD_TO` | `+17602976966` (Joe's Google Voice — inbound texts relay here) | no |
| `VOICE_FORWARD_TO` | `+14807642121` (Retell AI line — inbound calls ring here; optional, this is the default) | no |

## One-time Twilio Console wiring

**SMS** — in **Messaging → Services → the "Low Volume Mixed" service → Integration**, set
**"A message comes in"** to:

```
https://thinkbigjoe.com/api/sms/inbound   (HTTP POST)
```

**Voice** — on the **phone number itself** (Phone Numbers → Manage → the number in that Messaging
Service → Voice Configuration → "A call comes in"), set (HTTP POST):

```
https://thinkbigjoe.com/api/twilio/voice
```

That routes texts to the relay and calls to the AI receptionist. (Changing these is an
account-settings change — do it deliberately.)

## Testing

- **Inbound/forward:** text the TBJ number from a phone → it should arrive at 760-297-6966 within
  seconds, show in `/command` activity, and ping Telegram. `GET /api/sms/inbound` returns
  `{ ok: true }` as a liveness check.
- **Outbound:** call the `send_sms` MCP tool, or `sendSms()` from a route. A bad number / opted-out
  recipient surfaces Twilio's error message.
- **Reply-through:** from Joe's GV, reply `#a3 hi there` (or just `hi there` for the latest texter);
  the lead should receive it from the same TBJ number. `#list` returns the active threads.
- **Call forwarding:** call the TBJ number → it should ring the Retell receptionist.
  `GET /api/twilio/voice` returns `{ ok: true, forwardsTo }`.

## Notes / gotchas

- **Signature check needs the real public URL.** Behind Vercel, `req.url` is internal, so the
  webhook rebuilds the URL from `x-forwarded-host`/`x-forwarded-proto`. If you move the endpoint or
  put it behind a different host, the configured Twilio URL must match exactly or every request 403s.
- **Same legal entity is the whole basis for reuse.** If TBJ ever needs to text under a *different*
  entity, it needs its own brand/campaign — don't stretch this one.
- **Graduating to a dedicated campaign** (cleaner at higher volume): keep the `jsardella` brand,
  register a new "Mixed" campaign + Messaging Service for TBJ, and swap `TWILIO_MESSAGING_SERVICE_SID`.
  No code change needed.
