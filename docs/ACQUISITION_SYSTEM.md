# ThinkBigJoe — Multi-Agent Client Acquisition System

> **Status**: Gameplan (Phase 1 in development)
> **Owner**: Joseph Sardella
> **Last updated**: 2026-06-24 (answers incorporated)

---

## Decisions locked in

| Question | Answer |
|---|---|
| **ICP (who Scout targets)** | Two modes: (1) **business owners to pitch TBJ services** — insurance, mortgage, wealth, MSP, law firm owners/principals. (2) **job postings to apply to as a contractor** — Scout finds openings at companies that would hire someone with Joe's skill set. Both run from the same Scout agent, flagged by `scout_mode`. |
| **Pilot vertical** | Finance & insurance first — most prospect data already exists, strongest AI ROI proof, local + nationwide |
| **Email sending** | `joe@thinkbigjoe.com` via **Zoho Mail free tier** (IMAP + SMTP, custom domain, Apple Mail compatible). Marketing/outreach sends use the same domain initially; move to `mail.thinkbigjoe.com` subdomain once volume ramps past 50/day to protect root domain reputation. |
| **Sending domain setup** | See **Email Setup** section below |
| **Scout queue target** | Scout keeps running until there are **50 `pending_review` rows** in `scout_prospects`. When count drops below 50 (because Joe approved/skipped some), Scout auto-queues a new batch. |
| **Meta ads** | Collect the data now; set up audiences when creative is ready. No blocker to data collection. |

This document is the single source of truth for ThinkBigJoe's automated client acquisition
pipeline. Read this before touching any agent, runner, schema, or outreach code.

---

## What this system does

Three AI agents work in sequence to find, qualify, and contact potential clients — then feed
that same contact data into Meta ads for retargeting. Joe approves every contact before anything
is sent. The agents do research and composition; Joe controls what goes out the door.

```
Venus (Telegram/Discord)
    │
    │  "scout insurance agencies in Phoenix"
    ▼
┌─────────────────────────────────────────────────────┐
│  SCOUT AGENT (read-only, no side effects)           │
│  Visits websites · finds contacts · scores leads    │
│  Collects: email, phone, LinkedIn, company intel    │
└─────────────────┬───────────────────────────────────┘
                  │  writes rows → scout_prospects (pending_review)
                  ▼
┌─────────────────────────────────────────────────────┐
│  /command/prospects  DASHBOARD (Joe reviews)        │
│  Card per prospect: score · preview · contact data  │
│  Actions: Approve → Outreach Queue                  │
│           Skip    → archived                        │
│           Edit    → edit message, then approve      │
└─────────────────┬───────────────────────────────────┘
                  │  status → approved
                  ▼
      ┌───────────┴────────────┐
      │                        │
      ▼                        ▼
┌──────────────┐     ┌─────────────────────────┐
│ OUTREACH     │     │ META ADS AUDIENCE SYNC  │
│ AGENT        │     │ (daily batch export)    │
│              │     │                         │
│ Email (PRI)  │     │ Upload approved list    │
│ LinkedIn(SEC)│     │ to Meta Custom Audience │
│ Job apps(TER)│     │ → retargeting ads run   │
└──────┬───────┘     │ → lookalike audience    │
       │             │   built from converters │
       ▼             └─────────────────────────┘
┌──────────────┐
│ REPLY LOOP   │
│ Sentinel     │
│ watches      │
│ Gmail IMAP   │
│ → Telegram   │
│   approval   │
└──────────────┘
```

---

## The three agents

### Agent 1 — Scout

**Role**: Research only. Finds prospects, enriches them, scores them. Zero outreach.

**Triggered by**: Texting Venus — `"scout insurance agencies in Phoenix"`,
`"find coworking space leads in San Diego"`, `"look for job postings in commercial real estate"`

**What it does per prospect**:
1. Receives a target (vertical + geography, or job board search term)
2. Opens the company website with the OpenClaw browser — reads about page, services,
   team page, contact page
3. Pulls any active job postings from their own career page (Lever, Greenhouse, direct)
4. Finds the decision-maker: owner, founder, ops director, or hiring manager
5. Calls Hunter.io API to find and verify their email address
6. Collects phone number from the website or Google Business listing (Apify)
7. Records LinkedIn profile URL if visible on the site or a public directory
8. Scores the prospect 1–100 against the ICP (see scoring rubric below)
9. Drafts a personalized first-touch message based on what it found
10. Writes one row to `scout_prospects` with status `pending_review` — nothing sent

**Data collected per prospect**:
```
company_name, website, description, industry, size_estimate
decision_maker_name, decision_maker_title, decision_maker_linkedin
email (verified), phone, company_address
job_posting_url, job_posting_title (if applicable)
fit_score (1–100), fit_reason
outreach_draft (email body), outreach_subject
source (scout_job_id), created_at
```

**ICP scoring rubric** (insurance agencies as example):
| Signal | Points |
|---|---|
| Owner/principal is the decision-maker (not HR) | +20 |
| Company size 2–20 employees (sweet spot) | +20 |
| Verified email found | +15 |
| Active job posting (hiring = budget) | +15 |
| Local/regional (not national chain) | +10 |
| Phone number available | +10 |
| LinkedIn profile found | +10 |

Score ≥ 70 → surfaced to approval dashboard
Score < 70 → logged but not surfaced (can be retrieved later)

**Tools used**:
- OpenClaw browser (website reading, career page scraping)
- Hunter.io API (email finder + verification)
- Apify — `google-maps-scraper` actor (phone, address, Google Business data)
- Apify — `web-scraper` actor (generic fallback for unusual sites)
- Claude (scoring, message drafting)

**What Scout does NOT do**:
- No LinkedIn scraping (ban risk)
- No email sending
- No form submissions
- No contact with any prospect

---

### Agent 2 — You (the Approval Gate)

**Role**: Review, approve, skip, or edit every prospect before any outreach happens.

**Interface**: `/command/prospects` tab in the dashboard (to be built)

**Card contents**:
- Company name, website link, industry
- Decision-maker name, title, LinkedIn URL
- Email address (verified ✓ or unverified ?)
- Phone number (if found)
- Fit score + plain-English reasoning
- Draft outreach message (editable inline)
- Source job that found them

**Actions**:
- **Approve** → status → `approved`, enters outreach queue
- **Skip** → status → `skipped`, removed from queue
- **Edit + Approve** → save your version of the message, then approve

**Telegram shorthand** (for mobile): Venus reads your `pending_review` count and lists the
top 5 by score when you text `"show prospects"`. Reply with the ID to approve or skip.

---

### Agent 3 — Sender

**Role**: Works the approved queue at human pace. Three channels in priority order.

#### Channel 1 — Email (primary, lowest risk)

- Sends from `joe@thinkbigjoe.com` via Resend (already configured in the stack)
- One email per prospect using the approved draft
- Rate: 30–50/day max while domain warms; scale to 200+/day after 30 days
- Follow-up: auto day-4 and day-8 if no reply (short, humble nudge)
- Tracking: Resend webhook → logs opens, clicks, bounces to `outreach_log`
- Replies: Gmail inbox → Sentinel → Telegram approval loop (already built)

**Required before first send**:
- [ ] SPF, DKIM, DMARC records on thinkbigjoe.com (non-negotiable for deliverability)
- [ ] Domain warm-up: 5 emails/day week 1 → 20/day week 2 → 50/day week 3 → ramp
- [ ] Unsubscribe footer (CAN-SPAM compliance, one line + link)

#### Channel 2 — LinkedIn connection request (secondary, rate-limited)

- Already implemented in the existing Cowork runner
- **Hard cap: 10 connections/day** (existing runner enforces 20; Scout-sourced requests
  share this budget)
- Only sent when email is unavailable or bounces
- No automated follow-up DMs — connection only; humans reply to any responses
- Uses the existing Windows sender (Playwright, logged-in Chrome)

#### Channel 3 — Job application (tertiary, company career pages only)

- Only for prospects found via a job posting search (Scout marks `job_posting_url`)
- OpenClaw browser on Mac mini fills the application form
- Resume data pulled from a stored profile (to be created: `prospecting/resume.json`)
- **Company career pages only** — not LinkedIn Jobs, not Indeed, not ZipRecruiter
  (those have active bot detection; company pages are low-volume and less policed)
- Cap: 3 applications/day
- Log: every submission to `outreach_log` with `channel = 'job_application'`

---

## Meta Ads retargeting funnel

This is the force multiplier. Every approved prospect — whether they reply or not — feeds a
Meta custom audience that runs retargeting ads. Prospects who ignored the email see the ad.
Prospects who opened but didn't reply see the ad. The ad keeps ThinkBigJoe visible while the
outreach sequence runs.

### How it works

```
approved_prospects (email + phone in DB)
         │
         │  daily batch export (cron, 2am)
         ▼
  CSV: email, phone, first_name, last_name
         │
         │  Meta Marketing API upload
         ▼
  Custom Audience: "TBJ Prospect Pool"
         │
    ┌────┴──────────────────────────────┐
    │                                   │
    ▼                                   ▼
Retargeting Ad                  Lookalike Audience
"Are you still looking           (Meta finds similar
for [their service]?"             business owners)
Offer: free consultation         → cold prospecting ads
                                 → top-of-funnel reach
```

### Why email + phone matters for Meta

Meta matches on **hashed email AND hashed phone**. Having both dramatically increases
match rates:
- Email only: ~40–60% match rate
- Email + phone: ~70–85% match rate

This is why Scout collects phone even when we already have email. Every piece of contact data
has two jobs: outreach AND ad targeting.

### Audience segments to build

| Audience | Source | Ad Angle |
|---|---|---|
| **Active Prospects** | `approved`, not yet replied | "We reached out — let's chat" |
| **Replied but not closed** | `replied` status | Testimonial / social proof |
| **Won clients** | `status = won` | Referral ask / upsell |
| **Lookalike — Won clients** | Meta builds from won list | Cold acquisition |
| **Lookalike — High scorers** | Top 20% fit score | Cold acquisition |

### Meta upload spec

Meta's Marketing API accepts a CSV with hashed PII (SHA-256). The upload script
(`scripts/sync-meta-audience.mjs`) will:
1. Pull all `approved` + `replied` + `won` prospects from Neon
2. Hash email and phone with SHA-256 (Meta's required format)
3. POST to the Meta Marketing API `/`{audience_id}`/users` endpoint
4. Run nightly via cron at 2am Pacific

**PII handling**: Raw email/phone never leave Neon. The hashing happens in memory in
the script; only hashed values hit the Meta API. This matches Meta's data policy.

**Required to set up**:
- [ ] Meta Business Manager account with ad account
- [ ] Meta Marketing API token (System User, not personal token)
- [ ] Create custom audience in Meta Ads Manager → save audience ID
- [ ] Add `META_ACCESS_TOKEN` and `META_AUDIENCE_ID` to Vercel env + `.env.local`

---

## Database schema additions

Two new tables to add (migration needed):

### `scout_jobs`
Tracks Scout agent runs — one row per "scout insurance in Phoenix" command.

```sql
CREATE TABLE scout_jobs (
  id          SERIAL PRIMARY KEY,
  source      VARCHAR DEFAULT 'venus',
  raw_command VARCHAR NOT NULL,
  vertical    VARCHAR,
  location    VARCHAR,
  target_count INTEGER,
  found_count  INTEGER DEFAULT 0,
  approved_count INTEGER DEFAULT 0,
  status      VARCHAR DEFAULT 'queued',  -- queued | running | done | failed
  result_summary VARCHAR,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);
```

### `scout_prospects`
One row per discovered prospect. Separate from the existing `prospects` table (which is
LinkedIn-sourced). Scout prospects feed into `prospects` on approval.

```sql
CREATE TABLE scout_prospects (
  id                    SERIAL PRIMARY KEY,
  scout_job_id          INTEGER REFERENCES scout_jobs(id),

  -- Company
  company_name          VARCHAR NOT NULL,
  website               VARCHAR,
  description           VARCHAR,
  industry              VARCHAR,
  company_size_estimate VARCHAR,
  company_address       VARCHAR,

  -- Decision maker
  contact_name          VARCHAR,
  contact_title         VARCHAR,
  contact_linkedin      VARCHAR,

  -- Contact data (the gold)
  email                 VARCHAR,
  email_verified        BOOLEAN DEFAULT FALSE,
  phone                 VARCHAR,

  -- Job posting (if scout found via job board)
  job_posting_url       VARCHAR,
  job_posting_title     VARCHAR,

  -- Scoring & outreach
  fit_score             INTEGER,
  fit_reason            VARCHAR,
  outreach_subject      VARCHAR,
  outreach_draft        TEXT,

  -- Lifecycle
  status                VARCHAR DEFAULT 'pending_review',
  -- pending_review | approved | skipped | outreach_sent | replied | won | lost
  approved_at           TIMESTAMP,
  outreach_sent_at      TIMESTAMP,
  meta_synced_at        TIMESTAMP,  -- last time this row was included in Meta upload

  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);
```

### `outreach_log`
Unified log of every action taken (email sent, LinkedIn connection, job app, Meta sync).

```sql
CREATE TABLE outreach_log (
  id                SERIAL PRIMARY KEY,
  scout_prospect_id INTEGER REFERENCES scout_prospects(id),
  prospect_id       INTEGER REFERENCES prospects(id),  -- if LinkedIn-sourced

  channel           VARCHAR NOT NULL,  -- email | linkedin | job_application | meta_sync
  action            VARCHAR NOT NULL,  -- sent | bounced | opened | clicked | replied | submitted
  message_body      TEXT,
  subject           VARCHAR,
  external_id       VARCHAR,           -- Resend message ID, LinkedIn post ID, etc.

  created_at        TIMESTAMP DEFAULT NOW()
);
```

---

## Runners and infrastructure

### Mac Mini (always-on, residential IP)

The Mac Mini is the execution environment for all agents. Its residential IP is a core
advantage — it makes email sending and LinkedIn behavior look human, unlike datacenter IPs.

| Runner | File | Schedule | What it does |
|---|---|---|---|
| Scout runner | `macmini-runner/run-scout.mjs` | Every 5 min (polls for queued scout jobs) | Runs the Scout agent |
| Cowork runner | `macmini-runner/run-cowork.mjs` | Every 2 min | Runs LinkedIn prospecting (existing) |

Both runners use the same claim/complete pattern: poll an endpoint, claim a job, run
`claude -p`, mark complete.

### VPS Sentinel (DigitalOcean, $4–6/mo)

Watches Gmail IMAP for LinkedIn notification emails and email replies. Already running.
No changes needed for Phase 1.

### Vercel (thinkbigjoe.com)

Hosts the Next.js app. New pages needed:
- `/command/prospects` — Scout prospect approval dashboard
- `/api/scout/claim` — Runner polls this for queued scout jobs
- `/api/scout/complete` — Runner posts results here
- `/api/scout/approve` — Joe approves a prospect (or via Telegram)
- `/api/meta/sync` — Triggers Meta audience upload (called by cron)

---

## External integrations

| Service | Purpose | Cost | Status |
|---|---|---|---|
| **Hunter.io** | Email finding + verification | $49/mo | To add |
| **Apify** | Google Maps / web scraping | $49/mo | To add |
| **Resend** | Email sending | $20/mo | Already in nanocrew stack |
| **Meta Marketing API** | Custom audience upload | Free (ad spend separate) | To configure |
| **OpenClaw browser** | Website reading, form filling | Free | Running |
| **Neon/Postgres** | All data storage | $5–50/mo | Running |

**Not using**:
- Phantombuster (LinkedIn scraping — banned by LinkedIn March 2025)
- Apollo.io browser extension (banned March 2025)
- Clay (overkill, $500+/mo)
- LinkedIn automation tools (23% account ban rate, not worth it)

---

## Build phases

### Phase 1 — Scout + Approval Dashboard (MVP)

**Goal**: Venus can find prospects; Joe approves them from the dashboard.
No outreach yet — just building and reviewing the pipeline.

- [ ] Add `scout_jobs`, `scout_prospects`, `outreach_log` tables (migration)
- [ ] Build `/api/scout/claim` and `/api/scout/complete` endpoints
- [ ] Build `macmini-runner/run-scout.mjs` runner (mirrors run-cowork.mjs)
- [ ] Write the Scout agent prompt (`prospecting/scout-agent.md`)
- [ ] Add Hunter.io API key to env
- [ ] Add Apify API key to env
- [ ] Build `/command/prospects` dashboard page (approval cards)
- [ ] Add `scout` intent to Venus Telegram command parser
- [ ] Update tbj-mcp MCP server with `queue_scout_job` and `get_scout_status` tools
- [ ] Test end-to-end: text Venus → Scout runs → card appears in dashboard

### Phase 2 — Email Outreach

**Goal**: Approved prospects get a personalized email from Joe.

- [ ] Set up SPF, DKIM, DMARC on thinkbigjoe.com
- [ ] Configure Resend with thinkbigjoe.com domain
- [ ] Build email sending in the Sender agent (`macmini-runner/run-sender.mjs`)
- [ ] Wire Resend webhooks → `outreach_log` (opens, clicks, bounces)
- [ ] Build day-4 and day-8 follow-up logic (if no reply in `outreach_log`)
- [ ] Add CAN-SPAM footer to all emails (unsubscribe link)
- [ ] Test: approve prospect → email sent → tracked in dashboard

### Phase 3 — Meta Ads Retargeting

**Goal**: Every approved prospect is in a Meta custom audience.

- [ ] Create Meta Business Manager + ad account
- [ ] Create custom audience in Meta Ads Manager
- [ ] Build `scripts/sync-meta-audience.mjs` (hash PII → Meta API upload)
- [ ] Add Meta API credentials to env
- [ ] Add `meta_synced_at` tracking to `scout_prospects`
- [ ] Wire nightly cron job (2am Pacific) to trigger sync
- [ ] Create first retargeting ad (creative TBD)
- [ ] Build lookalike audience from `won` clients

### Phase 4 — Job Application Auto-fill

**Goal**: Scout-found job postings get auto-applied via the Mac Mini browser.

- [ ] Create `prospecting/resume.json` with resume data
- [ ] Add job application logic to Sender agent
- [ ] Test on 2–3 company career pages manually first
- [ ] Cap at 3 applications/day
- [ ] Log all submissions to `outreach_log`

### Phase 5 — LinkedIn Connection Requests (Optional, Proceed with Caution)

**Goal**: Expand reach to prospects without email addresses.

- [ ] Integrate Scout-approved prospects into existing Cowork runner LinkedIn flow
- [ ] Share the 10/day connection budget between Cowork and Scout queues
- [ ] Monitor account health closely for first 30 days
- [ ] Stop immediately if LinkedIn flags the account

---

## Data flow summary

```
Scout discovers prospect
    → writes to scout_prospects (pending_review)

Joe approves
    → status = approved
    → Sender picks it up
    → email sent → outreach_log (email, sent)
    → Resend webhook → outreach_log (email, opened / clicked / bounced)
    → nightly cron → included in Meta custom audience upload → outreach_log (meta_sync, synced)

Prospect replies to email
    → Gmail → Sentinel → outreach_log (email, replied)
    → Telegram ping to Joe with reply draft

Prospect replies on LinkedIn
    → LinkedIn email → Sentinel → Telegram ping to Joe

Prospect converts (Joe marks won in dashboard)
    → scout_prospects.status = won
    → added to "Won Clients" Meta audience → lookalike audience updates
```

---

## Compliance and safety

### CAN-SPAM (email)
- One-click unsubscribe link in every email footer
- Physical address in footer (use business address)
- Honest subject lines (no deceptive headers)
- Honor unsubscribes within 10 days (system must check before send)

### GDPR / CCPA (data storage)
- All PII stored in Neon (US-East, SOC 2 compliant)
- Retention policy: delete scout_prospects rows > 2 years old with no activity
- Right to deletion: if a prospect emails asking to be removed, delete their row and
  remove from Meta audience within 48 hours

### Meta Ads (PII upload)
- Only hashed data leaves the system (SHA-256 before upload)
- Use Meta's standard hashing spec: lowercase, trim whitespace, then SHA-256
- Do not upload prospects who have unsubscribed

### LinkedIn (connection requests)
- Stay under 10 connections/day from this account
- No automated DMs to existing connections
- No scraping LinkedIn pages with Scout (use public web sources only)
- Immediate pause if LinkedIn sends a warning or restricts the account

---

## Email setup — Zoho Mail + Apple Mail

**Goal**: `joe@thinkbigjoe.com` as a real IMAP/SMTP mailbox, free, working in Apple Mail.

### Step 1 — Create Zoho Mail account
1. Go to zoho.com/mail → "Sign Up for Free" → choose "Forever Free Plan"
2. Add domain `thinkbigjoe.com` (Zoho walks you through DNS verification)

### Step 2 — Add DNS records to thinkbigjoe.com
thinkbigjoe.com is managed on Vercel. Add these records in Vercel → Domains → DNS:

| Type | Name | Value |
|---|---|---|
| TXT | `@` | `zoho-verification=...` (Zoho gives you this) |
| MX | `@` | `mx.zoho.com` priority 10 |
| MX | `@` | `mx2.zoho.com` priority 20 |
| MX | `@` | `mx3.zoho.com` priority 50 |
| TXT | `@` | `v=spf1 include:zoho.com ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:joe@thinkbigjoe.com` |

DKIM: Zoho generates a DKIM key during setup — add as a TXT record on `zmail._domainkey`.

### Step 3 — Create the mailbox
In Zoho admin: Add User → `joe@thinkbigjoe.com` → set password

### Step 4 — Configure Apple Mail
Open Mail → Add Account → Other Mail Account:
```
Email:    joe@thinkbigjoe.com
Password: (Zoho password)

Incoming (IMAP):
  Server:   imap.zoho.com
  Port:     993
  SSL:      on

Outgoing (SMTP):
  Server:   smtp.zoho.com
  Port:     465
  SSL:      on
```

### Step 5 — Generate App Password for Apple Mail
Zoho requires an App Password for third-party clients (Apple Mail is one).
Zoho → My Account → Security → App Passwords → Generate → use it in Apple Mail instead of your main password.

### Sending domain strategy
- **Now**: send from `joe@thinkbigjoe.com` (personal + low volume outreach)
- **Later** (>50 emails/day): add `mail.thinkbigjoe.com` subdomain as a Resend sending domain,
  send marketing email from `joe@mail.thinkbigjoe.com`. This protects the root domain's
  deliverability reputation if a campaign gets flagged.

---

## Scout modes — two jobs, one agent

Scout runs in two modes, set per job:

### Mode A — Business development (pitch TBJ services)
Scout finds **owners and principals** who would benefit from AI automation services.
- Target: insurance agencies, mortgage brokers, wealth advisors, MSPs, law firms
- Finds: the owner's name, email, phone, LinkedIn
- Drafts: a humble, curious outreach message (see `prospecting/outreach-templates.md` for tone)
- Outreach sent by: **email first** (Zoho), **LinkedIn connection** second (Browserbase sender)

### Mode B — Contractor job applications
Scout finds **companies posting jobs** that match Joe's skill set (AI, automation, web dev).
- Target: Lever/Greenhouse/company career pages with relevant openings
- Finds: job title, job URL, hiring manager if visible
- Drafts: a personalized cover letter or application note
- Outreach sent by: **job application form** (OpenClaw browser, Mac Mini), not email

The `cowork_jobs.intent` field gains a new value: `scout_biz` (mode A) and `scout_jobs` (mode B).
Scout agent is the same — it reads the mode from the job and adjusts its research and draft accordingly.

---

## Scout queue management — 50-prospect target

The Scout runner checks `pending_review` count before each run:

```
count = SELECT count(*) FROM scout_prospects WHERE status = 'pending_review'

if count >= 50:
  log("queue full — nothing to do")
  exit

else:
  needed = 50 - count
  run Scout for min(needed, 10) prospects this session  # 10 per run to stay light
  exit, poll again in 5 min
```

This means Scout runs continuously in the background but never floods the approval queue past 50.
As Joe reviews (approves/skips), Scout automatically refills.

---

## What's already built (local files inventory)

These files exist locally but are gitignored — **they are the starting point**, not new work:

### `prospecting/` — 50 pre-researched prospects across 5 CSVs
Already researched from LinkedIn (Sales Navigator). Ready to import into `scout_prospects`
as the seed data for Phase 1. **No Scout agent needed to research these — they're done.**

| File | Count | Vertical |
|---|---|---|
| `finance-insurance-prospects.csv` | 18 rows | Insurance agencies, mostly local |
| `finance-insurance-salesnav-qualified.csv` | 12 rows | Insurance (Sales Nav qualified) |
| `law-firms-salesnav.csv` | 8 rows | Law firms |
| `msps-it-salesnav.csv` | 3 rows | MSPs / IT services |
| `wealth-salesnav.csv` | 4 rows | Wealth management |

**Action**: Write `scripts/import-prospecting-csvs.mjs` to seed these into `scout_prospects`
as `source = 'csv_import'` and `status = 'pending_review'`. This gives Joe 50 prospects to
review immediately in Phase 1 before Scout is even fully built.

### `linkedin-sender/` — Cloud LinkedIn sender (Browserbase) — **NOT YET COMMITTED**
This is new code that supersedes `windows-sender/` entirely. It runs via **GitHub Actions**
(`.github/workflows/linkedin-sender.yml`) on a cron every 10 minutes, using Browserbase
cloud Chromium + residential proxy. No Mac Mini or Windows PC needed for LinkedIn sends.

**Files to commit**:
- `linkedin-sender/` (whole directory)
- `.github/workflows/linkedin-sender.yml`

**Required before it works**:
1. Browserbase account (browserbase.com) — get API key + Project ID
2. Run `node seed-auth.mjs` once on any machine to log into LinkedIn and save the session Context
3. Add GitHub repo secrets: `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, `BROWSERBASE_CONTEXT_ID`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
4. Do a dry run first: Actions tab → "Run workflow" with dry_run = true

**`windows-sender/` is now obsolete** once linkedin-sender is committed and verified.

### `.env` / `.env.local` / `.env.development.local` — additional secrets
The env files contain Google OAuth IDs, Facebook App ID, better-auth secret, and gcal config
not currently in the Mac Mini's `.env.local`. Copy the missing vars over.

Notable additions:
- `GOOGLE_CLIENT_ID` — for Google OAuth login on the dashboard
- `FACEBOOK_CLIENT_ID` — for Meta/Facebook integration (needed for Meta Ads API later)
- `EMAIL_FROM` / `EMAIL_BCC` — email display name already configured as `joe@thinkbigjoe.com`
- `GCAL_CLIENT_ID` / `GCAL_CALENDAR_ID` — Google Calendar for appointment booking

---

## Open questions

1. **Meta ad creative**: What offer? Free consultation, audit, case study? Needed before Phase 3 ad setup.
2. **Browserbase account**: Do you have one, or does this need to be created?
3. **Sales Navigator**: 2FA was pending — is it now working? (Affects whether Scout can use it for prospecting.)
