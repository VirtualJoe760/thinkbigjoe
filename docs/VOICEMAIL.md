# Ringless voicemail (Drop Cowboy)

A third outreach channel alongside SMS + email: drop a **pre-recorded voicemail straight into a
prospect's inbox without ringing their phone**, then follow up with the first-touch text. The
"call, then follow up with a text" opener. Callbacks route to the ThinkBigJoe number → **Ivy**.

## The three layers (per the full-stack rule)

1. **UI** — a **📞 Drop voicemail + text** button on each lead's card
   (`src/app/(frontend)/command/leads/leads-crm.tsx` → `dropLeadVoicemail` action). Voicemail
   events show on the lead timeline (`voicemail` kind) via `getLeadHistories`.
2. **Send path** — `src/lib/dropcowboy.ts` (`dropVoicemail`, the raw Drop Cowboy API client) +
   `src/lib/voicemail-outreach.ts` (`dropToSite` — drop + log + optional follow-up text, shared by
   every caller). Single-drop endpoint `POST /api/dropcowboy/drop` ({siteId, text?}, Bearer
   `CRON_SECRET`) backs the MCP tool. Delivery status → `POST /api/dropcowboy/webhook?token=…`.
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
`isDropCowboyConfigured` = team id + secret + recording id):

| Var | What |
|---|---|
| `DROPCOWBOY_TEAM_ID` | Account team id (Settings → API) |
| `DROPCOWBOY_SECRET` | Account API secret |
| `DROPCOWBOY_RECORDING_ID` | The recorded voicemail's GUID (Recordings tab) |
| `DROPCOWBOY_BRAND_ID` | *(optional)* Trust Center brand GUID. **Not needed with the Twilio (bring-your-own-carrier) integration** — delivery goes through Joe's own Twilio, which bypasses Drop Cowboy's brand-approval process. Only set it if the account still asks for one. |
| `DROPCOWBOY_FORWARDING_NUMBER` | E.164 number callbacks route to — set to the TBJ number so callbacks reach Ivy |
| `DROPCOWBOY_POOL_ID` | *(optional)* private caller-id number pool |
| `DROPCOWBOY_WEBHOOK_SECRET` | *(optional)* token appended to the callback URL + verified on delivery webhooks (falls back to `CRON_SECRET`) |

**This account uses the Twilio integration** (Joe upgraded it), so brand registration/approval is
handled by his Twilio A2P setup — no Drop Cowboy Trust Center brand needed. `brand_id` is only sent
if `DROPCOWBOY_BRAND_ID` is set.

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
