# AI_ORDERING.md — pickup orders from Claude / ChatGPT, at any restaurant

**Status (2026-10-12): DESIGN ONLY. Nothing is built.** Decisions (Joe, 2026-10-12):

- **Hybrid, concierge first.** TBJ orders *for* the customer at any restaurant: an AI voice agent
  calls the order in. Restaurants that sign up become **partners** and get orders directly. The
  concierge tier is the growth engine, and every order is also a sales lead.
- **Card hold, not escrow.** The customer's card is authorized up front and charged only the
  confirmed total. If the order can't be placed, the hold is released.
- **TBJ's take is the greater of $1.00 or 3% of the food subtotal** per order (Joe: "$1 to 3%").
- No pilot restaurant needed. The concierge tier works without one.

Open decisions are in §15. Figures marked *(est.)* are rough and need re-checking before launch.

## 1. What it is

A customer tells their own chatbot: *"order me a cheeseburger from Joe's Grill, no pickles, I'll
grab it at 6."* The chatbot calls our tools, the customer taps a link and approves a card hold on
their phone, the restaurant gets the order, and the customer picks it up.

There are two tiers behind the same tools:

| | **Concierge** (any restaurant) | **Partner** (restaurant signed up) |
|---|---|---|
| How the order reaches the restaurant | TBJ's **AI voice agent phones it in** | A **text + portal Orders screen**, with an Accept button |
| Who the customer pays | **TBJ** is the seller of record. TBJ pays the restaurant with a single-use virtual card read out on the call. | **The restaurant**, via Stripe Connect. TBJ takes an application fee. |
| Prices | Estimates (menus found online go stale). The **restaurant's spoken total is the truth.** | Exact, from the menu the restaurant manages |
| Customer's service fee | TBJ margin **+ pass-through costs** (≈ $2.50–$4, §6) | TBJ margin only (**$1.00** on most orders) |
| Who carries refunds/chargebacks | TBJ | The restaurant |
| What it's for | Works everywhere on day one. Every order is proof to show a restaurant. | Cheaper and faster. This is what concierge restaurants convert *to*. |

**Who does what (AGENTS.md, "build the agent, don't *become* the agent"):** the **customer's
chatbot** holds the customer conversation. The **order-caller voice agent** holds the restaurant
conversation (§8). That's agent work, built like Ivy, not app code. **This app only exposes tools,
pages, payments and plumbing.**

## 2. The customer flow

```
Customer ──"burger from Joe's Grill, no pickles, 6pm"──▶ their chatbot (Claude / ChatGPT)
  chatbot ── find_restaurant("Joe's Grill", near "Tempe")  ─▶ TBJ public MCP
           ◀── {id, tier: concierge|partner, phone, hours, open_now}
  chatbot ── get_menu(id)  ─▶ partner: exact menu · concierge: whatever we have cached, flagged "estimated"
  chatbot reads the order + estimate back, customer says "yes"
  chatbot ── create_order(id, items, pickup 18:00, name, phone) ─▶ TBJ public MCP
           ◀── order_id, estimate, hold amount, ready_by (partner) or "confirming" (concierge), pay_url
Customer taps pay_url ─▶ thinkbigjoe.com/o/<token> ─▶ Stripe Checkout (Apple/Google Pay/card)
                         CARD HOLD only: "You'll be charged the final total once the restaurant confirms."
  ┌─ PARTNER:   text + portal ping ─▶ restaurant taps Accept ─▶ CAPTURE exact total
  └─ CONCIERGE: voice agent calls the restaurant, places the order, hears the total,
                pays with a single-use virtual card ─▶ CAPTURE that total (≤ hold)
  either way, failure (no answer / not accepted in 20 min / price over hold) ─▶ RELEASE hold, $0 charged
/o/<token> shows live status ─▶ customer picks up under their own name
```

**The pay link is our page, not an artifact.** A stranger's chatbot can't call Joe's Artifact
tool. A link to `/o/<token>` renders in every chatbot and on any phone. An inline order card (MCP
Apps UI / ChatGPT Apps SDK) is a Phase 4 nicety on top of the same link.

## 3. Architecture

```
 customer's chatbot ──Streamable HTTP MCP──▶ /api/mcp   (NEW, public, no auth)
                                               ├─ partner lookup: ordering_settings + menu_items
                                               └─ concierge lookup: Google Places → concierge_restaurants
 customer's phone ──▶ /o/[token] ──▶ Stripe Checkout, capture_method=manual
                                       partner: on the restaurant's connected account (direct charge)
                                       concierge: on TBJ's own account
 CONCIERGE: hold succeeds ─▶ Retell outbound call (order-caller agent, §8)
            agent tools (webhooks): get_order_for_call · get_payment_card · report_order_result
            payment: Stripe Issuing single-use virtual card, capped at the hold
 PARTNER:   hold succeeds ─▶ sendSms(restaurant) + /portal/orders ─▶ Accept ─▶ capture
 Stripe webhooks: /api/stripe/webhook (TBJ account, concierge) · /api/stripe/connect-webhook (NEW, partner)
 sweep (§11) ─▶ expire unpaid links · release stale holds · cancel unused virtual cards
 Joe ─▶ /command/orders · Venus ─▶ list_food_orders (tbj-mcp.mjs, read-only)
                                    all of it ─▶ Neon (new tables, §5)
```

Everything lives **in this repo** (the Vercel app) plus one new Retell agent. Nothing in the forge
changes until Phase 3 adds an "Order with AI" section to restaurant templates.

## 4. The public MCP server (`/api/mcp`)

**It's separate from `mcp-server/tbj-mcp.mjs`, on purpose.** tbj-mcp.mjs is the agents' internal
toolbox: stdio, Joe's Mac, and it can write to everything. This one is internet-facing and
anonymous. It shares **no code path** with tbj-mcp.mjs and can only reach the ordering tables.
Implement it as a Next route handler using the MCP SDK's Streamable HTTP transport in stateless
mode (the SDK is already a dependency in `mcp-server/package.json`; Vercel's `mcp-handler`
adapter is the alternative). **This repo runs a customized Next.js build, so check
`node_modules/next/dist/docs/` for route-handler differences first.**

**No sign-in.** MCP authorization is *optional* in the spec. Requiring OAuth would add a login
before a customer can even see a menu. Identity comes from the order (name + phone), and the
card hold is the real gate.

### Tools

| Tool | Input | Returns | Notes |
|---|---|---|---|
| `find_restaurant` | `query`, `near?` | up to 5 × {id, name, address, **tier**, open_now, est_wait_min} | Partners first. Otherwise a **Google Places Text Search** (new server key needed; ~3–4¢/search *(est.)*), cached into `concierge_restaurants`. Restaurants on the do-not-call list, or outside launch states (§12), aren't orderable. |
| `get_menu` | `restaurant_id` | Partner: exact menu + option groups + hours + prep time. Concierge: cached menu if we have one, **every price flagged `estimated`**, or "no menu on file, describe what you want". | Always includes the allergy disclaimer. |
| `create_order` | `restaurant_id`, `items`, `pickup_at?`, `customer_name`, `customer_phone` | order_id, line items, estimate, **hold amount**, service fee, ready_by or `confirming`, **pay_url**, expires_at | Partner items are `{item_id, qty, option_ids[], note?}`. Concierge items may be free text `{description, qty, est_price?}`. |
| `get_order_status` | `order_id` | status, confirmed total, ready_by | "Is it ready?" works in the same chat. |
| `cancel_order` | `order_id` | ok | Only before the restaurant confirms. After that it's the restaurant's call. |

**Server-side rules (the chatbot is never trusted with money or time):**

- **Partner prices come from our DB.** The chatbot sends only IDs.
- **Concierge prices are estimates and only size the hold.** The restaurant's spoken total is
  what gets charged, never more than the hold the customer approved.
- **ready_by is computed (§10), never invented.** For concierge it's what the restaurant says
  on the call.
- **Read-back before ordering.** `create_order`'s description tells the chatbot to read items +
  estimate back and get an explicit yes. Tool descriptions are how we "instruct" a chatbot we
  don't control.
- **Free-text notes are capped at 140 chars** and shown or read to the restaurant as a customer
  note, never interpreted. **Allergies aren't guaranteed**, and the chatbot must say so.
- **Rate limits:** per IP and per phone on `create_order`. Unpaid links expire in 30 min. No hold
  means no call and no kitchen ping, so spam costs nothing but a DB row.

## 5. Data model (new tables)

Create these with a SQL migration, then run `npm run db:pull` (the DB owns the schema; never
hand-edit `src/db/schema.ts`).

- **`food_orders`**: `id` · `public_token` (unguessable, used in `/o/<token>`) · `tier`
  (`partner` | `concierge`) · `site_id` (partner) / `concierge_restaurant_id` (concierge) ·
  `status` (below) · `customer_name` · `customer_phone` · `items` jsonb (**a snapshot at order
  time**) · `estimate_subtotal_cents` · `estimate_tax_cents` · `hold_cents` · `confirmed_subtotal_cents`
  · `confirmed_tax_cents` · `fee_cents` · `captured_cents` · `requested_pickup_at` · `ready_by` ·
  `source` (`mcp` / `web` / `voice`) · `client_hint` · `stripe_account` (null = TBJ's) ·
  `stripe_checkout_session_id` · `stripe_payment_intent_id` · `issuing_card_id` · `retell_call_id` ·
  `failure_reason` · a timestamp per status change.
  - **Status:** `pending_payment` (link sent) → `held` (card authorized) → [`placing`, concierge
    call in progress] → `confirmed` (restaurant accepted, **payment captured**) → `ready` →
    `picked_up`. Terminal: `expired` (never authorized) · `released` (hold cancelled, $0 charged)
    · `refunded` · `cancelled`.
- **`concierge_restaurants`**: `id` · `google_place_id` (unique) · `name` · `address` · `state` ·
  `phone` · `phone_line_type` (Twilio Lookup: landline / mobile / voip, §8) · `hours` jsonb ·
  `menu` jsonb (cached, estimated) · `takes_card_by_phone` (learned on calls) · `do_not_call` +
  `dnc_reason` + `dnc_at` · `orders_confirmed` · `orders_failed` · `last_called_at` ·
  `forge_site_id` (set when it becomes a lead or client).
  **This table is also a prospect list:** a restaurant with a dozen concierge orders is the
  warmest lead TBJ will ever have (§9).
- **`ordering_settings`** (partner, 1 row per claimed site): `site_id` · `enabled` · `paused` ·
  `stripe_account_id` · `charges_enabled` · `notify_phone` · `prep_minutes` ·
  `max_orders_per_slot` · `hours` jsonb · `tax_rate_bps` · `fee_min_cents` (default 100) ·
  `fee_bps` (default 300) · `allergy_disclaimer`.
- **`menu_items`** (partner): `id` · `site_id` · `category` · `name` · `description` ·
  `price_cents` · `available` · `sort` · `option_groups` jsonb `[{id, name, min, max,
  options:[{id, name, price_cents}]}]`.

Indexes: `food_orders (status, created_at)` for the sweep, `(public_token)`, and
`(site_id, status)`. Live screens poll narrow `WHERE status IN (…)` queries. **Never put a
full-table SELECT behind auto-refresh**: Neon *data transfer* is the budget that caused the
2026-07 outage.

## 6. Money: the card hold + the fee

### The card hold (both tiers)

Stripe's **authorize now, capture later** (`capture_method=manual`) puts a hold on the customer's
card. The money stays in their account, reserved:

- **The hold is valid ~7 days** for online card payments (Visa: 7 days when the customer starts
  the payment). We settle within the hour.
- **We can capture less than the hold**, and the remainder is released automatically. Most
  payments allow **one capture**, so capture once, at the final amount.
- **Cancelling a hold means $0 ever charged.** A refund is worse: Stripe keeps the original
  processing fee, and the customer sees a charge and a refund. So **capture only once the
  restaurant has committed**, and release on any failure before that.
- Some banks show a hold like a pending charge. The order page says so in plain words: *"This is
  a hold of $X. You'll only be charged the final total once the restaurant confirms."*

| Tier | Hold amount | Capture when | Capture amount | Released when |
|---|---|---|---|---|
| Partner | exact food + tax + fee | restaurant taps **Accept** | the same total, or less if the restaurant marks an item unavailable | not accepted in 20 min · restaurant rejects · customer cancels first |
| Concierge | **(estimated food + tax) × 1.20 + fee at that size** | restaurant **confirms the total on the call** (before the agent reads the card) | spoken food + tax + recomputed fee (always ≤ hold) | no answer / refused / closed · **spoken total exceeds the hold** (the agent tells the restaurant it must check with the customer, and the customer is asked to re-confirm in a new order) |

**Capture happens before pickup, deliberately.** Once the restaurant has started cooking (and,
for concierge, TBJ has paid), a no-show customer still pays. The order page says this before
the customer approves the hold. Mistakes after capture (wrong order, restaurant closed when they
arrive) are normal refunds.

**Stripe mechanics:** Checkout Session with `payment_intent_data.capture_method=manual` and
`expires_at` = 30 min. Capture with `amount_to_capture`, and for partners also
`application_fee_amount`, both settable at capture time. Release = cancel the PaymentIntent.

### The fee

**TBJ's margin = max($1.00, 3% × food subtotal)**, before tax. It's stored per partner
(`fee_min_cents` / `fee_bps`) so it can be tuned, and charged **to the customer** as a "service
fee" in both tiers (§15 has the restaurant-pays alternative).

**Partner tier:** the customer pays exactly the margin. The restaurant pays only its normal card
processing (it's the seller on a direct charge; Stripe Connect adds no platform fee when Stripe
handles the restaurant's pricing).

**Concierge tier:** TBJ is the seller, so TBJ pays the card processing on the *whole* order,
plus the call and the virtual card. A $1–3% fee alone loses money. So the concierge fee is the
margin **plus pass-through costs**, shown as one line ("includes card processing and the call to
the restaurant"):

```
fee = ( margin + 0.30 + call_cost + card_cost + 0.029 × (food + tax) ) / (1 − 0.029)
      call_cost ≈ 3 min × $0.18/min (RETELL_COST_CENTS_PER_MINUTE, src/lib/voice-usage.ts) ≈ $0.54
      card_cost  = $0.10 per Stripe Issuing virtual card
```

**Worked examples** *(est.; tax shown at an illustrative 8.5%)*:

| Food subtotal | Partner: customer's fee | Partner: restaurant pays (card processing only) | Concierge: customer's fee | Concierge: TBJ keeps |
|---|---|---|---|---|
| $15 | $1.00 | ~$0.80 | ~$2.49 | $1.00 |
| $25 | $1.00 | ~$1.12 | ~$2.81 | $1.00 |
| $50 | $1.50 | ~$1.92 | ~$4.14 | $1.50 |
| $100 | $3.00 | ~$3.53 | ~$7.30 | $3.00 |

**Unverified cost items to confirm before going live:** Stripe Issuing per-transaction fees
(a third-party guide says 0.2% + 20¢ after the first $500k is waived), any interchange share TBJ
earns on its own Issuing spend (only Stripe sales can say; it would *lower* concierge fees), and
real Retell cost per order call (log `call.call_cost`).

**How this compares (for the sales pitch, be honest):** marketplace *delivery* is 15–30%, but
**pickup** is far cheaper: DoorDash lists **6%** and Uber Eats **7%** (10% if prices aren't
matched to in-store prices). Direct-ordering tools run ~2.5–3.3% + ~30¢ processing, often plus a
monthly fee (ChowNow is ~$119–$399/mo). A **partner** restaurant paying only card processing
(~4.5% on a $25 order) beats marketplace pickup, but modestly. **The pitch isn't price. It's the
AI channel itself, owning the customer relationship, and being bundled with their TBJ site.**
The concierge fee (~$2.50–$4) is a convenience fee the customer chooses to pay. That gap ("your
customers pay $2.81 to reach you through us; sign up and it drops to $1") is the conversion lever.

### Partner payments: Stripe Connect, direct charges

**Stripe Connect** is Stripe's feature for platforms that take payments on behalf of other
businesses. Each partner restaurant gets its own Stripe account (a "connected account"), linked
to TBJ's. With **direct charges** the payment is created *on the restaurant's account*, and TBJ
takes an `application_fee_amount`. Per Stripe's Connect docs:

- The restaurant is the business of record, and its name is on the card statement.
- **Refunds and chargebacks come out of the restaurant's balance, not TBJ's.**
- Use **v2 accounts** (or Standard). Stripe doesn't recommend direct charges with legacy
  Express/Custom accounts. Onboarding is Stripe-hosted, launched from the portal, and
  `charges_enabled` is mirrored from the `account.updated` webhook.
- Connected-account events go to **a separate Connect webhook endpoint with its own signing
  secret** (`/api/stripe/connect-webhook`), not the existing `/api/stripe/webhook`. Handle
  `checkout.session.completed` (→ `held`), `checkout.session.expired`, `payment_intent.canceled`,
  `charge.refunded`, and `account.updated`. **Idempotent, and 5xx on failure** for anything we
  must not drop, matching the existing webhook's `RETRYABLE_EVENTS` pattern.

### Concierge payments: TBJ as the customer's agent

TBJ is the **customer's agent**: we buy the food for them. We are not a reseller. That framing
settles tax and is what we tell Stripe.

- **Tax is paid once.** The restaurant charges its normal tax on the call and pays it to the
  state. We pass exactly that amount through at cost on the customer's receipt ("Tax, charged by
  the restaurant"). TBJ never adds its own sales tax on the food. **One accountant question
  before live money:** is TBJ a *marketplace facilitator* in Arizona for these orders, and is the
  service fee itself taxable? Facilitator status is set by state law, and in some states it moves
  the food tax onto the platform.
- **Paying the restaurant: Stripe Issuing.** Issuing is Stripe's product for creating your own
  payment cards. One **single-use virtual card per order** ($0.10 each) with spending controls:
  amount capped at the hold, restricted to restaurant merchant categories, cancelled right after
  the call. Because the cards are for **TBJ's own spending, Issuing activity doesn't require PCI
  certification** (Stripe's Issuing docs). The full card number is fetched from the API only at
  the moment the agent needs it, never stored, and kept out of logs and transcripts as far as
  Retell allows. A leaked number is worthless anyway: single-use, capped, and already spent.
- **Stripe approval gates (before live money):** Issuing needs Stripe's approval. Stripe
  **prohibits "facilitating transactions for another undisclosed merchant"** and lists escrow
  and payment facilitation as *restricted*, so in that application describe the model plainly:
  TBJ sells an ordering service and buys the food on the customer's behalf. Don't launch
  concierge live until Stripe has said yes in writing.
- **If a restaurant won't take a card by phone:** the agent places the order as **pay at
  pickup**, and we capture only the service fee. The customer pays the food at the counter. The
  order page and chatbot say so.

## 7. Partner tier: getting the order to the kitchen

On `held` (never before):

1. **Text the restaurant's `notify_phone`** via `src/lib/sms.ts`: *"New order #A7 — 1×
   Cheeseburger (no pickles) — ready by 6:00 PM — tap to accept: <link>"*.
2. `/portal/orders` shows live orders with **Accept / Ready / Picked up**. **Accept = capture.**
3. Not accepted after 10 min → a second text. After 20 min → **release the hold** and tell the
   customer on `/o/<token>`.
4. **Later:** push straight into the register system. **Square** has an open Orders API, the
   best first target. **Toast** gates its API behind a partner program and has no official
   AI/MCP connector.

## 8. Concierge tier: the order-caller voice agent

Calling a restaurant and placing an order is a conversation, so it's **agent work**: a **Retell
outbound voice agent**, built and edited the same way as Ivy (`docs/VOICE.md`, the
`scripts/retell/` configs). The app only *starts* the call (Retell's create-call API, triggered
when the hold succeeds) and serves the agent's tools as webhooks:

| Agent tool | What it does |
|---|---|
| `get_order_for_call` | Items, notes, customer's first name for the pickup, requested time, hold ceiling |
| `report_total` | The total the restaurant just quoted → the server says **proceed** (≤ hold) or **stop** (over the hold) |
| `get_payment_card` | Only after a "proceed": creates the single-use Issuing card and returns its details |
| `report_order_result` | `confirmed` (ready time) · `pay_at_pickup` · `failed` (no answer / closed / refused / over hold) · `do_not_call` |

**Calling rules (load-bearing):**

- **Disclose first:** *"Hi, I'm an automated ordering assistant calling to place a pickup order
  for a customer named Sarah."* Google Duplex's restaurant calls set the precedent, and
  disclosure is the condition.
- **Don't AI-call mobile numbers.** The FCC's February 2024 ruling puts AI voices under the
  TCPA's "artificial voice" rules, and calls to *wireless* numbers need prior consent even when
  the callee is a business. Check every number once with **Twilio Lookup** (line type, about a
  cent) and don't orderable-list `mobile` lines. Food trucks often list cell phones. Lawyer skim
  before live.
- **"Don't call us" is instant and permanent:** the agent reports `do_not_call` and the
  restaurant is never called again.
- Call only within the listed hours, at most a few calls per restaurant per day, one retry on
  no-answer, then release.
- The pickup is under the **customer's** name, and the agent never claims to be the customer.

## 9. Concierge → partner: the conversion loop

Every concierge order is evidence. `concierge_restaurants.orders_confirmed` feeds prospecting:

- A **deterministic daily job** promotes restaurants past a threshold (e.g. 10 confirmed
  orders) into `forge_sites` as leads, with call-prep: *"23 customers ordered from you through
  ChatGPT and Claude last month and paid a $2.81 fee to do it."*
- **Outreach is agent work.** The prospector/outreach agents pick these up through a
  `venus-crons.mjs` job and a tbj-mcp.mjs tool. The pitch: sign up and the orders arrive directly
  (no phone calls), your customers' fee drops to $1, you get a TBJ site, and you own the customer.
- This is the existing **sell-first, then claim** motion (`docs/SHOWROOM.md`) applied to ordering.

## 10. Ready-by time (partner)

The server computes `ready_by`, and the chatbot only relays it.

```
earliest = now + prep_minutes + (queue load: +5 min per open order in the next 30 min)
ready_by = max(requested_pickup_at ?? earliest, earliest)
         → bumped to the next slot with room if the slot already has max_orders_per_slot
         → rejected with "opens at 11:00 AM — earliest pickup 11:20" if outside hours
```

For concierge, ready_by is whatever the restaurant says on the call, and until then the order
shows `confirming`.

## 11. The sweep (scheduled work)

The sweep is deterministic and time-critical, so it's **not** an agent cron. Run it about **every
minute**:

1. Expire `pending_payment` links older than 30 min.
2. Partner: re-text at 10 min, **release** at 20 min unaccepted.
3. Concierge: release any order stuck in `placing` for more than 15 min. Cancel any Issuing card
   not used within its call.
4. Release anything still `held` after 2 hours. A forgotten hold must never ride out the 7-day
   authorization window.
5. Auto-close `ready` → `picked_up` at end of day.

**Open question (§15):** the app's Vercel crons (`vercel.json`) all run once a day. Per-minute
crons need a Vercel Pro plan, and a launchd script on Joe's Mac stops when it sleeps, which is a
bad place for a promise about customers' money. Belt-and-braces either way: also run the sweep
**lazily** whenever an MCP call, webhook, or Orders screen touches an order.

## 12. Legal + platform gates (before live money)

| Gate | Why | Status |
|---|---|---|
| **Launch states = Arizona only** | **NYC** requires a written agreement *and* a license for any app that arranges food pickup. **California's** AB 2149 requires restaurant consent to list. Concierge never publishes restaurant pages, logos or menus, but stay out of those markets entirely. | Geofence on `concierge_restaurants.state` |
| Stripe Issuing approval + model description | Undisclosed-merchant prohibition; escrow and payment facilitation are restricted | Not started |
| Accountant: marketplace facilitator + fee taxability in AZ | Decides who remits tax on concierge orders | Not started |
| Lawyer skim: TCPA (AI voice) + the AZ consent question | Mobile-line skip + disclosure are the mitigations | Not started |
| SMS: texts *to restaurants* only | Customer texts on a restaurant's behalf would stretch the shared `jsardella` A2P campaign (`docs/SMS.md`). Customers track status on `/o/<token>`. **No email** without the `DELIVERABILITY.md` gate. | Policy |

## 13. Shipping it full-stack (THE RULE, `VENUS_UI_MAPPING.md`)

| Layer | What ships |
|---|---|
| **UI** | `/o/[token]` (public order page: hold wording, live status) · `/command/orders` (all orders, holds outstanding, failed calls with reasons, concierge restaurants ranked by orders, do-not-call list, fees earned) · Phase 3: `/portal/orders`, `/portal/menu`, ordering settings + Connect onboarding in `/portal/settings` |
| **MCP tool** | Public `/api/mcp` (§4) · in `tbj-mcp.mjs`: `list_food_orders` (read-only) and `list_ordering_leads` (concierge restaurants past the threshold, for prospector/outreach) · later `save_menu_draft` (calls `audit()`) |
| **Schedule** | The per-minute sweep (§11) · the daily concierge → lead promotion (§9) · a venus-crons outreach job working those leads · later a Square catalog sync |
| **Agent** | The Retell order-caller (§8). Its persona/prompt lives with the other Retell configs. |

Docs to touch when this ships: `MCP_TOOLS.md` (it says tbj-mcp.mjs is *the* MCP server, which
will no longer be true) · `VOICE.md` (a second Retell agent, outbound) · `SMS.md` (restaurant
alert texts) · `SHOWROOM.md` (the concierge lead source) · this doc's status line.

## 14. Phases

**Phase 1: core + concierge demo (Stripe test mode, Issuing test mode, no real restaurant).**
Public `/api/mcp` (Google Places lookup + concierge `create_order`) · `/o/<token>` · card hold →
capture/release · the Retell order-caller, **calling Joe's phone as the "restaurant"** · test
Issuing card · the sweep · `/command/orders`. Joe adds the connector in Claude ("Add custom
connector" → `https://thinkbigjoe.com/api/mcp`).
*Exit criteria:*
- Order from Claude → the agent calls Joe → Joe quotes $18.40 → exactly that plus the fee is captured.
- Joe quotes above the hold → released, $0 charged.
- Joe doesn't answer → released.
- Joe says "don't call us again" → the restaurant is on the do-not-call list.
- A chatbot sending a fake price or a past pickup time is rejected cleanly.

**Phase 2: concierge live, Arizona only.** All §12 gates green → live Stripe + Issuing → Twilio
Lookup mobile-skip → real orders at real restaurants.
*Exit criteria:* 50 confirmed orders, under 15% failed calls, every complaint resolved, and real
per-order costs logged to re-check §6's fee formula.

**Phase 3: partner tier (the conversion).** Connect onboarding · `/portal/menu` (+ a menu-import
agent drafting from the restaurant's site or PDF; the owner confirms prices) · `/portal/orders`
with Accept = capture · kitchen texts · an "Order with ChatGPT / Claude" section on the
restaurant's TBJ site (forge template change) · the §9 lead loop live.
*Exit criteria:* the first concierge restaurant converts, and a week of partner orders with zero
missed (unaccepted) orders.

**Phase 4: reach.** Claude connector directory + ChatGPT app directory listings · inline order
card (MCP Apps UI) · Square register push · **Ivy takes phone orders** through the same
`create_order` (source = `voice`). One order engine, three front doors: chatbot, website, phone.

## 15. Open decisions

| Decision | Recommendation |
|---|---|
| Who pays TBJ's $1/3% | **The customer** (a "service fee"), so a partner restaurant pays only normal card processing, which is what makes "sign up" an easy yes. Alternative: the restaurant pays via the application fee. That's cheaper for customers, but then partner cost ≈ marketplace pickup (~6–7%) and the sales pitch weakens. |
| Concierge hold buffer | **+20%** over the estimate. Raise it if Phase 2 shows many over-hold releases. |
| Per-minute sweep host | **Vercel Pro cron** if the plan allows, plus the lazy sweep. Check the plan before Phase 1. |
| Google Places key | Needed for concierge `find_restaurant`. The app only has the Maps *embed* key today. Enabling the Places API happens in Google Cloud console (Phase 1 setup). |
| Customer "food is ready" texts | Defer. Needs a dedicated A2P campaign. The order page covers status. |
| Tips | Defer. Possibly a tip choice on `/o/<token>` that adjusts the hold. |
| Fee shown publicly? | The positioning rule bars plan prices in public copy. This is a *customer* service fee shown at checkout, not a plan price, so it's fine, but don't advertise "$1 per order" in ads. |

## 16. Landscape (2026-10, for context)

- **Fees:** DoorDash pickup 6% / delivery 15–30%
  ([DoorDash](https://merchants.doordash.com/en-us/learning-center/delivery-commission)). Uber
  Eats pickup 7% (10% unmatched prices) / delivery 20–30%
  ([Restolabs](https://www.restolabs.com/blog/uber-eats-commission-fee)). ChowNow ~$119–$399/mo +
  ~2.95% processing ([Sauce](https://www.getsauce.com/post/chownow-pricing-and-fees)). Survey:
  [Kwick2Go](https://kwick2go.com/blog/online-ordering-commission-fee-comparison.html). These are
  vendor-blog figures, so verify before quoting to a restaurant.
- **AI ordering:** many **community-made** MCP servers order from DoorDash, Uber Eats, Taco Bell
  and Zomato, mostly by scraping or private APIs
  ([DoorDash MCP](https://glama.ai/mcp/servers/markswendsen-code/mcp-doordash),
  [Uber Eats MCP](https://playbooks.com/mcp/skudskud-uber-eats-automation)). The closest
  restaurant-owned reference is [OrderAI](https://akshit.ahuja.js.org/orderai/) (MCP → Square,
  food trucks). Toast has [no official AI connector](https://community.toasttab.com/t5/restaurant-operations/feature-request-ai-agent-mcp-connector-for-toast-menu-and/m-p/18916).
  Nobody clearly owns "order from any restaurant from your chatbot, and the restaurant can
  claim it." That gap is the opening.
- **Rules cited:** Stripe [charge types](https://docs.stripe.com/connect/charges) ·
  [card holds](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method) ·
  [Issuing virtual cards + PCI](https://docs.stripe.com/issuing/cards/virtual) ·
  [restricted businesses](https://stripe.com/legal/restricted-businesses) ·
  [NYC delivery-app rules](https://www.nyc.gov/site/dca/businesses/Restaurants-Using-Delivery-Apps.page) ·
  [CA AB 2149](https://www.nrn.com/delivery-takeout-solutions/california-to-stop-controversial-third-party-delivery-tactic-in-2021) ·
  [FCC AI-voice TCPA ruling](https://huntonak.com/privacy-and-information-security-law/fcc-issues-declaratory-ruling-that-tcpa-applies-to-ai-generated-voice-calls) ·
  marketplace-facilitator tax ([BDO](https://www.bdo.com/insights/tax/marketplace-facilitators-third-party-delivery-platforms-and-retail-delivery-fees-key-sales-tax)).
