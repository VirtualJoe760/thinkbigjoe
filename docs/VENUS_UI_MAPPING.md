# Venus ↔ UI Mapping

Every surface in the TBJ command center is powered by a specific Venus cron, MCP tool, or
engine script. This doc is the source of truth for that connection. **When you change a UI
feature, check this doc and update the cron/tool that feeds it — and vice versa.**

For the OpenClaw/agent side (roster, model routing, crons-as-code mechanics), see
[OPENCLAW.md](OPENCLAW.md). For the site-building pipeline (forge, templates, queue safety,
cost), see [FORGE.md](FORGE.md). This doc is the UI-facing map that ties both to what Joe sees.

---

## THE RULE: a feature ships full-stack, in one PR

Never build a capability as "just UI" or "just backend." Every one is **three layers that ship
together** — miss a layer and it silently fails:

1. **UI surface** — the page/section under `src/app/(frontend)/command/**` where Joe sees/controls it.
2. **MCP tool** — a named tool in `mcp-server/tbj-mcp.mjs` reading/writing the right DB table
   (register it in BOTH the `ListTools` handler AND the `CallTool` switch; bump the server version).
3. **Cron entry** — a declaration in `src/lib/venus-crons.mjs`, then `npm run venus:sync` — OR,
   for deterministic (non-agent) work, a scheduled script under `scripts/*.mjs` + a launchd plist.

Failure modes if you skip one: UI with no tool → page forever empty · tool with no cron → ability
never used · cron with no UI → work happens with no way to review it.

**Build all three in the same change.** The checklist at the bottom enforces this.

---

## Command-center nav (7 tabs)

The nav follows the funnel: **Build → Prospect → Sell.**

| Tab | Route | What it's for |
|---|---|---|
| **Overview** | `/command` | Dashboard — appointments, calendar connection status, top-line stats. |
| **Engine** | `/command/engine` | The **engine room / ops cockpit** — run + monitor the forge. **Weekly spend gauge** (run-budget used vs remaining, 75/90% color states), **14-day activity chart** (builds/edits/outreach) + throughput cards, **granular controls** (master + new-site-builds / customer-edits / idle-templates toggles + a settable `weekly_run_budget`), the **build queue** (elapsed + ETA) and **customer edit queue** (with live "view site" links), "Clear stuck builds", and a forge **activity feed** with live-site links. All numbers come from `getForgeDigest()` (`src/lib/forge-stats.ts`). Controls gate `forge-poll`/`edit-poll` per-capability — see FORGE.md's "Granular controls + weekly run-budget" note. The same digest surfaces on the **Overview** ("Engine flow" card) and via the **`forge_digest` MCP tool**. |
| **Prospecting** | `/command/prospects` | The pipeline: web-dev leads (find → review → **Built**, gated behind marketing approval) + the showroom preview/outreach dials. Cross-links to the call room. |
| **Leads** | `/command/leads` | The **call room** — only sites Joe has approved for marketing. Photo, reviews, a ready calling script, click-to-call/text/email. Cross-links back to Prospecting. |
| **Appointments** | `/command/appointments` | DB-enriched booked-call detail (role/industry/team-size/timeline, calendar links). |
| **Venus** | `/command/crons` (+ sub-nav: Crons / Audit log / Team) | Cron manifest + last-run, the audit log (`activity_log`), and the OpenClaw team roster. |
| **Settings** | `/command/settings` | Automation on/off, calendar connection, analytics link. |

`/command/analyzer` (site analyzer) and `/command/sites` (deprecated — deleted) hang off
Prospecting via the `match` array in `command-header.tsx`, not as top-level tabs.

---

## `/command/prospects` — Prospecting pipeline

The forge queue **and** the Lead Engine panel live here. See [FORGE.md](FORGE.md) for the full
lifecycle diagram; this table is the UI-to-data mapping.

| View | DB source | Who/what writes it |
|---|---|---|
| Needs review (`discovered`) | `forge_sites.status='discovered'` | `add_forge_prospect` (prospector) or the Lead Engine (Apify, `source='lead_engine'`) |
| Queued to build (`approved`/`building`) | Joe clicks Approve → `approveForgeSite()` | `factory/forge-poll.mjs` flips it to `building` when it claims the row (see FORGE.md queue rules) |
| **Built** (`built`) | `POST /api/forge/register` | Review-only until `marketing_approved_at` is set. Card shows: ✏️ Edit site · 🎨 Image studio · 🛠 Ask forge to revise · 🎲 Rebuild differently · **✓ Approve for marketing**. |
| Denied / failed | Joe clicks Deny → `denyForgeSite()` (also writes `forge_blacklist`) | or a build error via `/api/forge/register` |
| **Lead Engine panel** | `lead_engine` table (single row) | Goal/budget config + live progress (leads this month/today, Apify spend). "Find leads now" / "Enrich now" buttons write to `job_requests`, drained by `scripts/trigger-poll.mjs` on Joe's Mac. |
| Filter chips / sort | in-memory over the same query | Has phone / email / social / reviews / following; sort by reviews/rating. |

**Server actions** (`command/actions.ts`): `approveForgeSite`, `denyForgeSite`,
`approveForMarketing` / `unapproveMarketing`, `requestForgeRevision`, `requestForgeRebuild`,
`requestLeadJob`.

---

## `/command/leads` — the call room

**Gated to `marketing_approved_at IS NOT NULL`.** A built-but-unapproved site never appears here —
it's still "in review" on Prospecting. Each card (`LeadCallCard`) shows a business photo
(Maps/Facebook, monogram fallback), star rating + real review quotes, social follower reach, and a
generated **calling script** (a personalized opener + the per-lead "angle" from call-prep). Buttons:
📞 Call, 💬 Text the link, 🔗 Live site, ✉️ Email.

The room is a **CRM**: a table of contacts by pipeline stage (`new → contacted → replied → bad-contact
→ user → customer`), each row with a **business thumbnail** (`photo_url`, sourced by the enrichment cron
from Maps/social) and rich at-a-glance data (rating, activity). Tapping opens a contact screen led by a
**dominant business image**, plus a **preview of the site we built** — the stored `screenshot_url` if
present, else a live (scaled) iframe of the deployed URL (our Vercel sites allow framing; no third-party
screenshot service, so nothing brands the image). Deliverability
is honored: a **bounced email is a failed attempt, never a "touch"** (see [AUTH.md](AUTH.md) →
"Deliverability principle").

**Replies to respond to** (top of the page, when any): inbound email replies caught by the inbox
poller (`scripts/inbox-poll.mjs` → `forge_replies` table). Each arrives with a Gemini-drafted response
pre-written; Joe edits and sends inline (`sendReply` / `dismissReply` server actions). **Draft → Joe
approves → send** — nothing emails automatically. Bounces don't appear here (they can't be replied to);
they set the lead `bounced` and show on the Message-history timeline. Full pipeline: [AUTH.md](AUTH.md)
→ "Inbound email — bounce & reply pipeline".

Also on this page (unchanged from before the rewrite): inbound form leads (`leads` table) and
LinkedIn replied prospects (legacy funnel).

---

## Data-gathering engines (NOT Venus crons — deterministic scripts on Joe's Mac)

These feed `forge_sites` and run on launchd, independent of OpenClaw. Cheap and safe individually,
but see [FORGE.md](FORGE.md)'s cost-safety section before changing their schedule or triggering
bulk runs — they all write into the same table the (much more expensive) forge build queue reads.

| Script | launchd plist | What it does |
|---|---|---|
| `scripts/lead-engine.mjs` | `com.thinkbigjoe.leadengine` | Apify Google Maps search toward the monthly lead goal, within budget (`lead_engine` table). Rotates a large trade×metro combo pool so it never re-scrapes. |
| `scripts/enrich-engine.mjs` | `com.thinkbigjoe.enrichengine` | Apify-based contact enrichment (Google Search → Facebook page → email/Messenger) for leads missing email/socials. *(Currently the free `prospector` agent cron does this instead — see the cron table below — to save Apify budget; this script is kept for a manual "turbo" fill.)* |
| `scripts/callprep-engine.mjs` | `com.thinkbigjoe.callprepengine` | Apify-based review-quote + follower-count + talking-points generation. Same note as above — the free agent cron is primary now. |
| `scripts/trigger-poll.mjs` | `com.thinkbigjoe.triggerpoll` | Drains `job_requests` (the "Find leads now"/"Enrich now" buttons) — runs `lead-engine.mjs` or triggers the enrichment cron on demand. |
| `scripts/inbox-poll.mjs` | `com.thinkbigjoe.inboxpoll` | Watches the Zoho inbox (IMAP, every ~10 min) for outreach **bounces** (→ mark lead `bounced`, exclude from resend) and **replies** (→ insert `forge_replies` + Gemini-draft a response → the "Replies to respond to" panel on `/command/leads`; also **forwards the reply to Joe's Gmail**). **IMAP is enabled (Mail Lite) + this job is LOADED** as of 2026-07-09. Details: [AUTH.md](AUTH.md) → "Inbound email". |
| `scripts/forge-outreach-send.sh` → `POST /api/forge/send-outreach` | `com.thinkbigjoe.outreach` | The owner-outreach sender. Fires **every ~20 min** (StartInterval) but the route **drips**: only sends during **weekday 9am–6pm PT**, a **jittered 0–2 emails per run** with an 8-min min gap, capped by `outreach_engine.daily_goal`. So the day's sends trickle out like real use instead of blasting at a cron time. `?dry=1` previews without pacing. |
| `scripts/preview-engine.mjs` | `com.thinkbigjoe.previewengine` | Generates the cheap **showroom previews** in paced daily **waves** — Gemini hero copy + claim code + 14-day window — for contactable, un-previewed prospects (warmest first), via `POST /api/forge/preview`. NO forge build. Config in the `preview_engine` table (`daily_budget` = wave size, `enabled`); tracks `last_run_summary`. Plist created **unloaded** — `launchctl load` it to start waves. The wave budget paces to outreach capacity, not cost (previews are ~$0.0002 each). |

**Check what's actually running:** `launchctl list | grep thinkbigjoe` — a `-` in the PID column
means loaded-but-idle (fires on its next schedule tick), no line at all means unloaded. After the
2026-07-06 credit incident, `forgepoll`, `enrichengine`, and `callprepengine` were deliberately
unloaded pending review — **verify current state before assuming any engine is live.**

---

## Showroom / sell-first preview flow

> Full engine doc: **[SHOWROOM.md](SHOWROOM.md)** — the end-to-end funnel, generation lib, preview
> page, `preview_engine` waves, schema, and economics. This section is just the UI↔tool↔cron map.

Sell the vision cheaply, build only on commitment. A prospect gets a **personalized preview**
(no forge build) that they **claim** to trigger the real build. The three layers:

| Layer | Where | What |
|---|---|---|
| **UI** | `/s/[slug]` (public) + `portal` TemplatePicker + claim "building" state | The personalized preview page (Gemini copy, real reviews, brand color, "reserved for N days") with a claim-&-build CTA; owner can switch template + sees a build-in-progress banner. |
| **MCP tool** | `generate_forge_preview` (tbj-mcp) | Venus/agents mint a preview on demand → `POST /api/forge/preview`. |
| **Schedule** | `scripts/preview-engine.mjs` (launchd) | Batch-generates previews for contactable prospects. |

**The trigger inversion:** the claim code is minted at **preview** time (not build time), and
`claimSite()` sets `status='approved'` when an unbuilt preview is claimed — so **claiming IS the
build trigger** (forge-poll picks it up). `chooseTemplate()` re-queues with a `preferred_template`.
Generation logic lives once in `src/lib/forge-preview.ts` (`generatePreview`); the API route, MCP
tool, and cron are all thin callers. Previews cost ~$0 and expire after 14 days (`preview_expires_at`).

## Venus crons (agent-driven — see manifest for exact prompts)

| Cron | Agent | Schedule | Key tools | UI surface |
|---|---|---|---|---|
| TBJ Forge Prospect Scout | prospector | 3×/day | `apify_find_businesses`, `apify_find_instagram`, `add_forge_prospect`, `list_forge_blacklist` | Prospecting → Needs review |
| TBJ Forge Contact Enrichment | prospector | 3×/day | `list_forge_needs_contact`, `enrich_forge_contact`, `list_forge_needs_callprep`, `save_forge_callprep` | Contact cards + Call-prep card (Leads) — **free browser research, explicitly told NOT to use paid Apify tools**, to keep ongoing spend to the cheap "finding" step only |
| TBJ Forge Outreach | outreach | daily | `list_forge_preview_outreach` (prospects with a **preview** ready), `save_forge_outreach_draft`, `mark_forge_outreach_sent` | Prospecting → first-touch (draft → Approve & send). Pitch = "claim your preview" → claiming builds the site. |
| TBJ Forge Follow-up | outreach | daily | `list_forge_followup_due` (now preview-aware), `save_forge_outreach_draft` | Same — touches 2–3, re-shares the preview link |

Full prompts, exact schedules, and the "ship full-stack" checklist for adding a cron live in
`src/lib/venus-crons.mjs` itself (the file header) and [OPENCLAW.md](OPENCLAW.md).

---

## `/command/jobs` — Audit log

| Content | DB source | Written by |
|---|---|---|
| Verified actions | `activity_log` (`metadata.auto = true`) | `audit()` — auto-called by every state-changing MCP tool, and by the deterministic engines above |
| Reported summaries | `activity_log` (no `auto` flag) | `log_activity` (agent's own end-of-run narrative) |

**Verified vs reported.** Every state-changing MCP tool calls `audit()` as a side effect of its
real DB write — `actor` is `'venus'`/`'prospector'`/`'outreach'` for agent actions, `'forge'` for
the build poller, `'lead_engine'` for the engines, `'joe'` for manual server actions (approve,
revise, rebuild). These rows are **verified** — independent of whatever an agent's own
`log_activity` summary claims (**reported**). When the two disagree, that's the signal to
investigate.

---

## Claim + verification flow (`/portal`)

| Step | Route/mechanism | DB field |
|---|---|---|
| Owner claims a built site with the claim code | `/portal/claim` → `claimSite()` server action | `forge_sites.claimed_by_user_id`, `claim_code` |
| Identity verification | Claim success shows "Verify my identity" → `POST /api/identity/start` → Stripe Identity hosted flow | `forge_sites.id_verified_at`, `id_verification_session` (set via `identity.verification_session.verified` webhook in `/api/stripe/webhook`) |
| Live site editing | `/portal/edit/[id]` (Site tab: proxied live editor; Studio tab: `?tab=studio`, Gemini image gen) | writes back through `edit_requests` / forge site content, admin-accessible from Prospecting's Built cards too |
| Register the AI receptionist | `/portal/receptionist/[id]` → `saveReceptionistSetup()` — self-serve config (services/hours/greeting/FAQs/guardrails). **Gated on a paid Website+Voice/Complete plan:** off-plan saves a **draft** only; on-plan flags `submitted`, pings the team (Telegram) to provision the per-client Retell agent, and **emails the customer a confirmation**. | `forge_sites.receptionist_config` (jsonb), `receptionist_status` (`none→submitted→active`) |
| Book a call with Joe | `/portal/book` → `getPortalSlots()` (open 30-min slots, Joe's regular Mon–Fri 11–1 PT window) + `bookStrategyCall()`. **Any logged-in user**; the session is the gate (no Turnstile token, unlike the public `/api/appointments/book`). Creates the GCal event + Meet, records/updates the lead, sends the branded confirmation email + Telegram. Shows on `/command/appointments` like every other booking. | `leads` (`status='booked'`, `booked_slot`, `gcal_event_id`, `meet_link`), `activity_log` (`booking_made`) |

The Retell voice receptionist (+1 480-764-2121) also guides callers through this same claim +
verify flow conversationally — see the LLM prompt (`llm_2be0665ec4b1d0313bc82066cb53`) for the
exact script. **Texting:** SMS via Retell is built but blocked on **A2P-10DLC** carrier registration (a
US requirement for any business SMS from a local number — Joe's dashboard action, ~days to approve). The
current plan is a **Google Voice** number as Joe's outbound line, with an **OpenClaw agent driving the GV
web UI** to send paced intro texts (GV has no API; low-volume only — GV bans automated/bulk use). Pending
Joe creating + verifying the GV account. Email + social DM are the active channels today.

---

## Shipping a feature — full-stack checklist

**Backend (MCP tool)**
- [ ] Tool added to `mcp-server/tbj-mcp.mjs`, registered in BOTH `ListTools` and `CallTool`.
- [ ] If it changes state, it calls `audit(action, summary, { prospectId, target, detail })`.
- [ ] MCP server `version` bumped.

**Schedule**
- [ ] Agent work → cron entry in `src/lib/venus-crons.mjs` (`tools`, `uiSurface`, `eventTypes`,
      exact prompt) → `npm run venus:sync -- --dry` then `npm run venus:sync`.
- [ ] Deterministic/scheduled work → a script under `scripts/*.mjs` + a launchd plist, budget-aware
      if it touches the forge queue or a paid API.

**UI surface**
- [ ] Page/section under `/command/**` renders the data the tool writes.
- [ ] New top-level area → added to `command-header.tsx`'s `LINKS` array.

**Docs**
- [ ] This doc updated (surface map). FORGE.md updated if it touches the build pipeline/cost.
- [ ] `pnpm run build` passes.
