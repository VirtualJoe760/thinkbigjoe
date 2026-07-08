# Voice receptionist — the AI that answers the phone

ThinkBigJoe's AI phone agent, and the blueprint for selling it as a per-client service.

## What it is

A [Retell](https://retellai.com) voice agent backed by Claude. Retell handles telephony +
speech; the "brain" is a Retell LLM with a system prompt + **custom tools** that call our own
webhooks. Provisioned by [`scripts/retell/create-tbj-agent.mjs`](../scripts/retell/create-tbj-agent.mjs)
(also the blueprint for Path A per-client provisioning).

- **Model:** `claude-4.5-sonnet` · **Voice:** an ElevenLabs professional voice.
- **Env** (in `.env.local` / Vercel): `RETELL_API_KEY`, `RETELL_WEBHOOK_SECRET` (bearer that
  protects every `/api/voice/*` route — see `voiceAuthed()` in `src/lib/voice-booking.ts`),
  and optionally `VOICE_WEBHOOK_BASE` (defaults to `https://thinkbigjoe.com`).
- **Live number:** **+1 (480) 764-2121** — provisioned and bound as the receptionist's
  `inbound_agents`, so calling it reaches the agent (i.e. the current claim-concierge flow).

## The A–Z pipeline the receptionist lives in

A caller is almost always somewhere in this lifecycle — the agent's job is to know where they
are and move them one step forward. End to end:

1. **Discovery** — the prospector finds local businesses (Apify Maps) → `forge_sites` (`discovered`).
2. **Enrichment** — owner name, email, socials, + call-prep (reviews, talking points).
3. **Preview** — a cheap personalized showroom preview at **`/s/<slug>`** (Gemini copy, a **claim
   code** `TBJ-XXXX-XXXX`, a ~14-day reservation). Sell-first: the preview is free to look at.
4. **Outreach** — we reach the owner (email 10am batch / social DM / Joe's call) with the preview
   link + claim code + "create an account and claim it." Bounces → re-enrich; replies → drafted.
5. **Account** — the owner signs up → gets a 6-digit **account number** (`100001`…).
6. **Claim** — `/portal/claim`, enter the claim code → links the site to their account. **Claiming a
   preview triggers the real build** (forge); an already-built site just links. Build appears in the
   portal shortly.
7. **Plan + pay** — on their site in the portal they pick a plan (Website $99 / Website+Voice $299 /
   Complete $999) → Stripe: one-time **$300 build** + monthly. Paying **activates hosting + goes live**.
8. **Live + manage** — add a domain (1 free credit via Vercel, or bring their own), edit content in
   the portal (click-to-edit + image studio), request rebuilds.
9. **Voice add-on** — Website+Voice includes an AI receptionist; our team provisions a per-client
   Retell agent for their business. **Complete ($999)** = bespoke agentic (OpenClaw) work Joe scopes
   personally → book Joe.
10. **Booking** — discovery/strategy calls land on Joe's Google Calendar (Meet), Mon–Fri 11 AM–1 PM
    Pacific, 30-min slots.

**The receptionist sits at the phone-call moment** (mostly owners from step 4 calling in). It must be
able to place a caller in this pipeline and push them to the next step: reassure → verify their
code/account → walk claim → point to portal plans → set up voice / book Joe.

## The call flow (TBJ's own front desk)

The agent is **Ivy**, Joe's assistant (persona name in `ASSISTANT_NAME`, `agent-config.mjs`). Most
callers are local owners who got our outreach — Ivy is a **claim concierge**, not a switchboard:

1. **Identify** — on connect, `identify_caller` matches the caller's phone to a lead so Ivy can greet
   them by business name and steer by **stage** (preview / built / claimed / live).
2. **Confirm a code** — the caller reads a **claim code** (`TBJ-XXXX-XXXX`) or **account number**
   (`100001`) → `verify_code` confirms it + names the business.
3. **Walk the claim** — create a free account → `/portal/claim` → enter the claim code (claiming a
   preview triggers the build).
4. **Plans** — Ivy does **not** quote prices on the phone; points them to the **Plan options** on
   `/portal/account`.
5. **Agentic ($999)** — don't sell it on the call: point them to **thinkbigjoe.com** to learn how the
   AI agent sales pipelines make money + register, and/or book an **agentic** strategy call.
6. **AI receptionist setup** — comes with the Website + Voice plan; our team activates it once on plan.
7. **Escalate** — anything Ivy can't do (billing, tech, complaint, wants a human) → `create_support_ticket`
   (message to Joe) or book Joe.
8. **Close** — reads the caller: book Joe (`check_availability` → `book_appointment`) or reassure DIY.

Never takes payment on the call — plans are chosen/paid in the portal or set up with Joe.

## The tools (custom webhooks)

| Tool | Route | Does |
|---|---|---|
| `identify_caller` | `POST /api/voice/identify` | Matches the caller's phone → business + pipeline stage. Read-only; returns **no** claim code (that stays in their email). |
| `verify_code` | `POST /api/voice/verify` | Confirms a claim code **or** account number; returns the business. Read-only. |
| `check_availability` | `POST /api/voice/availability` | Open slots. `type: "regular"` (11–1) or `"agentic"` (9–5). Never invent times. |
| `book_appointment` | `POST /api/voice/book` | Books into Google Calendar (Meet) + records the lead. Takes `type` + a `reason` (tagged on the invite so Joe's prepared). |
| `create_support_ticket` | `POST /api/voice/support` | Takes a message → emails Joe + logs `support_ticket` + Telegram. The interim support queue. |

Booking runs on `src/lib/gcal.ts` — **regular** calls Mon–Fri 11 AM–1 PM Pacific, **agentic** calls
Mon–Fri 9 AM–5 PM Pacific (`AGENTIC_HOURS`), 30-min slots. Weekends always closed. All routes are
bearer-gated by `RETELL_WEBHOOK_SECRET`.

**Host calendar / Google Meet:** every booking is created on the calendar named by **`GCAL_CALENDAR_ID`**
(env; defaults to `primary` = the connected Google account, currently Joe's `josephsardella@gmail.com`).
**To change which email/calendar hosts the Meet, set `GCAL_CALENDAR_ID` to that address** (the connected
OAuth account must own or have write access; switching to a different account entirely means re-OAuthing
`GCAL_REFRESH_TOKEN`). Every booking path (voice, web `appointments/book`, `venus-book`) now also sends a
**branded confirmation email carrying the Meet link** (`sendBookingConfirmationEmail`), so attendees get
the video link from us, not just Google's raw invite.

## Support queue (interim → dashboard ticket system later)

`create_support_ticket` currently emails **joe@thinkbigjoe.com** (`SUPPORT_EMAIL` env overrides) and
logs a `support_ticket` activity row + Telegram ping. **Planned:** a `support@thinkbigjoe.com` mailbox
a support agent watches, and a **ticket system in the command dashboard** (view/assign/respond) —
deferred behind other priorities. When built, point tickets there instead of Joe's inbox.

## Selling voice as a service (per-client)

The receptionist is a **product**, sold via the plan tiers ([`src/lib/plans.ts`](../src/lib/plans.ts)):

- **Website + Voice ($299/mo)** — includes the AI receptionist.
- **Complete ($999/mo)** — the agentic tier: bespoke OpenClaw agents built *for that business*.
  Not self-serve — **the caller books Joe** (he scopes + builds the custom agents).

**Path A per-client provisioning** (the plan): when a client subscribes to Website + Voice, spin
up a Retell agent *for their business* — same shape as `create-tbj-agent.mjs`, but with the
client's business info in the prompt, their booking calendar, and their own phone number. This
is the blueprint; the automated per-client version is **not built yet**.

Retell billing is **active** (Pay As You Go; the one-time Persona KYC is done), so provisioning a
number per client works via the API — each number is a PAYG cost, so gate it on a paid Voice plan.

## Editing + applying the agent

The prompt, greeting, and tools live in **one place**:
[`scripts/retell/agent-config.mjs`](../scripts/retell/agent-config.mjs) (`generalPrompt`,
`beginMessage`, `buildTools`). Edit there — both scripts import it, so they can't drift.

- **Apply changes to the LIVE agent** — `node scripts/retell/update-tbj-agent.mjs` (add `--dry`
  to preview). It finds the "ThinkBigJoe Receptionist" agent, then `PATCH`es its Retell LLM in
  place (`general_prompt` + `begin_message` + `general_tools`) — **no duplicate**. Test after via a
  web call in the Retell dashboard (Agents → ThinkBigJoe Receptionist → Test).
- **First-time / new agent** — `node scripts/retell/create-tbj-agent.mjs` (creates a *new* agent;
  re-running makes a duplicate — use the update script for edits).

Live agent as of this writing: `agent_fc091c7bd9f23c9760ed6fa559` / `llm_2be0665ec4b1d0313bc82066cb53`.

## Status

- ✅ Agent + LLM on Retell; all 5 webhooks live (identify, verify, availability, book, support).
- ✅ "Ivy" persona + full flow: caller-ID greet → claim → portal plans → agentic (website + 9–5 call)
  → support ticket / book Joe. Applied to the live agent via `update-tbj-agent.mjs`.
- ✅ Live number +1 (480) 764-2121 bound to the receptionist — calling it hits the new flow.
- ⏳ Dashboard ticket system + `support@` mailbox — deferred (tickets email Joe meanwhile).
- ↪ Possible upgrade: Retell inbound dynamic-variables webhook to greet by name in the *first*
  utterance (today `identify_caller` personalizes from turn 2).
- ⏳ Automated per-client provisioning + agent activation on plan purchase — not built (billing is
  on; each client number is a PAYG cost).
- ⏳ **Texting** — the SMS agent exists (`agent_e56a619c…`) but the number isn't A2P-10DLC
  registered yet (`create-sms-chat` → 404), so two-way SMS is blocked on that registration.
