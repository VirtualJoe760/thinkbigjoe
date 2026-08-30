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

## Command-center nav (8 tabs)

The nav follows the funnel: **Build → Prospect → Sell.**

| Tab | Route | What it's for |
|---|---|---|
| **Overview** | `/command` | Dashboard — appointments, calendar connection status, top-line stats. Booked-call cards carry an **"ad: source / campaign / content" chip** when the lead arrived with paid attribution (`leads.utm_*`, captured per [ADS.md](ADS.md); agent-side read = `ads_funnel_report`). |
| **Engine** | `/command/engine` | The **engine room / ops cockpit** — run + monitor the forge. **Weekly spend gauge** (run-budget used vs remaining, 75/90% color states), **14-day activity chart** (builds/edits/outreach) + throughput cards, **granular controls** (master + new-site-builds / customer-edits / idle-templates toggles + a settable `weekly_run_budget`), the **build queue** (elapsed + ETA) and **customer edit queue** (with live "view site" links), "Clear stuck builds", and a forge **activity feed** with live-site links. All numbers come from `getForgeDigest()` (`src/lib/forge-stats.ts`). Controls gate `forge-poll`/`edit-poll` per-capability — see FORGE.md's "Granular controls + weekly run-budget" note. The same digest surfaces on the **Overview** ("Engine flow" card) and via the **`forge_digest` MCP tool**. Also here: the **Template designer** (`requestTemplateDesign` → `job_requests(kind='design_template')` → `trigger-poll` → `forge-template.sh`, builds the next Brand-Lead-proposed design, human-gated) and **Design research** — the Brand Lead's accumulating research reports (`design_reports` table, written by `save_design_report`), each citing the sites it studied; Joe verifies/rejects via `setDesignReportStatus`. See OPENCLAW.md's brand-lead cron. **Also here (2026-07-20): the auto-provision cockpit** (`AutoProvisionControls`) — the Manual/Automatic money-spend switch, weekly line-budget + spend gauge, queued/failed counts, auto-build-on-payment toggle, and a single **Stop all automation** master kill. Its 3 layers: UI here · schedule = `scripts/provision-drain.mjs` + launchd `com.thinkbigjoe.provisiondrain` · MCP = `automation_status`. Read path `getAutoProvisionStatus()` (`src/lib/auto-provision.ts`); switch/queue in the `auto_provision` + `voice_provision_queue` tables. Full spec: AUTOMATION_PIPELINE.md. |
| **Prospecting** | `/command/prospects` | The pipeline: web-dev leads (find → review → **Built**, gated behind marketing approval) + the showroom preview/outreach dials. Cross-links to the call room. |
| **Leads** | `/command/leads` | The **contact book** — every site approved for marketing OR built, INCLUDING the ones that claimed + signed up (kept visible as "User"/"Customer" so conversions are tracked, not lost). A **"Signed up" scoreboard** (acct #, plan, paying-count) sits above the call list. Each contact card shows the site we built, reviews, an **Online-presence pill row** (their current site · Google Business · Instagram/Facebook/LinkedIn, all clickable), the AI's fit-reason, a ready calling script, click-to-call/text/email, and — for signed-up users — a **User Profile block** (account #, plan, real subscription/billing state, receptionist + domain status). Cross-links back to Prospecting. |
| **Appointments** | `/command/appointments` | DB-enriched booked-call detail (role/industry/team-size/timeline, calendar links). |
| **Whitney** | `/command/applications` | **Joe's job-application board** — the `whitney` agent posts candidate roles here (`job_applications` table, status `found`); Joe **Approves/Dismisses** (the human gate: `approveJob`/`dismissJob` in `applications/actions.ts`), and the approved ones flow through the live pipeline (`approved → account_created → verified → applied → interview`) as Whitney works them. Also here: a **Pause/Resume** control (`setWhitneyPaused` → `agents.paused`; her MCP tools honor it). Cards at an employer Joe named (⭐ priority employers in her `USER.md`) carry a **★ Your target** badge, come from `record_found_job({directed:true})`, and sit in their own lane exempt from the 25-card review cap (`DIRECTED_CAP = 20`) — so a full board still lets her chase Anthropic/xAI/Compass/eXp. Also here: the **Needs your input** panel — when Whitney is blocked she posts a question (`record_question`), which lands on this board **and pings Joe's Telegram immediately**. He has two valid outcomes: **Send answer** (`answerQuestion` → she resumes; a `topic` slug also upserts `candidate_facts` so she never re-asks) or **Decline to answer** (`declineQuestion` → question `status='declined'` **and the application is cancelled**, `job_applications.status='closed'`). Declining is a first-class outcome, not a failure — a question she can't get past is an application she can't finish. She sees either decision next run via `list_answered_questions` and moves on; the cancelled job lands in the archive, where `reopenJob` can undo it. See OPENCLAW.md's `whitney` row. |
| **Inbox** | `/command/inbox` | **Edward's email desk** for joe@thinkbigjoe.com — **Pressing / Employer replies / Still-owed panels** parsed from his latest report (added 2026-08-30), the raw report, the `email_outbox` send queue **awaiting Venus's approval** (she decides via `email_approve_send`/`email_reject_send`; this page is read-only on purpose — the approval seat is hers, not a button), decided/sent history, and his activity feed. See OPENCLAW.md's `edward` row. **LIVE.** |
| **Venus** | `/command/crons` (+ sub-nav: Crons / Inbox / Audit log / Team) | Cron manifest + last-run, the audit log (`activity_log`), and the OpenClaw team roster. |
| **Settings** | `/command/settings` | Automation on/off, calendar connection, analytics link. |

`/command/analyzer` (site analyzer) and `/command/sites` (deprecated — deleted) hang off
Prospecting via the `match` array in `command-header.tsx`, not as top-level tabs.

**Nav chrome — one unified navbar.** All three surfaces render the **same shell**,
`components/app-nav.tsx` (`<AppHeader>`): a sticky `h-16` bar + a right-side slide-in drawer
**portaled to `<body>`** (so a header's `backdrop-blur` can't trap the drawer's `fixed` positioning —
that bug once collapsed the drawer to header height and caused a page-wide horizontal scrollbar). Each
surface is just a config passed to `<AppHeader>`:
> - **Public** (`components/site-nav.tsx`): marketing links + phone + **Login**; inline links on desktop.
> - **Portal** (`components/portal/portal-header.tsx`): Overview · Receptionist (`/portal/dashboard`) ·
>   Calls · Calendar · Newsletter · Agentic Solutions · Book a call · Billing · Settings · Account
>   (+ **Messages** and **Command** when `isAdmin`); account-ID pill inline on desktop, everything else
>   in the drawer (`inlineOnDesktop=false`, same as Command); email + **Sign out** in the drawer footer.
> - **Command** (`command/command-header.tsx`): the 8 workflow groups with icons, `inlineOnDesktop=false`
>   so it stays **drawer-primary at every width** (link-dense, admin-only), + a **"‹ Portal"** back-link
>   and Sign out.
>
> The old per-surface chrome — the portal's push-down dropdown, the separate mobile **bottom bar**
> (`portal-bottom-nav.tsx`), and `site-nav-mobile.tsx` — is **retired/deleted**; everything is `<AppHeader>`
> now. PWA safe-area insets come from the `viewport-fit=cover` viewport export in `(frontend)/layout.tsx`;
> the manifest's `start_url` is `/command` (admin-first — a customer install lands there and redirects to
> `/portal`).

**Portal surfaces (`PortalShell`).** Portal pages are migrating into an inner OS shell,
`components/portal/portal-shell.tsx` — content left, nav rail RIGHT with the customer's site card
pinned (Edit / View entry points survive the mobile collapse as a pill strip). Rail tabs:
**Scoreboard** (`/portal/dashboard` — impact scores + call receipts + feedback) · **Calls** ·
**Knowledge** (`/portal/knowledge` — read-only view of everything Ivy knows: `receptionist_config` +
`TENANT_DEFAULTS`/`deriveRouting` from `src/lib/voice-vars.ts`/`voice-tenant.ts`; changes happen by
calling Ivy, not a form) · **Agents** (`/portal/agents` — roster from `AGENTS` in `src/lib/plans.ts`) ·
**Calendar** · **Billing**. `?site=` is carried across tabs so multi-site owners aren't bounced to
their first site. Currently Scoreboard/Knowledge/Agents render inside the shell; Calls/Calendar/Billing
are linked but not yet migrated. Full redesign spec: [PORTAL_REDESIGN.md](PORTAL_REDESIGN.md).

> ⚠️ **DB data-transfer (egress) — command dashboards are `force-dynamic` + `<AutoRefresh>`.** A
> `router.refresh()` re-runs *every* query on the page, so an open tab re-pulls its data on a timer. In
> 2026-07 this took the whole app down: `/command/prospects` re-pulled the entire `forge_sites` table
> every 20s and blew Neon's monthly data-transfer quota (Postgres `XX000` "exceeded the data transfer
> quota" → every request 500s). **Rule when touching a `/command` dashboard:** never put an unbounded
> full-table `select()` behind AutoRefresh — project only the columns the page renders, collapse big
> jsonb (e.g. `forge_sites.preview`) to a boolean, keep intervals sane. `AutoRefresh` now pauses on
> hidden tabs. The DB is **Neon Launch, billed via Vercel** (plan changes in Vercel's Storage tab, not
> the Neon console). Full writeup: memory `db-neon-egress.md`.

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

## `/command/leads` — the contact book

**Shows every site `marketing_approved_at IS NOT NULL` OR `status='built'`, minus denied/deleted —
INCLUDING claimed/signed-up rows.** A built-but-unapproved-and-unclaimed site never appears (still "in
review" on Prospecting). Crucially it does **not** filter out `claimed_by_user_id` rows: once a business
signs up we keep it visible as a **User** (claimed, no plan) or **Customer** (paying), so conversions are
tracked instead of vanishing. A **"Signed up" scoreboard** (`signedUp` in `leads-crm.tsx`) sits atop the
list — every claimed contact with its account # + plan, newest claim first, click-to-open.

Each contact card (`ContactDetail`) shows the **site we built** (stored `screenshot_url`, else a scaled
live iframe of the deployed/preview URL — our Vercel sites allow framing, so nothing brands the image),
star rating + real review quotes, the **Online-presence pill row** (existing site · Google Business via
`google_maps_url` or a name+city Maps search fallback · Instagram/Facebook/LinkedIn — each gated on
presence, clickable), the AI **fit-reason**, and a generated **calling script** (personalized opener +
the per-lead call-prep "angle"). Actions: 📞 Call, 💬 Text link, ✉️ Email, 🔗 site, then a divided
cluster — **Copy claim text for Google Voice** (un-signed-up leads only; the text drops the claim code
once claimed) + **Book an appointment**.

For a signed-up user the card adds a **User Profile block**: account # (from `better_auth.user`), plan,
real subscription/billing state (`subscription_status` / `one_time_paid` / `paid_at`, not just a boolean),
and live-service status (receptionist, domain). Pipeline stages: `new → contacted → hot → reschedule →
replied → bad-contact → user → customer`. The **Reschedule** stage is a manual, high-priority flag Joe
sets (`setLeadStage(id, "reschedule")` → `forge_sites.lead_stage='reschedule'`) when a near-won client
bailed on the setup/payment call and needs to rebook — setting it **also un-pauses the AI** (`ai_paused=
false`) so the outreach agent works them via the `list_forge_reschedule_due` tool + `TBJ Forge Reschedule
Nudge` cron. Deliverability is honored: a **bounced email is a failed attempt, never a "touch"**
(see [AUTH.md](AUTH.md) → "Deliverability principle").

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

> ### 🌙 The night window (2:30am–6am)
> **Anything that prospects or spends Apify credit runs ONLY between 2:30am and 6am** — never
> during Joe's working day. As of 2026-07-14 that means the `lead-engine` (3/4/5am) and the
> `TBJ Forge Prospect Scout` agent cron (2:30 + 4:30am). Both were widened per run to keep daily
> throughput despite fewer runs (`MAX_SEARCHES=24`; scout targets 45–60 businesses/run).
> **If you schedule anything new that calls Apify — including re-loading `enrichengine` or
> `callprepengine` — put it in this window.** The exception is *manual* triggers: the "Find leads
> now" button (`trigger-poll`) runs on demand at any hour, deliberately (it's Joe pulling the
> lever, capped at 12 searches to fit its 9-min timeout). Free browser-based research (the
> `prospector` enrichment cron, `brand-lead`) is NOT in scope and keeps its all-day schedule.

| Script | launchd plist | What it does |
|---|---|---|
| `scripts/lead-engine.mjs` | `com.thinkbigjoe.leadengine` | **🌙 3:00 / 4:00 / 5:00am** (`StartCalendarInterval` — was every 3h round the clock; moved into the night window because it's the biggest Apify spender). Apify Google Maps search toward the monthly lead goal, within budget (`lead_engine` table). Rotates a large trade×metro combo pool so it never re-scrapes. Only 3 runs a night, so `MAX_SEARCHES` (argv[2], default **24**) lets ONE run cover the whole daily target; it no-ops once the target is met, making 4/5am catch-up runs. Budget is re-checked before every search, so the higher ceiling can't overspend. |
| `scripts/enrich-engine.mjs` | `com.thinkbigjoe.enrichengine` | **UNLOADED** (see below). Apify-based contact enrichment (Google Search → Facebook page → email/Messenger) for leads missing email/socials. *The free `prospector` agent cron does this instead — see the cron table below — to save Apify budget; this script is kept for a manual "turbo" fill.* **It spends Apify credit — if you ever re-load it, schedule it inside the 🌙 night window.** |
| `scripts/callprep-engine.mjs` | `com.thinkbigjoe.callprepengine` | **UNLOADED** (see below). Apify-based review-quote + follower-count + talking-points generation. Same notes as above — free agent cron is primary, and it belongs in the 🌙 night window if re-loaded. |
| `scripts/trigger-poll.mjs` | `com.thinkbigjoe.triggerpoll` | Drains `job_requests` (the "Find leads now"/"Enrich now" buttons) — runs `lead-engine.mjs` or triggers the enrichment cron on demand. |
| `scripts/inbox-poll.mjs` | `com.thinkbigjoe.inboxpoll` | Watches the Zoho inbox (IMAP, every ~10 min) for outreach **bounces** (→ mark lead `bounced`, exclude from resend) and **replies** (→ insert `forge_replies` + Gemini-draft a response → the "Replies to respond to" panel on `/command/leads`; also **forwards the reply to Joe's Gmail**). **IMAP is enabled (Mail Lite) + this job is LOADED** as of 2026-07-09. Details: [AUTH.md](AUTH.md) → "Inbound email". |
| `scripts/forge-outreach-send.sh` → `POST /api/forge/send-outreach` | `com.thinkbigjoe.outreach` | The owner-outreach **email** sender. Fires **every ~20 min** (StartInterval) but the route **drips**: only sends during **weekday 9am–6pm PT**, a **jittered 0–2 emails per run** with an 8-min min gap, capped by `outreach_engine.daily_goal`. So the day's sends trickle out like real use instead of blasting at a cron time. `?dry=1` previews without pacing. |
| `scripts/voicemail-outreach-send.sh` → `POST /api/forge/send-voicemail-outreach` | `com.thinkbigjoe.voicemailoutreach` | **The first touch for a new lead** — a ringless voicemail drop; the follow-up text auto-sends ~60s later (`vmtextsend`). Fires ~every 20 min, gated to weekday 9am–6pm PT, drips a jittered count capped by `VOICEMAIL_OUTREACH_DAILY_GOAL` (default 15). **Replaced the old SMS first-touch drip** (`com.thinkbigjoe.smsoutreach`, now UNLOADED) — the voicemail *is* the opener, and its 60s text replaces the SMS first-touch. `?dry=1` previews, `?batch=N` kicks off N now. |
| `scripts/preview-engine.mjs` | `com.thinkbigjoe.previewengine` | Generates the cheap **showroom previews** in paced daily **waves** — Gemini hero copy + claim code + 14-day window — for contactable, un-previewed prospects (warmest first), via `POST /api/forge/preview`. NO forge build. Config in the `preview_engine` table (`daily_budget` = wave size, `enabled`); tracks `last_run_summary`. Plist created **unloaded** — `launchctl load` it to start waves. The wave budget paces to outreach capacity, not cost (previews are ~$0.0002 each). |
| `scripts/callback-reminders.sh` → `POST /api/leads/callback-reminders` | `com.thinkbigjoe.callbackreminders` | Fires **every ~30 min**; Telegrams Joe for any lead whose **scheduled call-back** time has arrived (the "Schedule a call-back" control on `/command/leads` sets `forge_sites.callback_at` + `callback_note`). Fires **once per callback** (guarded by `callback_reminded_at`), skips claimed leads. |
| `scripts/vm-text-send.sh` → `POST /api/leads/vm-text-send` | `com.thinkbigjoe.vmtextsend` | Fires **every ~60s**; sends the **voicemail follow-up text ~60s after each drop** (so the voicemail lands first). Reads `vm_text_pending`/`vm_dropped_at`; picks the non-VM wording if the delivery webhook logged a failure, else the VM-referencing text. See [VOICEMAIL.md](VOICEMAIL.md). |

**Check what's actually running:** `launchctl list | grep thinkbigjoe` — a `-` in the PID column
means loaded-but-idle (fires on its next schedule tick), no line at all means unloaded.
**Verify current state before assuming any engine is live** — this list drifts.

Verified 2026-07-14: `enrichengine` and `callprepengine` are still **UNLOADED** (since the
2026-07-06 credit incident); `forgepoll` and `leadengine` **are loaded**. (`forgepoll` was also
unloaded after that incident but has since been restored — an earlier version of this note said
otherwise, which is exactly the drift this paragraph warns about.) If you re-load either Apify
engine, schedule it inside the 🌙 night window above.

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
| TBJ Forge Prospect Scout | prospector | **🌙 2:30 + 4:30am** (2×/night — spends Apify, so it lives in the night window; was 3×/day. Prompt now targets 45–60 businesses and 6–8 metros per run to hold volume) | `apify_find_businesses`, `apify_find_instagram`, `add_forge_prospect`, `list_forge_blacklist` | Prospecting → Needs review |
| TBJ Forge Contact Enrichment | prospector | 3×/day | `list_forge_needs_contact`, `enrich_forge_contact`, `list_forge_needs_callprep`, `save_forge_callprep` | Contact cards + Call-prep card (Leads) — **free browser research, explicitly told NOT to use paid Apify tools**, to keep ongoing spend to the cheap "finding" step only |
| TBJ Forge Outreach | outreach | daily | `list_forge_preview_outreach` (prospects with a **preview** ready), `save_forge_outreach_draft`, `mark_forge_outreach_sent` | Prospecting → first-touch (draft → Approve & send). Pitch = "claim your preview" → claiming builds the site. |
| TBJ Forge Follow-up | outreach | daily | `list_forge_followup_due` (now preview-aware), `save_forge_outreach_draft` | Same — touches 2–3, re-shares the preview link |
| TBJ SMS Comms | outreach | 3×/day (10a/1p/4p PT) | `check_outreach_window`, `list_sms_replies_pending`, `list_sms_followup_due`, `send_sms(site_id, purpose)`, `book_appointment` | `/command/messages` threads + `/command/leads` timeline. **Autonomous SMS**: answers waiting replies with the sales doctrine, then sends cadence follow-ups (~2×/week per lead until reply/claim/booking, 6-mo cap, **≤15/day** number-warming cap). Safeguards (ai_paused, opt-out, declined, window, master switch) enforced inside the tools. |
| TBJ Forge Reschedule Nudge | outreach | 2×/day (3pm + 7pm) | `list_forge_reschedule_due`, `send_sms`, `save_forge_outreach_draft` | `/command/leads` **Reschedule** stage — Joe sets it by hand when a near-won client bails on the setup/payment call; setting it also un-pauses the AI for that client. Warmest leads; low-pressure "your site's ready, rebook in 2 min" nudge. |
| **TBJ Venus — Org Debrief** | **main (Venus)** | **✅ LIVE** — `30 12,18 * * *` America/Phoenix (12:30 / 18:30; the 6:30 run was dropped — Whitney no longer works overnight, so it was paying to say "nothing happened") | `get_inbox_report`, `get_job_hunt_report`, `email_list_pending_sends`, `email_approve_send`, `email_reject_send`, `send_telegram_update`, `log_activity` | Joe's **Telegram** — ONE message covering both workers, sourced from `/command/inbox` + `/command/applications`. Edward: pressing mail, and **every pending send Venus decides herself** (approve → it goes out over Zoho SMTP *as Joe*, immediately). Whitney: roles applied to **by title + company**, interview stage, questions pending on Joe. **Two sections added 2026-08-30**: 📬 **OWED** (anyone still waiting on a reply, with age) and an 🎉 **INTERVIEW** section that now also carries employer invites Edward recorded from email — a live Klavis AI interview invite sat 4 days unread because neither existed. Job-hunt numbers come from the tables, not Whitney's self-report. **Replaced two per-agent crons** (*Venus — Inbox Update*, *Venus — Job Hunt Debrief*): Joe wants one debrief, not a ping per worker — add future agents as **sections here**. ⚠️ `agent: "main"` (NOT agentless), explicit `channel`+`to`, and the `send_telegram_update` call are all load-bearing — see **Cron delivery** in [OPENCLAW.md](OPENCLAW.md). |
| TBJ Whitney — Job Applications | whitney | **✅ LIVE** (`enabled:true`, `0 7-19 * * *` America/Phoenix — hourly, 7am–7pm, all 7 days; stagger 2m. She moved to `claude-cli/claude-sonnet-4-6` on 2026-08-29, so every wake draws the shared Max weekly cap. **Cut from `*/15` 24/7 on 2026-08-27**: 69 of 96 daily runs did nothing but log "board full, standing down", and a stand-down still costs a full model call — that burned her ollama-cloud free-tier quota until she was rate-limited. She does one application per turn, so the extra wake-ups bought nothing. Her apply-gate is now open: target profile, `RESUME_PATH`, `LINKEDIN_URL`, `JOB_SIGNUP_PASSWORD` are all set) | `list_approved_jobs`, `update_application_status`, `inbox_search`, `record_found_job`, `book_appointment`, `record_question`, `list_answered_questions`, `mark_question_resolved` | `/command/applications`. **Priority-queue**: applies to the top approved job (create account → email-verify → tailor → submit), and only *fills* by finding new roles when the approved queue is empty. **Her cron has no delivery channel on purpose** — she never messages Joe from the cron. Escalation rides the MCP tool instead: `record_question` pings Joe's Telegram directly (see the Whitney row above). |
| TBJ Edward — Inbox Sweep | edward | **✅ LIVE** (`enabled:true`, `45 6,15 * * *` America/Phoenix = 6:45a / 3:45p, 2×/day, all 7 days. The `claude auth` blocker noted here through 2026-08-29 is **resolved** — he has been running since.) | `list_my_directives`, `complete_directive`, `inbox_sweep`, **`inbox_unanswered`**, `email_create_draft`, **`email_file`**, **`record_employer_reply`**, `email_move_spam`, `email_request_send`, `email_list_pending_sends`, `log_activity` | `/command/inbox`. Triage joe@thinkbigjoe.com: classify, junk spam (never delete), draft replies in Joe's voice, queue sends for Venus, file the `email_inbox_report` she briefs from. **Since the 2026-08-30 mail audit** he sweeps **every folder** (a Zoho filter routes ATS mail to `Notification`), runs `inbox_unanswered` every sweep so nothing ages out unanswered, files job mail to **`Job Alerts`**, and writes employer replies back onto `job_applications` via `record_employer_reply` — which is the only way an emailed interview invite reaches Joe's board. |

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
| Live site editing | `/portal/edit/[id]` (Site tab: proxied live editor; Studio tab: `?tab=studio`, Gemini image gen). **One build at a time:** while a batch is `requested`/`applying` the workspace locks behind a polling BuildLock screen (`edit/[id]/build-lock.tsx`); `POST /api/edit-requests` is the server backstop (409 on a pending build; `GET` exposes `{pending}` for the unlock poll). | writes back through `edit_requests` / forge site content, admin-accessible from Prospecting's Built cards too |
| Register the AI receptionist | Phone-first: the customer **calls Ivy** to set up/change their receptionist; `/portal/receptionist[/[id]]` are redirect stubs to `/portal/dashboard?site=` (the old self-serve form is retired — see [PORTAL_REDESIGN.md](PORTAL_REDESIGN.md)). What Ivy knows is inspectable read-only at `/portal/knowledge`. | `forge_sites.receptionist_config` (jsonb), `receptionist_status` |
| Book a call with Joe | `/portal/book` → `getPortalSlots()` (open 30-min slots, Joe's regular Mon–Fri 10–5 PT window (lunch break at noon)) + `bookStrategyCall()`. **Any logged-in user**; the session is the gate (no Turnstile token, unlike the public `/api/appointments/book`). Creates the GCal event + Meet, records/updates the lead, sends the branded confirmation email + Telegram. Shows on `/command/appointments` like every other booking. | `leads` (`status='booked'`, `booked_slot`, `gcal_event_id`, `meet_link`), `activity_log` (`booking_made`) |

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
