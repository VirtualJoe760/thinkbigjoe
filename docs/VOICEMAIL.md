# Ringless voicemail (Drop Cowboy)

A third outreach channel alongside SMS + email: drop a **pre-recorded voicemail straight into a
prospect's inbox without ringing their phone**, then follow up with the first-touch text. The
"call, then follow up with a text" opener. Callbacks route to the ThinkBigJoe number → **Ivy**.

**The text is sent on a deliberate ~60s delay — NOT at the same instant as the drop.** A voicemail
deposits onto the carrier's voicemail server and the phone is notified seconds-to-minutes later
(visual voicemail lags most), so an immediate text means *"did you get my voicemail?"* arrives
before the voicemail does. Instead, `dropToSite` sets `forge_sites.vm_text_pending` + `vm_dropped_at`,
and the **timed sender** (`POST /api/leads/vm-text-send`, launchd `com.thinkbigjoe.vmtextsend`,
~every 60s) sends the text once **≥ `VM_TEXT_DELAY_SECONDS` (default 60)** have passed since the drop.
Text choice: if the Drop Cowboy **delivery webhook** logged `voicemail_failed` for that lead, it uses
the non-VM text (`composeVoicemailFallbackSms` — they never got a voicemail); otherwise the
VM-referencing text (`composeVoicemailFollowupSms`). The delivery webhook only *records* status now;
it does not send, so the 60s wait is always honored. `sendPendingVmText` claims the pending flag
atomically, so concurrent cron ticks can never double-send.

**Rate guard:** Drop Cowboy rejects a 4th drop to the same contact within 3 days ("Too Many
Attempts", 4013). `dropToSite` counts `voicemail_dropped` events for the lead in the trailing 3 days
and refuses a 4th. RVM delivers to **traditional carrier voicemail boxes, not VOIP** (a Google Voice
number will *ring* instead of dropping) and runs ~60–70%, not 100% — per Drop Cowboy support.

## The three layers (per the full-stack rule)

1. **UI** — a **📞 Drop voicemail + text** button on each lead's card
   (`src/app/(frontend)/command/leads/leads-crm.tsx` → `dropLeadVoicemail` action). Voicemail
   events show on the lead timeline (`voicemail` kind) via `getLeadHistories`.
2. **Send path** — `src/lib/dropcowboy.ts` (`dropVoicemail`, the raw Drop Cowboy API client) +
   `src/lib/voicemail-outreach.ts` (`dropToSite` — drop + log + ARM the delivery-gated follow-up
   text; `sendPendingVmText` actually sends it later — shared by every caller). Single-drop endpoint
   `POST /api/dropcowboy/drop` ({siteId, text?}, Bearer `CRON_SECRET`) backs the MCP tool. Delivery
   status → `POST /api/dropcowboy/webhook?token=…` (which triggers the follow-up text).
3. **Batch / schedule** — `POST /api/forge/send-voicemail-outreach` (Bearer `CRON_SECRET`):
   worst-first fresh prospects, `?dry=1` preview, `?batch=N` manual kickoff, else weekday-window
   drip like the SMS sender. **Not auto-scheduled yet** — verify a live drop first, then add a cron.
   MCP tool: `drop_voicemail` ({site_id, text?}) in `mcp-server/tbj-mcp.mjs` (v2.23.0).

## How the API works

`POST https://api.dropcowboy.com/v1/rvm`, auth via `x-team-id` + `x-secret` headers. We send a
`recording_id` (Joe records one voicemail once in the Drop Cowboy dashboard), a registered
`brand_id` (Trust Center — TCPA), the `phone_number` (E.164), `forwarding_number` (callbacks →
the TBJ number → Ivy), a `foreign_id` of `site-<id>` (echoed on the delivery webhook so status
lands on the right lead), and our `callback_url`. TTS (`voice_id` + `tts_body`) is also supported
but we chose a recorded message.

## Setup (env)

Set in Vercel + `.env.local` (drops are a **no-op** until the three core vars are present —
`isDropCowboyConfigured` = team id + secret + brand id + (recording id or audio url)):

| Var | What |
|---|---|
| `DROPCOWBOY_TEAM_ID` | Account team id (Settings → API) |
| `DROPCOWBOY_SECRET` | Account API secret |
| `DROPCOWBOY_RECORDING_ID` | The recorded voicemail's GUID (Recordings tab) |
| `DROPCOWBOY_BRAND_ID` | **Required.** Trust Center brand GUID (the approved "JPS & Company LLC" brand). Drop Cowboy will NOT deliver without a trusted brand — a drop returns `status:"queued"` but never sends. BYOC does NOT bypass this. |
| `DROPCOWBOY_FORWARDING_NUMBER` | E.164 number callbacks route to — set to the TBJ number so callbacks reach Ivy |
| `DROPCOWBOY_POOL_ID` | *(optional)* private caller-id number pool |
| `DROPCOWBOY_WEBHOOK_SECRET` | *(optional)* token appended to the callback URL + verified on delivery webhooks (falls back to `CRON_SECRET`) |

**A trusted brand IS required for delivery** (learned the hard way): drops without `brand_id` come
back `status:"queued"` and silently never deliver. Use the approved Trust Center brand. BYOC covers
the carrier/numbers, not the sender brand — they're separate requirements.

## Rollout

1. Create the Drop Cowboy account, **register a brand** (Trust Center), record one voicemail, grab
   the recording id + brand id + team id + secret → set the env vars.
2. **Dry run:** `POST /api/forge/send-voicemail-outreach?dry=1` (Bearer `CRON_SECRET`) — see the
   eligible worst-first list, no sends.
3. **One live test drop** to Joe's own number via `POST /api/dropcowboy/drop` before any batch.
4. Once the recording sounds right, batch with `?batch=N`, then add a scheduled cron.

## Compliance

Ringless voicemail is TCPA-sensitive. Drop Cowboy handles brand registration, DNC scrubbing, and
number pooling; we keep the same STOP/opt-out discipline as SMS — the batch route excludes
`outreach_status = 'opted_out'` and AI-paused leads, and delivery failures/DNC ping Telegram.

## Reading delivery results (webhook)

Drop Cowboy POSTs each drop's outcome to `/api/dropcowboy/webhook` → logged to `activity_log` as
`voicemail_delivered` / `voicemail_failed` (raw payload in `metadata.raw`). Common failure reasons:

| Code | Reason | Meaning |
|---|---|---|
| 4000 | VoiceMail NotDetected | Call placed but no voicemail box detected to deposit into (phone answered, VM not set up, or timing). |
| 4013 | Too Many Attempts | Repeat drops to the SAME number are capped — don't hammer one number when testing. |

The payload also includes `network` (carrier/line-type) — a `wireless` MNO like VERIZON confirms
the number can receive RVM.
