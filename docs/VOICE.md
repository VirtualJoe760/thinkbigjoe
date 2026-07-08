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

Most callers are local owners who got our outreach ("we built you a website — here's the link
and a claim code"). The agent is a **claim concierge**, not a generic switchboard:

1. **Open** — "Are you calling about the website we built for your business?"
2. **Confirm their code** — the caller reads a site **claim code** (`TBJ-XXXX-XXXX`) or their
   6-digit **account number** (`100001`); the agent calls `verify_code` to confirm it and name
   the business.
3. **Walk the claim** — create a free account → `/portal/claim` → enter the claim code.
4. **Plans** — the agent does **not** quote prices on the phone; it points them to the **Plan
   options** listed in `/portal/account`. The Complete/agentic tier is set up personally with Joe.
5. **AI receptionist setup** — comes with the Website + Voice plan; our team activates it once
   they're on that plan.
6. **Close** — reads the caller: book 15 min with Joe (`check_availability` → `book_appointment`),
   or reassure them the portal is easy to self-serve.

Never takes payment on the call — plans are chosen/paid in the portal or set up with Joe.

## The tools (custom webhooks)

| Tool | Route | Does |
|---|---|---|
| `verify_code` | `POST /api/voice/verify` | Confirms a claim code **or** account number; returns the business it belongs to. Read-only. |
| `check_availability` | `POST /api/voice/availability` | Real open strategy-call slots (Google Calendar). Never invent times. |
| `book_appointment` | `POST /api/voice/book` | Books the call into Google Calendar (Meet) + records the lead. |

Booking runs on `src/lib/gcal.ts` (Mon–Fri, 11 AM–1 PM Pacific, 30-min slots). All three routes
are bearer-gated by `RETELL_WEBHOOK_SECRET`.

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

- ✅ Agent + LLM created on Retell (prototype); booking webhooks live; `verify_code` route added.
- ✅ Live agent updated to the claim-concierge flow (account# / claim-code lookup, portal plans,
  book Joe) via `update-tbj-agent.mjs` — verified on Retell.
- ✅ Live number +1 (480) 764-2121 bound to the receptionist — calling it hits the new flow.
- ⏳ Automated per-client provisioning + agent activation on plan purchase — not built (billing is
  on; each client number is a PAYG cost).
- ⏳ **Texting** — the SMS agent exists (`agent_e56a619c…`) but the number isn't A2P-10DLC
  registered yet (`create-sms-chat` → 404), so two-way SMS is blocked on that registration.
