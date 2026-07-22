# ADS.md — the Meta paid-ads channel

**Status (2026-07-22):** attribution instrumentation SHIPPED (this doc's §3) · campaign 1 designed
(§4) · **ZERO dollars spent — spend is gated on §6 and Joe personally flipping the switch.**
Read [`BUSINESS_PLAN.md`](BUSINESS_PLAN.md) first if you're changing *who* we target or *what* we
charge; this doc is the paid-acquisition mechanics.

## 1. The channel

Meta's **official Ads MCP** (`https://mcp.facebook.com/ads`, open beta) is configured in this
project's Claude Code MCP config as **`meta-ads`**, OAuth'd with Joe's Meta Business login.
Auth is per-machine/per-user and **expires — when the session says "needs authentication", re-auth
in an interactive session: run `/mcp`, pick `meta-ads`, follow the browser OAuth.** ~29 tools:
campaign management, insights, tracking diagnostics, catalog, assets.

Facts learned in the 2026-07 evaluation (verify against the live server before relying on them):

- **All MCP writes land PAUSED** — Meta's native behavior matches our flip-the-switch rule.
  Nothing the agent creates can spend until a human activates it in Ads Manager.
- **Creative upload via MCP is weak/absent** — images/videos get uploaded by hand in Ads Manager;
  the MCP manages campaigns/adsets/copy/budgets/insights around them.
- **Budget or audience edits more than ~1×/day reset the learning phase.** Never let an agent
  thrash budgets. One change per day, max.
- Some ad accounts sit behind a phased rollout flag (`is_ads_mcp_enabled`) — if tools error on
  the account, check that flag before debugging anything else.

## 2. Rules (non-negotiable)

1. **No plan prices in public creative or landing copy** — pricing is revealed on the call
   (see the positioning rule in BUSINESS_PLAN.md).
2. **No new landing pages without an argument.** Ads land on the existing FOH.
3. **Agent never activates a campaign, raises a budget, or edits an audience without Joe.**
   Writes land paused; they stay paused until Joe flips them in Ads Manager himself.
4. **≤1 budget/audience edit per day** (learning-phase reset, see §1).
5. Instrument first, spend second: every ad URL carries the §3 UTM contract — an ad without
   UTMs is a bug.

## 3. Attribution — how a click becomes a measurable lead (SHIPPED 2026-07-22)

**Every ad URL follows this template** (Meta appends `fbclid` itself):

```
https://thinkbigjoe.com/?utm_source=meta&utm_medium=paid-social&utm_campaign=<campaign-slug>&utm_term=<adset-slug>&utm_content=<ad-slug>
```

The pipeline, end to end (each step verified against dev + Neon):

| Step | Where |
|---|---|
| Landing click captured (last paid touch, 28-day window, localStorage `tbj_attr`) | `src/components/attribution-capture.tsx` (`<AttributionCapture />` in `src/app/(frontend)/layout.tsx`) |
| Rides the booking-wizard intake (JSON `attribution`) | `src/components/booking/booking-wizard.tsx` → `/api/intake` |
| Rides the plain-POST contact forms (hidden inputs) | `<AttributionFields />` in `contact-cta.tsx` (homepage) + `/contact` → `/api/contact` |
| Stored on the lead | `leads.utm_source/_medium/_campaign/_content/_term`, `fbclid`, `referrer`, `landing_path` (migration `scripts/db/2026-07-22-lead-attribution.sql`) |
| Visible to Joe | "ad: source / campaign / content" chip on the command-home booked-calls list |
| Readable by agents | `ads_funnel_report` MCP tool (tbj-mcp v2.29.0): per-campaign form-fills → booked → accounts, plus organic contrast |

**Conversion-path reality check:** the homepage's public conversion paths are (a) the contact
form — instrumented, (b) **calling Ivy** at 480-764-2121 — attributable only by asking "how did
you hear about us" / time-correlation for now, and (c) account signup. The `/api/intake` wizard
is only on the legacy `/for/*` consultancy pages and the members-only `/portal/book` — it is
instrumented too, but it is NOT the ad landing flow. Don't design creative that promises "fill
out the form to book a call" — the public form is a message form.

## 4. Campaign 1 — `never-miss-a-call-v1`

**Audience:** US home-service owner-operators (plumbing, HVAC, electrical, roofing).
Advantage+ audience with interest seeds (plumbing services, HVAC, home improvement contracting,
small business ownership), age 28–65. One adset to start: `utm_term=adv-plus-us-v1`.
**Placements:** Advantage+ (traffic will be overwhelmingly mobile — see the mobile gate in §6).

**Objective:** Leads, optimizing on a **Meta Pixel `Lead` event fired on the contact form's
success state** (`?sent=1` redirect makes this a clean client-side trigger). ⚠️ **The pixel does
not exist yet** — it's a build item in §6. Until it exists the only honest fallback is a traffic
objective, which buys clicks, not leads — don't start there; build the pixel.

**Landing:** `https://thinkbigjoe.com/` with the §3 UTM template. No new pages.

**Creative (3 ads, no prices anywhere):**

| `utm_content` | Angle | Draft copy |
|---|---|---|
| `ad-missed-call-math` | The missed-call math | **Primary:** "Every call you can't answer is a job your competitor books. You're on a roof / under a sink / driving — and the phone rings. Our AI receptionist answers every call 24/7, qualifies the caller, and texts you the job before you're back on the ground." **Headline:** "Never miss a call again." **CTA:** Learn More |
| `ad-after-hours` | After-hours emergency | **Primary:** "It's 9pm. A homeowner's water heater just burst, and they're calling down the list. Whoever answers gets the job. With ThinkBigJoe, that's you — an AI receptionist that picks up every call, day or night, and books the work." **Headline:** "The contractor who answers wins." **CTA:** Learn More |
| `ad-call-her-yourself` | Live demo — call the AI now | **Primary:** "Don't take our word for it — call (480) 764-2121 right now and talk to her. That's our AI receptionist. She answers every call for home-service pros: qualifies the caller, books the job, texts you the details." **Headline:** "Call our receptionist. She's AI." **CTA:** Learn More | ⚠️ GATED: per SALES_RUNBOOK.md the live number currently runs Ivy the *claim concierge*, not a receptionist demo — a prospect hears the wrong product. Do not activate this ad until the Ivy dress rehearsal (§6) passes. |

Visuals (hand-uploaded, §1): real-trade imagery — plumber under a sink with a ringing phone
on screen, van at night with one lit porch — not stocky office shots. Square + 9:16 vertical.

**Budget:** $15/day, one campaign, 14-day test → ~$210 max exposure. Kill/scale criteria at
day 14 (or 50 form-fills, whichever first): cost per form-fill ≤ $25 → iterate creative and
continue; $25–50 → rework creative/audience before more spend; > $50 with < 5 fills → pause,
rethink the offer presentation. Metrics per §5; one budget change max per day per §2.

## 5. Metrics — the funnel we actually steer by

Joe's three numbers, and where each comes from:

1. **Cost per form-fill** = campaign spend (Meta insights, via meta-ads MCP) ÷ attributed
   form-fills (`ads_funnel_report`, or `SELECT count(*) FROM leads WHERE utm_campaign=…`).
2. **Form → Ivy-call rate** — contact-form leads who then call the hotline. Manual join for
   now (phone match between `leads.phone` and the `calls` table); automate only if volume
   justifies it.
3. **Call → account rate** — `ads_funnel_report` reports accounts by email-match between
   attributed leads and `better_auth."user"`.

Weekly reading cadence during the test, not daily — small-budget daily numbers are noise.
Once spend is live, add a lookback line to the marketing-manager's weekly cron so the report
lands without asking (venus-crons + `ads_funnel_report`; deliberately NOT added while it would
report zeros).

## 6. Launch gates — what blocks real spend (ruling 2026-07-21)

Blockers, in order; the last one is Joe's own hand:

- [ ] **Stripe webhook 200-on-error fix** — BLOCKS SPEND. Paying traffic must not hit a
  checkout that swallows failures.
- [ ] **Ivy's onboarding tools pushed + verified** — BLOCKS SPEND (and specifically gates the
  `ad-call-her-yourself` creative).
- [ ] **Mobile pass on FOH + contact form** — near-blocking; Meta traffic is ~all mobile.
- [ ] **Meta Pixel + `Lead` event on `?sent=1`** — required for the Leads objective (§4).
  (Consider CAPI later; `fbclid` is already stored per-lead for dedup when that day comes.)
- [ ] **Ivy dress rehearsal** — gates the final switch-flip.
- [ ] **Joe activates the paused campaign in Ads Manager himself.** Nothing else counts.

`booking_timezone` can wait (same ruling).
