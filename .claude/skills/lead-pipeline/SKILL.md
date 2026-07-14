---
name: lead-pipeline
description: Run the ThinkBigJoe acquisition funnel — approve previews into leads (the human gate), then work them with the voicemail-drop → follow-up-text sequence and email outreach. Use when Joe wants to approve more leads, grow/unblock the lead list, check why outreach is stalled, change the daily send pace, or fire a voicemail/SMS/email batch. Do NOT use for building or fixing website templates (that's forge-templates) or for inbound web-form leads.
argument-hint: [approve leads | check the funnel | run outreach | change the pace]
---

# Working the lead pipeline

One Neon DB, one table does almost all of this: **`forge_sites`**. A "lead" is not a row in the
`leads` table — `leads` is the *inbound* web-form/booking table. **A lead is a `forge_sites` row
with `marketing_approved_at` set.** Get this backwards and every query you write will be wrong.

**The chain:**
`lead-engine.mjs` (Apify, ≤$25/mo) → `status='discovered'` → `preview-engine.mjs` (daily wave,
one ~$0.0002 Gemini call, mints `claim_code`, 14-day expiry) → **`approveForMarketing()` — the human
gate** → LEAD → outreach (**voicemail drop → follow-up text ~60s later**, and/or email) → owner
enters the claim code → **the claim triggers the real forge build** → built → paid.

Start every session with the snapshot:

```bash
node scripts/funnel.mjs     # read-only: discovered / awaiting approval / leads / reachability / caps / last 24h
```

Source of truth: `docs/SHOWROOM.md` (the sell-first funnel), `docs/VOICEMAIL.md`, `docs/SMS.md`,
`docs/AUTH.md` (email + bounce/reply handling).

## ⚠️ Read before sending anything

- **`?batch=N` bypasses the daily cap, the sending window, AND the 8-minute gap.** In
  `send-voicemail-outreach/route.ts:92` the slice ignores `room` entirely when `batch > 0`. A stray
  `?batch=50` blasts 50 real voicemails/texts at once, off-hours. This has already happened —
  41 drops + 43 texts landed on 2026-07-13 against a configured cap of 15/day.
- **The A2P campaign is SHARED with Joe's other business (chatRealty), same LLC.** Texts go through
  Messaging Service `TWILIO_MESSAGING_SERVICE_SID` (`MG1690…`) on a *Verified* "Low Volume Mixed"
  campaign. Carrier complaints against TBJ traffic land on the brand chatRealty also depends on.
  Respect the pace; never mass-fire.
- **Voicemail + SMS cost real money** (Drop Cowboy per drop, Twilio per segment). Email is free-ish
  (Zoho SMTP).
- **Approval is a human gate on purpose.** Never auto-approve the whole discovered table because a
  number looks low — approve in bounded, reviewed batches.
- **Sending is normally self-driving.** launchd fires the senders every 20 min. If you want more
  volume, the lever is **the approval gate and the daily goal**, not a manual batch.

## Approving previews into leads

The gate is `approveForMarketing(id)` (`src/app/(frontend)/command/actions.ts:793`) — it sets
`marketing_approved_at = now()` and logs `forge_marketing_approved`. It refuses only `denied` /
`deleted` rows. A preview isn't required at approval time: outreach simply waits until the preview
engine fills one in.

- **Normal batches → the UI.** `/command/prospects` → the **Review** bucket (also
  `/command/sites`). This is the reviewed path; prefer it.
- **Large backfills → SQL.** Bounded and ordered by quality (weakest incumbent web presence =
  best prospect). Always `SELECT` first, then `UPDATE` the same predicate:

```sql
-- Mirror the action's guard. Cap it; don't approve the world in one shot.
UPDATE forge_sites SET marketing_approved_at = now(), updated_at = now()
WHERE id IN (
  SELECT id FROM forge_sites
  WHERE marketing_approved_at IS NULL
    AND status NOT IN ('denied','deleted')
    AND preview IS NOT NULL              -- drop this line to approve ahead of the preview engine
    AND (phone IS NOT NULL OR email IS NOT NULL)
  ORDER BY created_at ASC
  LIMIT 100
);
```

There is **no MCP tool that approves** — deliberately human-gated. If you bulk-approve via SQL, the
`activity_log` entry the action would have written is missing; note it in the run summary.

**Approving does not send anything.** It only makes rows *eligible*. The senders below pick them up
on their own schedule.

## Working leads: voicemail drop → text (the volume channel)

This is the live sequence, and it's where the leads actually are: of the untouched leads, ~663 are
phone-reachable vs ~108 emailable.

1. **`com.thinkbigjoe.voicemailoutreach`** (launchd, 20 min) → `scripts/voicemail-outreach-send.sh`
   → `/api/forge/send-voicemail-outreach` → `dropToSite()` (Drop Cowboy ringless). Logs
   `voicemail_dropped`, arms `vm_text_pending` + `vm_dropped_at`.
2. **`com.thinkbigjoe.vmtextsend`** (launchd, **60 s**) → `/api/leads/vm-text-send` →
   `sendPendingVmText()`. Waits `VM_TEXT_DELAY_SECONDS` (60) so the voicemail deposits *first*, then:
   - delivery **confirmed** → the "did you get my voicemail?" text;
   - delivery **failed**, or unconfirmed past `VM_TEXT_CONFIRM_GRACE_MIN` (5) → a **neutral** "tried
     to reach you" text. *We never claim a voicemail we can't confirm landed.*
   - It logs **`sms_outreach_sent`** (`src/lib/voicemail-outreach.ts:132`) — so texts show up under
     the SMS event even though SMS *first-touch* is a separate channel. Don't misread this.

**Eligibility** (`send-voicemail-outreach/route.ts:41`): approved · has `phone` · has `claim_code` ·
has `live_url` or `slug` · not `deleted` · unclaimed · `ai_paused = false` · not `opted_out` · and
**never already voicemailed *or* SMS-first-touched** (deduped through `activity_log` on
`metadata->detail->siteId`). VM and SMS first-touch are mutually exclusive — a lead gets one or the
other, never both.

**Order:** worst `google_rating` first, then fewest reviews, then newest — the weakest web presence
is the easiest sell.

**Pace:** Mon–Fri 9am–6pm PT · ≥8 min gap · ~1 per 20-min tick · `VOICEMAIL_OUTREACH_DAILY_GOAL`
(**unset → defaults to 15/day**).

```bash
# Always dry-run first — shows eligible count, sent-today, and who's next. Sends nothing.
curl -s -H "Authorization: Bearer $CRON_SECRET" -X POST \
  "https://thinkbigjoe.com/api/forge/send-voicemail-outreach?dry=1" | jq
```

**SMS first-touch** (`/api/forge/send-sms-outreach`, `SMS_OUTREACH_DAILY_GOAL`, same pacing) is the
text-without-a-voicemail path. Its launchd job `com.thinkbigjoe.smsoutreach` is **not currently
loaded**, so first-touch SMS is off; only VM follow-up texts are going out.

## Working leads: email

`com.thinkbigjoe.outreach` (20 min) → `/api/forge/send-outreach` → `sendForgeOutreachEmail`
(Zoho SMTP) with copy from `composeOutreach` (`src/lib/forge-outreach.ts`).

- Requires `status='built'` **and** an `email` — which is why it's slow: most prospects are
  preview-only and phone-only. It runs ~1/day right now, not 15.
- Order is **alphabetical** by business name (`orderBy(forgeSites.businessName)`), not newest-first.
- Cap is `outreach_engine.daily_goal` (a **DB column**, default 15) — not an env var, unlike VM/SMS.
- A permanent 5xx / `EENVELOPE` → `markSyncBounce` sets `outreach_status='bounced'`, **nulls the
  email**, and re-queues for enrichment.

## Changing the pace

| Knob | Where | Default |
|---|---|---|
| Email/day | `outreach_engine.daily_goal` (DB) — `/command/prospects` UI, `updateShowroomEngines()`, or MCP `set_outreach_goal` | 15 |
| Previews/day | `preview_engine.daily_budget` (DB) — same UI, or MCP `set_preview_budget` | 30 |
| Voicemails/day | env `VOICEMAIL_OUTREACH_DAILY_GOAL` (Vercel) | 15 |
| SMS/day | env `SMS_OUTREACH_DAILY_GOAL` (Vercel) | 15 |
| Apify spend | `lead_engine.monthly_budget_usd` (DB) | $25/mo |

Joe has explicitly said **raising the Apify budget is not the lever** — if lead count is low, the
bottleneck is almost always the approval gate, not discovery. Check `funnel.mjs` before touching it.

## When outreach looks stalled

1. `node scripts/funnel.mjs` — is `awaiting_approval` piled up? Then it's the gate, not the senders.
2. `launchctl list | grep thinkbigjoe` — is the job even loaded? Known gaps: **`smsoutreach` is not
   loaded**; **`inboxpoll` exits 127** (command not found), so inbound bounce/reply processing is
   dead. `enrichengine` and `callprepengine` have plists but aren't loaded either.
3. Outside Mon–Fri 9am–6pm PT, every sender no-ops by design — check the clock before debugging.
4. `?dry=1` on any sender endpoint reports `eligible`, `sentToday`, and `dailyGoal` without sending.
5. Zero eligible but plenty of leads? Almost always a **missing `claim_code`** (preview never
   generated) or a missing `email`/`phone` — look at the eligibility predicate, not the sender.

## After changes — keep in sync

- Touched a cron/launchd job, an engine table, or a `/command` surface → update
  `docs/VENUS_UI_MAPPING.md` (UI ↔ MCP tool ↔ cron map) in the same change.
- Changed the VM/SMS/email send mechanics or copy → update `docs/VOICEMAIL.md` / `docs/SMS.md` /
  `docs/AUTH.md`.
- Changed the funnel's stages or the approval gate → update `docs/SHOWROOM.md`.
