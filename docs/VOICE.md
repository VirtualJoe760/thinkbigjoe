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

> ⚠️ **Blocker:** buying phone numbers + running client agents needs **Retell billing enabled**.
> Until then, agents exist but have **no live number** — test via a **web call** in the Retell
> dashboard (Agents → the agent → Test).

## Updating the live agent

`create-tbj-agent.mjs` **creates** an agent (re-running makes a *duplicate*). To apply a changed
prompt/tools to the **existing** agent, update its Retell LLM via the API
(`PATCH /update-retell-llm/{llm_id}` with the new `general_prompt` + `general_tools`) rather than
recreating — the `llm_id`/`agent_id` are the ones from the original create run.

## Status

- ✅ Agent + LLM created on Retell (prototype); booking webhooks live; `verify_code` route added.
- ✅ Script updated to the claim-concierge flow (account# / claim-code lookup, portal plans, book Joe).
- ⏳ Live phone number — blocked on Retell billing.
- ⏳ Automated per-client provisioning + agent activation on plan purchase — not built.
