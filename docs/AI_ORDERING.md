# AI_ORDERING.md — restaurants take pickup orders from Claude / ChatGPT

**Status (2026-10-12): DESIGN ONLY. Nothing is built.** Decisions made so far: write this doc
before building · **no pilot restaurant yet** (Phase 1 runs on a demo restaurant in Stripe test
mode) · TBJ earns a **small per-order fee** via Stripe Connect. Open decisions are in §13.

## 1. What it is

A customer says to their own chatbot, *"order me a cheeseburger from Joe's Grill, no pickles, I'll
grab it at 6."* The chatbot finds the restaurant, reads the menu, builds the order, and hands back
a link. The customer pays on their phone and picks up the food. The money goes straight to the
restaurant, and TBJ keeps a small fee.

**Who does what (AGENTS.md, "build the agent, don't *become* the agent"):** the **customer's own
chatbot is the actor**. It does the conversation: clarifying, upselling, "no pickles". We build
**only tools and pages**, meaning a public MCP server plus an order page. There's no app-side
model call and no TBJ agent in the loop for an order. The one judgment-shaped job, turning a
messy PDF menu into structured items (§8), *is* agent work and goes to an OpenClaw agent.

**Why TBJ:** delivery apps take 15–30% of an order. "Customers order from your website *and*
from ChatGPT/Claude, and you keep the money" is an upsell for restaurant clients and a hook for
prospecting restaurants. Restaurants are already a forge niche (`src/lib/forge-templates.ts`).

## 2. The customer flow

```
Customer ──"burger from Joe's Grill, no pickles, 6pm"──▶ their chatbot (Claude / ChatGPT)
   chatbot ── find_restaurant("Joe's Grill", near "Tempe")  ─▶ TBJ public MCP
   chatbot ── get_menu(rest_123)                             ─▶ items, options, prep time, hours
   chatbot reads the order + total back, customer says "yes"
   chatbot ── create_order(rest_123, items, pickup 18:00, name, phone) ─▶ TBJ public MCP
            ◀── order_id, line items, subtotal/tax/total, ready_by 18:00, pay_url
Customer taps pay_url  ─▶ thinkbigjoe.com/o/<token>  (summary + ready time + Pay)
            ─▶ Stripe Checkout (Apple Pay / Google Pay / card), as the RESTAURANT
            ─▶ back to /o/<token>: "Paid ✓ — ready at 6:00"
Stripe webhook (paid) ─▶ order goes to the kitchen: text to restaurant + portal Orders screen
Restaurant taps Accept → (cooks) → Ready  ─▶ /o/<token> shows live status
Customer picks up. Restaurant taps Picked up (or it auto-closes at end of day).
```

**About "send them an artifact":** the Artifact tool is Joe's Claude Code tool. A stranger's
chatbot can't call it. The universal, phone-readable thing is **a link to our own page**
(`/o/<token>`), which renders in every chatbot. An inline order card (MCP Apps UI in Claude and
the ChatGPT Apps SDK) is a Phase 3 nicety on top of the same link.

## 3. Architecture

```
 customer's chatbot ──HTTPS (Streamable HTTP MCP)──▶ /api/mcp         (NEW, public, no auth)
                                                       │  reads menus/settings, writes orders
 customer's phone ──▶ /o/[token]  (NEW order page) ──▶ Stripe Checkout on the restaurant's
                                                       connected account (direct charge)
 Stripe ──Connect webhook──▶ /api/stripe/connect-webhook (NEW) ──▶ orders.status = paid
                                                       └─▶ sendSms(restaurant)  (src/lib/sms.ts)
 restaurant owner ──▶ /portal/orders, /portal/menu   (NEW portal screens)
 Joe ──▶ /command/orders (NEW overview) · Venus ──▶ list_food_orders (tbj-mcp.mjs, read-only)
 sweep (§10) ──▶ expire unpaid · auto-refund unaccepted
                         all of it ──▶ Neon (new tables, §5) keyed to forge_sites.id
```

All of it lives **in this repo** (Vercel app). Nothing in the forge changes until Phase 2 adds an
"Order with AI" button to restaurant templates.

## 4. The public MCP server (`/api/mcp`)

**It's separate from `mcp-server/tbj-mcp.mjs`, on purpose.** tbj-mcp.mjs is the agents' internal
toolbox: stdio, Joe's Mac, and it can write to everything. This one is internet-facing and
anonymous. It shares **no code path** with tbj-mcp.mjs and can only reach the ordering tables.
Implement it as a Next route handler using the MCP SDK's Streamable HTTP transport in stateless
mode (the SDK is already a dependency in `mcp-server/package.json`; Vercel's `mcp-handler`
adapter is the alternative). **This repo runs a customized Next.js build, so check
`node_modules/next/dist/docs/` for route-handler differences before writing it.**

**No sign-in for the MVP.** MCP authorization is *optional* in the spec. Requiring OAuth would add
a login step before a customer can even see a menu. Identity comes from the order itself (name +
phone), and payment is the real gate.

### Tools

| Tool | Input | Returns | Notes |
|---|---|---|---|
| `find_restaurant` | `query`, `near?` (city / zip) | up to 5 × {id, name, address, open_now, est_wait_min} | Only restaurants with ordering **enabled**. MVP matches on name + city text; geo search later. |
| `get_menu` | `restaurant_id` | categories → items {id, name, desc, price, available} + option groups (e.g. "Toppings", "Remove: pickles") + hours, prep time, allergy disclaimer | Read-only. Cache it, since it's hit on every conversation. |
| `create_order` | `restaurant_id`, `items[{item_id, qty, option_ids[], note?}]`, `pickup_at?`, `customer_name`, `customer_phone` | order_id, priced line items, subtotal, tax, total, **ready_by**, **pay_url**, expires_at | The server prices everything and sets the time (rules below). Status starts at `pending_payment`. |
| `get_order_status` | `order_id` | status + ready_by | So "is it ready?" works in the same chat. |
| `cancel_order` | `order_id` | ok | Only while still `pending_payment`. After payment, cancelling is the restaurant's call. |

**Server-side rules (the chatbot is never trusted with money or time):**

- **Prices come from our DB, never from the chatbot.** The chatbot sends only item and option
  IDs. Unknown or unavailable IDs are rejected with a readable error so the chatbot can re-ask.
- **The ready-by time is computed, never invented** (§9). If the requested `pickup_at` is too
  early or outside opening hours, the response returns the earliest valid time plus a message
  the chatbot can relay.
- **Read-back before ordering.** `create_order`'s tool description tells the chatbot to read
  the items + total back and get an explicit yes before calling it. Tool descriptions are how we
  "instruct" a chatbot we don't control.
- **Free-text `note` is capped (140 chars)** and shown to the kitchen as a quoted customer note,
  never interpreted. **Allergies aren't guaranteed.** `get_menu` returns the restaurant's
  disclaimer, and the tool description tells the chatbot to say so.
- **Rate limits:** per IP and per phone on `create_order`, e.g. 10 unpaid orders per hour per
  phone. Unpaid orders expire in 30 min and never reach the kitchen, so spam costs the
  restaurant nothing.

## 5. Data model (new tables)

Create these with a SQL migration, then run `npm run db:pull` (the DB owns the schema; never
hand-edit `src/db/schema.ts`). Everything is keyed to `forge_sites.id`, because a restaurant is a
claimed TBJ site.

- **`ordering_settings`** (1 row per site): `site_id` (unique) · `enabled` · `paused` (the owner's
  "stop orders tonight" switch) · `stripe_account_id` · `charges_enabled` (mirrored from Stripe) ·
  `notify_phone` · `prep_minutes` (default 20) · `max_orders_per_slot` · `hours` jsonb (by
  weekday, uses `forge_sites.booking_timezone`) · `tax_rate_bps` · `fee_fixed_cents` /
  `fee_bps` (TBJ's cut, per restaurant) · `allergy_disclaimer`.
- **`menu_items`**: `id` · `site_id` · `category` · `name` · `description` · `price_cents` ·
  `available` · `sort` · `option_groups` jsonb `[{id, name, min, max, options:[{id, name,
  price_cents}]}]`. Options are jsonb for the MVP rather than separate tables, because menus are
  small and edited as a whole.
- **`food_orders`**: `id` · `public_token` (unguessable, used in `/o/<token>`) · `site_id` ·
  `status` (`pending_payment → paid → accepted → ready → picked_up`, plus `expired`, `rejected`,
  `refunded`, `cancelled`) · `customer_name` · `customer_phone` · `items` jsonb (**a snapshot of
  names + prices at order time**, so later menu edits never rewrite a past order) · `subtotal_cents`
  · `tax_cents` · `total_cents` · `fee_cents` · `requested_pickup_at` · `ready_by` · `source`
  (`mcp` / `web` / `voice`) · `client_hint` (which chatbot, if the client sent one) ·
  `stripe_checkout_session_id` · `stripe_payment_intent_id` · timestamps for each status change.

Indexes: `food_orders (site_id, status)` and `(public_token)`. The portal's live Orders screen
polls with `WHERE site_id = $1 AND status IN ('paid','accepted','ready')`. **It never runs a
full-table SELECT behind auto-refresh**, because Neon *data transfer* is the budget that caused
the 2026-07 outage.

## 6. Payments — Stripe Connect, direct charges

This repo already uses Stripe (`src/lib/stripe.ts`, `/api/stripe/webhook`) for TBJ's *own*
subscriptions. Connect is new. **Stripe Connect** is Stripe's feature for platforms that take
payments on behalf of other businesses. Each restaurant gets its own Stripe account (a
"connected account"), linked to TBJ's.

**Recommendation: direct charges.** The payment is created *on the restaurant's account*, and TBJ
takes an `application_fee_amount`. Per Stripe's Connect docs:

- The restaurant is the business of record. Its name is on the customer's card statement, and
  the money settles in its balance.
- **Refunds and chargebacks come out of the restaurant's balance, not TBJ's.** That's the main
  reason to choose this: a one-person agency shouldn't carry restaurants' disputes. Destination
  charges would put refunds and disputes on TBJ's platform balance.
- TBJ's fee lands in TBJ's balance automatically, per order.
- Stripe doesn't recommend direct charges with **legacy v1 Express/Custom accounts**. Use
  **v2 accounts** (or Standard accounts, where the restaurant gets the full Stripe dashboard).
  Onboarding is Stripe-hosted. We create the account, send the owner to Stripe's onboarding
  link from the portal, and mirror `charges_enabled` back when Stripe's `account.updated`
  webhook fires.

**Checkout:** a Stripe-hosted **Checkout Session created on the connected account** (the
`Stripe-Account` header) with `payment_intent_data.application_fee_amount`. Hosted Checkout gives
us Apple Pay and Google Pay without registering a domain per restaurant. The `/o/<token>` page's
Pay button just redirects there. A session expires with the order (30 min).

**Webhooks:** events from connected accounts go to a **separate Connect webhook endpoint with
its own signing secret**. They do *not* arrive at the existing `/api/stripe/webhook`. Add
`/api/stripe/connect-webhook` and handle `checkout.session.completed` (→ `paid`, notify the
kitchen), `checkout.session.expired` (→ `expired`), `charge.refunded`, and `account.updated`.
**These must be idempotent.** Stripe redelivers, so use the same pattern as the existing webhook's
`RETRYABLE_EVENTS`, and return a 5xx on a handler failure for anything we must not drop. The
"Stripe 200-on-error" item in `meta-ads-next` is the cautionary tale.

**The per-order fee (Joe's decision: small per-order fee):** per-restaurant `fee_fixed_cents` +
`fee_bps`. Proposed default: **$0.99 flat, charged to the restaurant** (out of the payment, never
added to the customer's total), so menu prices are exactly what the customer pays. See §13.

**Tax:** the MVP uses one `tax_rate_bps` per restaurant, set by the owner, and we compute it.
Stripe Tax for Connect is a later upgrade if a restaurant needs per-item tax rules.

## 7. Getting the order to the kitchen

The order goes to the kitchen **only after payment** (on the webhook), never at `create_order`.

- **Phase 1:** a **text to the restaurant's `notify_phone`** via `src/lib/sms.ts`: *"New order
  #A7 — 1× Cheeseburger (no pickles) — ready by 6:00 PM — tap to accept: <link>"*. The link opens
  `/portal/orders`, which shows live orders with **Accept / Ready / Picked up** buttons.
- **Accept window:** a paid order that isn't accepted within **10 minutes** gets a second text.
  Within **20 minutes** it's **auto-refunded**, and `/o/<token>` tells the customer. The customer
  is never charged for food nobody saw.
- **Later:** push straight into the restaurant's register system. **Square** has an open
  Orders API, the best first target. **Toast** gates its API behind a partner program and has no
  official AI/MCP connector. Ivy (the voice receptionist) could also *call* the restaurant for an
  unaccepted order.

**SMS campaign caution:** texts go through the shared `jsardella` "Low Volume Mixed" A2P campaign
(`docs/SMS.md`). **Texts to restaurants** (TBJ → its own client) fit that campaign. **Texts to
customers on a restaurant's behalf** are a new use case that SMS.md warns against stretching the
campaign for. So **Phase 1 sends no customer texts**: the customer tracks status on
`/o/<token>`. A "your food is ready" text waits for a dedicated campaign (§13). Likewise **no
email** in Phase 1. Any order email goes through the `DELIVERABILITY.md` gate first.

## 8. Menus

The menu must be structured data: items, prices, options. It can't be a PDF.

- **Phase 1:** a `/portal/menu` editor where the owner or Joe types items in. For the demo
  restaurant, seed it from a script.
- **Phase 2, menu import:** reading a messy website, PDF, or photo of a menu is *judgment*, so
  it's **agent work**, not app code. An OpenClaw agent (likely `marketing-manager`, or a new
  `menu` agent via `/create-agent`) drafts the structured menu through a new tbj-mcp.mjs tool,
  `save_menu_draft`. **The owner must confirm prices in the portal before it goes live**, because
  prices and allergy info are the restaurant's responsibility.
- **Phase 2, Square sync:** if the restaurant uses Square, sync its catalog (deterministic, a
  scheduled script) instead of importing.

## 9. Ready-by time

The server computes `ready_by`. The chatbot only relays it.

```
earliest   = now + prep_minutes + (queue load: +5 min per open order in the next 30 min)
ready_by   = max(requested_pickup_at ?? earliest, earliest)
           → bumped to the next slot with room if the slot already has max_orders_per_slot
           → rejected with "opens at 11:00 AM — earliest pickup 11:20" if outside hours
```

The owner's `paused` switch and hours apply. If ordering is paused, `find_restaurant` still lists
the restaurant but marks it *not taking orders right now*.

## 10. The sweep (scheduled work)

The sweep is deterministic and time-critical (refunds within minutes), so it's **not** an agent
cron. It needs to run about **every minute**:

1. Expire `pending_payment` orders older than 30 min.
2. Re-text the restaurant at 10 min unaccepted, and auto-refund at 20 min.
3. Auto-close `ready` orders to `picked_up` at end of day.

**Open question (§13):** the app's Vercel crons (`vercel.json`) all run once a day today.
Per-minute crons need a Vercel Pro plan. The fallback is a launchd script on Joe's Mac, but that
stops when the Mac sleeps, which is a bad place for a refund promise. Belt-and-braces either way:
also run the sweep **lazily** for a restaurant whenever its Orders screen or an MCP call touches it.

## 11. Shipping it full-stack (THE RULE, `VENUS_UI_MAPPING.md`)

| Layer | What ships |
|---|---|
| **UI** | `/portal/orders` (live orders + Accept/Ready/Picked up) · `/portal/menu` (editor) · ordering settings and **Connect onboarding** in `/portal/settings` · `/o/[token]` (public order page) · `/command/orders` (Joe: all restaurants, today's orders, fees earned, stuck orders) |
| **MCP tool** | The public `/api/mcp` (§4), plus in `tbj-mcp.mjs`: `list_food_orders` (read-only, so Venus can report "3 restaurants took 41 AI orders this week") and later `save_menu_draft` (calls `audit()`) |
| **Schedule** | The per-minute sweep (§10). Later: Square catalog sync, and a weekly line in Venus's digest. |

Docs to touch when this ships: `MCP_TOOLS.md` (it currently says tbj-mcp.mjs is *the* MCP
server, which will no longer be true) · `SMS.md` (the new restaurant alert texts) · `plans.ts`
copy if ordering becomes a plan feature · this doc's status line.

## 12. Phases

**Phase 1: demo (Stripe test mode, no real money, no real restaurant).**
A fake "TBJ Test Kitchen" site row with a seeded menu · the Connect test account · the full
`/api/mcp` → `/o/<token>` → Checkout → webhook → text → Accept flow · Joe adds the connector in
Claude ("Add custom connector" → `https://thinkbigjoe.com/api/mcp`) and orders a burger from his
phone end to end.
*Exit criteria:* one order goes all the way to `picked_up`. One deliberately ignored order
auto-refunds. A chatbot sending a fake price or a past pickup time is rejected cleanly.

**Phase 2: first real restaurant.**
Live-mode Connect onboarding · menu import agent or Square sync · the restaurant's own TBJ site
gets an "Order with ChatGPT / Claude" section showing the connector URL (forge template change) ·
the prospector starts tagging restaurant leads.
*Exit criteria:* a week of real orders with zero missed (unaccepted) orders.

**Phase 3: reach.**
Submit to Claude's connector directory and the ChatGPT app directory · inline order card (MCP
Apps UI) · Square register push · Ivy takes **phone** orders through the same `create_order`
(source = `voice`). One order engine, three front doors: chatbot, website, and phone.

## 13. Open decisions

| Decision | Recommendation |
|---|---|
| Fee amount + who pays | **$0.99 flat per order, paid by the restaurant** (out of the payment). Simple to sell: "$0.99 an order vs 15–30% on DoorDash." Alternative: a customer-paid convenience fee. |
| Per-minute sweep host | **Vercel Pro cron** if the plan allows it, plus the lazy sweep. Check the Vercel plan before Phase 1. |
| Customer "food is ready" texts | Defer. Needs a dedicated A2P campaign (SMS.md). The order page covers status in Phase 1. |
| Tips | Defer. Hosted Checkout has no native tip line, so it would be a tip choice on `/o/<token>` that adjusts the amount. |
| Is ordering a plan feature or an add-on? | Add-on on any plan for now, paid via the per-order fee. Revisit pricing after Phase 2. Per the positioning rule, don't advertise prices publicly. |
| Pilot restaurant | None yet (Joe, 2026-10-12). Have the prospector tag restaurant leads once Phase 1 works. |

## 14. Landscape (2026-10, for context)

A growing set of **community-made** MCP servers order from DoorDash, Uber Eats, Taco Bell, and
Zomato, mostly by scraping or private APIs, so they break and may violate terms. Examples:
[DoorDash MCP](https://glama.ai/mcp/servers/markswendsen-code/mcp-doordash),
[Uber Eats MCP](https://playbooks.com/mcp/skudskud-uber-eats-automation),
[Taco Bell MCP](https://skillselion.com/mcp/tool/io.github.markswendsen-code/tacobell). The
closest real reference for *restaurant-owned* ordering is [OrderAI](https://akshit.ahuja.js.org/orderai/),
a hobby project for food trucks: MCP tools → Square Orders API → Square-hosted checkout. Toast has
[no official AI connector](https://community.toasttab.com/t5/restaurant-operations/feature-request-ai-agent-mcp-connector-for-toast-menu-and/m-p/18916).
Nobody clearly owns *commission-free, restaurant-owned* ordering from chatbots, and that gap is
the opening.
