# Voice onboarding — Ivy sets up a customer's receptionist on the phone

> **Status**: BUILT 2026-07-19, not yet exercised on a real call.
> **Why**: [`SALES_RUNBOOK.md`](./SALES_RUNBOOK.md) · **Tenancy**: [`VOICE_TENANCY_SPEC.md`](./VOICE_TENANCY_SPEC.md)

A paying customer calls, reads their account number, confirms a texted code, and Ivy interviews them.
No form. The call doubles as the demo — someone buying an AI receptionist experiences one doing
intake on them.

---

## The bug this replaced

`/portal/receptionist` asked one free-text question: *"Where should it send messages / urgent calls?"*

Filled in the way a plumber actually fills it in —

> *"Text the messages to the office line at 480-555-0177. If it's a real emergency, call my cell 480-555-0143."*

— **both** values resolved to the first number found. Emergency transfers went to the office line
nobody answers, which is the exact line they bought the product to cover. The customer's cell was
silently discarded.

Voice turns out to be **more** structured than the form, not less: Ivy asks two separate questions,
validates each to E.164, and reads the digits back before saving.

---

## Threat model — why there is a code at all

**Account numbers are sequential from 100001** (`scripts/db/add-account-numbers.mjs`) and
`/api/voice/verify` had no attempt cap. So an account number **identifies** a caller. It cannot
**authorize** one.

If reading a guessable number aloud were enough to rewrite receptionist config, the attack is:
guess a competitor's account number → call in → change `escalationPhone` to your own mobile → their
emergency calls now ring you. **Business takeover, not a data leak.**

Hence:

| Rule | Why |
|---|---|
| The code goes **only** to a destination already on file | A caller-supplied destination makes the whole step theatre |
| Business phone first, verified account email as fallback | On a call, "check your texts" beats "go find your email"; many business numbers are landlines |
| Spoken destination is masked (`the phone ending 0142`) | Enough for the real owner to recognise, useless to someone fishing |
| Every `start` failure returns the **same sentence** | Otherwise "not on the voice plan" confirms a competitor is a customer |
| 5 wrong codes locks the challenge | 6 digits × 5 tries = 1 in 200,000 |
| 3 challenges per site per hour | Locking alone was pointless — you could just start another. Also stops using an enumerated account number to text-bomb its owner at our cost |
| `save` requires a live verified session | The only endpoint that writes; everything above exists to protect it |

Ivy is explicitly told **not to speculate** when `start` returns `found:false`. Guessing out loud
("maybe you're not on the voice plan?") would leak exactly what the identical responses hide.

---

## The flow

```
"What's your account number?"      → start_receptionist_setup
    ├── not found / unclaimed / wrong plan / no destination / throttled → same dead-end line
    └── found → texts a 6-digit code to the number on file, returns business_name + site_id

"Read me the code"                 → verify_receptionist_code   (site_id from OUR response, not the caller)
    ├── wrong → counts down, locks at 5
    └── ok → verified session, good for 1 hour

the interview                      → save_receptionist_answers  (called repeatedly, as it goes)
```

**Saving happens as the interview goes, not at the end** — a dropped call would otherwise lose
everything. Omitted fields keep their previous value, so a partial interview never wipes prior
answers, and a garbled phone number gets re-asked without destroying the good one already captured.

---

## What it deliberately does NOT do

- **Never flips `receptionist_status` to active.** Writes a draft.
- **Never provisions a number.** That costs real money per number and stays a human
  `provision-line.mjs --apply`.
- **Never enables booking.** `bookingMode` is forced to `message` — booking isn't sold yet and an
  interview must not be able to switch it on.

The portal doesn't go away; its job changes from **capture** to **review and edit**. Same
`receptionist_config` underneath.

---

## Files

| Path | Role |
|---|---|
| `src/lib/voice-onboarding.ts` | The security boundary, deliberately in one file |
| `src/app/api/voice/onboard/{start,verify,save}/route.ts` | The three tool endpoints |
| `scripts/retell/agent-config.mjs` | Ivy's tool definitions + interview script (prompt step 5) |
| `scripts/db/2026-07-19-voice-onboarding.sql` | `voice_onboarding` table |

---

## Known gaps

- **Not yet exercised on a real call.** Every path is tested by HTTP; none has been spoken aloud.
  Expect the interview to need tightening once you hear it — particularly digit read-back, which is
  where speech-to-text is weakest.
- **Changing routing on a live account is as easy as first-time setup.** Repointing an already-live
  emergency number is the highest-value action an attacker could take. Banks confirm to the *old*
  destination before such a change takes effect; we don't yet.
- **`isVerified` is per-site, not per-call.** Two people onboarding the same site within the hour
  would share a session. Harmless today, wrong in principle.
