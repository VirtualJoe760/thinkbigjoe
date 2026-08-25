# Nano Crew — the funding brief

> **Status**: ACTIVE — the source-of-truth dossier for the (planned) full-time **funding agent**,
> whose job is to find money for Nano Crew: grants, credits, accelerators, angels, pre-seed funds.
> **Written**: 2026-08-24 · **Owner**: Joseph Sardella
> **Grounding**: every number here was read from the Nano Crew codebase
> (`~/code/nanocrew`) on the date above — pricing from `src/lib/billing.ts` + `src/lib/pricing.ts`,
> status from `docs/roadmap/REMAINING_FEATURES.md`. When this doc and that repo disagree, the repo
> wins; update this doc in the same change.
>
> ⚠️ **Nano Crew is a separate product and codebase** (`~/code/nanocrew`), not part of the TBJ
> pipeline. This doc lives here because the *agent org* that will work the funding pipeline lives
> here. Nothing in this doc authorizes touching the nanocrew repo.

---

## The company in five lines

1. **Nano Crew is AI-native creator commerce**: a creator *talks* to an AI (Venus, voice or text) and gets a real clothing brand — products, a Printful-backed shop, and their own storefront website — without a designer, a developer, or a Shopify build.
2. The wedge is the **full loop in one app**: voice interview → live brand website in minutes → AI-generated products and on-model photos/video → sell → edit the site by chatting.
3. **Three revenue streams**: subscriptions ($10/$50/$175 per month), a margin on every product sold, and AI-generation credits.
4. It is **live on TestFlight, submitted to the App Store**, with Android in Play internal testing and a first real client (a 28-product brand) migrated onto the platform. Pre-revenue: Stripe is still in test mode pending launch.
5. Built and operated by **one founder leveraged by AI agents** — the same operating model TBJ runs — so the burn is infrastructure, not headcount.

---

## 1. Business standpoint

### The problem
Social and YouTube creators want merch brands, but the current path is a stack of separate hires
and tools: a designer for the products, a developer (or Shopify + apps) for the store, a POD
integration, photography for product shots. Most creators either don't launch or launch something
generic through a merch aggregator that owns their storefront and their customer relationship.

### The product
One app (iOS + Android, Expo/React Native). The creator:

1. **Talks to Venus** — a real-time voice AI brand consultant (Gemini Live) with an animated 3D avatar — who interviews them and authors a build brief.
2. **Gets a website** — a second AI (a conditioned, headless Claude "forge robot") turns one of 5 storefront templates into a presentable brand site on its own domain path, instantly.
3. **Designs products by AI** — logos, garment designs, on-model photo shoots (Gemini image), and on-model *video* (fal.ai / Veo tiers) — published to Printful for print-on-demand fulfilment. No inventory, ever.
4. **Sells** — every surface checks out through Nano Crew's central point-of-sale (Stripe → Printful); the in-app **Market** cross-lists every brand.
5. **Edits by chatting** — copy/colors/fonts change live with no rebuild (mini-CMS); structural redesigns go back through the forge robot. The creator can literally circle something on a screenshot of their site and say what to change.

### Who pays, and what
| Plan | Price (web/Stripe) | Gets |
|---|---|---|
| **Starter** | **$10/mo** | The app: 1 brand, products, Printful shop, Market listing, 500 credits/mo |
| **Pro** | **$50/mo** | + the standalone brand **website** + custom domain, 3 brands, 3,000 credits/mo |
| **Advanced** | **$175/mo** | + 12,000 credits/mo and effectively unlimited brands |

Plus:
- **Per-sale margin** — every product must clear its Printful base cost by **at least $5**; the platform fee covers COGS + shipping + commission, with payouts to creators via Stripe Connect destination charges (7-day hold, defect-only returns).
- **AI credits** — generation (images, model shoots, video) is credit-metered at **$0.01/credit** (packs of 500 / 1,500 / 5,000, no volume discount). Every generation is priced at **≥2× the real API cost**, and video tiers run 60–400 credits per generation — so credits are a real, margin-positive, scaling stream rather than absorbed AI COGS.
- iOS purchases go through **Apple IAP (StoreKit 2)** with server-side receipt verification; web through Stripe.

### Why this can win (the moat)
- **The demo is the moat's front door**: voice-interview → live personal storefront in one sitting is a "show, don't tell" product. Nothing in the creator-merch space does the whole loop.
- **The storefront is theirs, not a marketplace page** — per-brand Next.js sites with real SEO (JSON-LD, sitemaps, OG), a custom domain on Pro, and a creator `/admin`. Aggregators (Spring/Teespring, Fourthwall, Spreadshop) keep the creator inside *their* box; Shopify gives ownership but demands a build.
- **Switching costs compound**: the brand's site, product catalog, order history, customer emails, and payout rails all live on the platform.
- **Operating leverage**: templates are **thin clients** — no secrets, no commerce code — so adding a POD provider or a feature is one central change that upgrades every brand site at once. The architecture is built for N brands at ~zero marginal cost.

### Traction & status (be honest — the agent must never overstate this)
- **Live on TestFlight** (iPhone, build 38), **submitted to the App Store**; Android `.aab` in Play internal testing.
- **First real client migrated**: an existing brand (28 products, 685 variants) imported onto Nano Crew's Printful + database — proof the rails carry a real catalog.
- **Pre-revenue**: Stripe is in test mode; the remaining go-live items are configuration (live keys, App Store Connect products, webhooks), not engineering.
- A US **marketplace-compliance plan** exists (Stripe Connect KYC, INFORM Act disclosure, Stripe Tax as marketplace facilitator, an age gate) — diligence questions have answers.

### Market frame (for pitch materials)
Creator economy monetization + print-on-demand + AI site-building, at the intersection. The honest
positioning: **"Shopify + a designer + a photographer + a developer, collapsed into a conversation."**
Target customer is the mid-tail creator (10k–1M followers) who has an audience but no operations.

---

## 2. Technical standpoint

### Architecture — four deployable units, one shared Postgres
| Unit | What | Runs on |
|---|---|---|
| **Mobile app** | Expo SDK 54 / React Native 0.81 / React 19, iOS + Android + web; server API routes | App stores; backend on **Railway** (persistent Node) |
| **platform-api** | Public storefront API, central POS (Stripe), webhooks | Vercel (Next.js 16) |
| **Templates** ×5 | Per-brand Next.js storefront sites, thin clients, `brand.json` token contract | Vercel, one project per brand |
| **The forge** | Headless **Claude CLI** robot + worker queue that builds/revises brand sites on `revision/<id>` branches → Vercel preview → approve → merge | DigitalOcean droplet |

One **Supabase Postgres** (RLS deny-all on every table; servers use the service key; strict
per-creator tenancy) underpins all four.

### The two-AI design (the interesting part)
- **AI #1 — Venus** (Gemini): real-time voice (Gemini Live) + TTS, a Skia/three.js animated avatar with custom FFT lip-sync DSP (unit-tested), image generation ("Nano Banana" with a chroma-key transparency pipeline), video generation (fal.ai: wan/seedance/Veo3 tiers), and `gemini-2.5-pro` authoring the build brief.
- **AI #2 — the forge robot** (Anthropic Claude, headless): conditioned by a master CLAUDE.md, it takes the brief and builds/edits *actual Next.js codebases* per brand, branch-based with preview-then-approve. Deterministic edits (copy, colors, products) bypass it entirely via direct DB-backed APIs — instant and cheap; only open-ended creative work costs robot time.
- The **AI-visual-feedback loop**: creators annotate a live screenshot of their site (circle/arrow via on-device capture), and the annotated image is fed to the robot as proof of what to change.

### Engineering maturity signals (for technical diligence)
- Strict TypeScript across 4 units; typecheck + lint + export gates before every push.
- Money paths are debit-then-refund atomic; credit-gated AI routes are rate-limited.
- Security posture: RLS lockdown fixed a real anon-key hole; IDOR class audited out of the designer endpoints; storefronts carry zero secrets.
- Apple IAP with App Store Server API verification (not legacy receipts); Stripe Connect destination charges with payout holds.
- A living docs/context system (the architecture *is* the product — templates are generated from it).

### Cost structure
Fixed infra is small (Railway + Vercel + one droplet + Supabase). Variable costs are AI inference
(recovered via credits) and Printful COGS (recovered in the product price with the $5 floor).
Headcount is one founder + AI agents. This is a company where a modest raise buys a long runway.

### Honest technical debt / risk (do not hide in diligence; do have the answer ready)
- The forge's **build quality** is the active engineering epic — first builds can look templated; the fix (robot self-critique with screenshots + a real quality gate) is designed and partially shipped.
- Two hand-kept mirrors (schema copy, forge worker) are process risk at team scale — fine solo, needs CI when hiring.
- Platform dependence: Printful (mitigated — a POD-provider abstraction already exists), Apple review, Gemini/Claude pricing.

---

## 3. Investment strategy

### Stage, honestly stated
Pre-seed, pre-revenue, solo technical founder, product built and in app review, first client
onboarded. The fundable story is **"the product is done and the founder is free"** — money buys
distribution and runway, not engineers.

### The strategy is a ladder — cheapest money first
The agent works these **in order**. Do not lead with VC; lead with money that costs nothing.

**Rung 1 — Non-dilutive, apply-and-win (start immediately, all in parallel):**
- **Cloud + AI startup credit programs**: Google for Startups (Gemini is the core AI vendor — the story writes itself), AWS Activate, Microsoft Founders Hub, Anthropic's startup program (Claude powers the forge), Vercel/Supabase/DigitalOcean startup tiers. These directly reduce the largest variable cost.
- **Pitch competitions & founder grants**: recurring searchable pipeline — creator-economy, commerce, AI-application, and solo-founder/bootstrapper grants.
- **Partner programs**: Printful/Stripe partner and app-ecosystem programs (marketing co-op, fee rebates, featured placement).

**Rung 2 — Accelerators (applications are free; the network is the product):**
- Y Combinator, Techstars, a16z Speedrun, Google for Startups Accelerator, and creator-economy-specific programs. An accelerator solves the solo-founder distribution problem better than an equivalent angel check.

**Rung 3 — Angels (after launch, with first revenue data, however small):**
- Target operators from the exact adjacent worlds: creator-economy (Gumroad/Patreon/Kajabi alumni), commerce (Shopify/Fourthwall alumni), POD (Printful/Printify), plus **creators themselves** as angel-investors — a creator who invests is also a flagship brand on the platform.

**Rung 4 — Pre-seed funds (only with a traction curve):**
- Creator-economy and consumer-commerce pre-seed funds. Raise on a chart, not a deck: N paying creators, M product sales, credit-spend per creator.

**Rung 5 — parked**: revenue-based financing / venture debt. Only relevant post-revenue; revisit at consistent MRR.

### Milestones → what they unlock
| Milestone | Unlocks |
|---|---|
| App Store approval + Stripe live | Rung 1 applications get a live product link; launch content |
| First 10 paying creators | Angel conversations with real quotes and screenshots |
| First $1k MRR + product-sale GMV | Accelerator applications with a metrics slide |
| A repeatable acquisition channel | Pre-seed raise on the curve |

### What the funding agent DOES
- Builds and maintains a **target pipeline** (programs, competitions, funds, angels) with deadlines, fit notes, and status — dossier + temperature style, like the TBJ CRM.
- **Drafts** applications, cold emails, and follow-ups for Joe's review. Personal-first doctrine applies (see `COLD_EMAIL.md`): personalize, big fast value, one soft CTA.
- Maps **warm-intro paths** to each target before recommending a cold approach.
- Maintains the **materials checklist** and flags gaps: one-pager, deck, 90-second demo video (the voice→website moment IS the pitch), data-room folder (metrics, cap table, compliance plan).
- Monitors deadlines (accelerator batches, grant cycles) and surfaces them ahead of time.

### What the funding agent NEVER does (hard rules — same class as `NEVER_VIOLATE`)
- **Never sends anything without Joe's explicit approval.** Draft → queue → Joe sends (or approves the send).
- **Never signs, accepts terms, commits to valuations, amounts, equity, or meetings** — every commitment is Joe's, made by Joe.
- **Never overstates traction.** "Pre-revenue, live on TestFlight, App Store submitted, first client migrated" is the truthful line until the numbers change. One fabricated metric poisons every future conversation.
- **Never shares** repo access, credentials, financial details, or customer/creator data. The data room is curated by Joe, not assembled ad-hoc by the agent.
- **Never pays** an application fee, "pitch fee," or intro broker without Joe — most paid pitch opportunities are spam, and fee-based intro brokers are a red flag by default.

### Build note (when the agent gets built)
It's an OpenClaw agent — load the `openclaw` skill and follow `AGENT_PLAYBOOK.md` before touching
the org. THE RULE applies: it ships with a `/command/**` surface (the funding pipeline board), MCP
tools (pipeline read/write in `tbj-mcp.mjs`, with `audit()`), and a cron — all in one PR. Model
and quota per `OPENCLAW.md`.

---

*Update triggers: Nano Crew pricing or plan changes (`src/lib/billing.ts`) · launch/traction
changes (App Store live, Stripe live, paying creators) · the funding agent ships (add it to
`OPENCLAW.md` + `VENUS_UI_MAPPING.md` and link its surfaces here).*
