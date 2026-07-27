# The Dialer — Joe's call sessions on the Boost phone

**No Twilio in the call path.** Calls are placed on Joe's Boost Mobile line (the Note 10); the
dashboard is the brain — queue, script, logging, and the recording→AI-notes pipeline. Cost: $0/min.

## The session — /command/dialer

Mobile-first; run it in the Note 10's browser. The queue is server-built from active leads with
phones (callbacks due first, then call-prep-ready, then oldest-touched; excludes opted-out /
declined / paused / claimed). Per lead: the call-prep card, notes, preview link + claim code, and a
big **Call** button (`tel:` → native dialer). After the call, one tap logs the outcome and
auto-advances:

- **No answer / Voicemail** — logs the touch.
- **Callback** — logs + sets `callback_at` (+note) so the callback-reminders cron picks it up.
- **Interested / Booked** — logs + appends to `contact_notes` (the outreach agent reads these).
- **Not interested** — declines the lead exactly like the call-room button (opted out, visible in
  the Declined queue, never auto-deleted).

Every disposition writes a `dial_call` event → the lead's timeline on /command/leads, and counts as
a call touch in the attempts column.

## Recordings → AI notes

Recording happens **on the phone** (Samsung's built-in call recorder if the firmware has it —
Phone app → ⋮ → Settings → Record calls — else Cube ACR). The phone auto-uploads finished
recordings to the drop-box:

- **Endpoint:** `POST https://thinkbigjoe.com/api/dialer/recording` — multipart `file` field,
  original filename intact (both recorders embed the number: `…+14806439089….m4a`).
- **Auth:** `Authorization: Bearer <DIALER_UPLOAD_KEY>` (its own key; the phone never holds
  CRON_SECRET). 20MB cap.
- **Pipeline:** filename → lead match by phone → audio to Vercel Blob (`dialer/<siteId>/…`) →
  **Gemini listens** and writes `{summary, objections, temperature, next_touch}` → `dial_recording`
  event on the lead timeline (rendered with an audio player) + appended to `contact_notes` so the
  **outreach agent's next follow-up is informed by what was said on the call**. Unmatched numbers
  still store audio + log (nothing dropped silently).

### Phone setup (FolderSync, one-time)
1. Install **FolderSync** (or any app that can POST files via webhook/HTTP).
2. New folderpair: local folder = the recorder's output folder (Samsung:
   `Internal storage/Recordings/Call`; Cube ACR: `CubeCallRecorder/All`).
3. Sync type: upload-only, to a **Webhook/HTTP target**: URL above, method POST, multipart file
   field `file`, header `Authorization: Bearer <DIALER_UPLOAD_KEY>` (key in `.env.local`).
4. Trigger: on file change + Wi-Fi or any network.

### Recording consent
Several states require two-party consent to record (CA, WA, FL, IL, PA, …). AZ + most of the
current pipeline are one-party. Until per-state gating is built, the rule is manual: **don't record
calls to two-party states**, or say "on a recorded line" up front. (Automating the state check on
the queue card is a good later addition.)

## Ownership map
- UI: `src/app/(frontend)/command/dialer/` (page = queue query · client = session · actions =
  disposition logging).
- Drop-box: `src/app/api/dialer/recording/route.ts` (+ `uploadAudio` in `src/lib/blob.ts`).
- Timeline rendering: `dial_call` / `dial_recording` in `getLeadHistories`
  (`src/lib/forge-outreach.ts`) + the audio player in `leads-crm.tsx`.
- Deliberately NO MCP tool / cron: the dialer is an operator surface for Joe, not agent work — the
  agents consume its OUTPUT via `contact_notes` and the timeline.

## Gotcha log
- **Dev server 404s on brand-new routes** ("Server action not found" on multipart POSTs): stale
  `.next` after a production build ran in the same tree — `rm -rf .next` and restart dev.
