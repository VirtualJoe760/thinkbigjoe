# MCP tools — how Claude, OpenClaw, and the app actually connect

`mcp-server/tbj-mcp.mjs` is a single MCP (Model Context Protocol) server: one Node process, one
file, that exposes named tools (`add_forge_prospect`, `enrich_forge_contact`,
`save_forge_outreach_draft`, etc.) which read/write the Neon database. **Only one thing calls it
at runtime: OpenClaw's agents.** This doc exists because "Claude / OpenClaw / the app / MCP" is
four names for pieces that are easy to conflate — here's exactly how they relate.

---

## The wiring, concretely

```
~/.openclaw/openclaw.json                 ← OpenClaw's config, on Joe's Mac
  "servers": { "tbj": {
      "command": "/usr/local/bin/node",
      "args": ["/Users/macdaddyjoe/code/thinkbigjoe/mcp-server/tbj-mcp.mjs"],
      "env": { "DATABASE_URL": "postgresql://…neon…" }   ← hardcoded HERE, not read from
  }}                                                          this repo's .env.local — see below

        │  OpenClaw spawns tbj-mcp.mjs fresh, per agent session, over stdio
        ▼
  An OpenClaw agent (Venus / prospector / outreach / marketing-manager)
  calls a tool by name, e.g. add_forge_prospect({ business_name, niche, … })

        │  tbj-mcp.mjs's CallTool handler runs the matching SQL against Neon
        ▼
  Neon Postgres (forge_sites, prospects, outreach, activity_log, …)

        │  the SAME database, read by this app's own Drizzle queries
        ▼
  This app (Vercel/Next.js) renders /command/** and /portal/**
```

**tbj-mcp.mjs lives in this repo's source tree** (`mcp-server/`) so it's version-controlled
alongside the schema and UI it serves — but it is **not part of the Next.js app**. It's a
standalone Node package (`mcp-server/package.json`, not a pnpm/npm workspace member, no
`import` from `src/`) that only OpenClaw ever executes, and only on Joe's Mac.

## Where each piece's job stops

- **Claude Code (me, in a session like this one)** — I **author and maintain** `tbj-mcp.mjs`'s
  source. I do **not** call its tools at runtime: this repo has no `.mcp.json` wiring a Claude
  Code session to it. If you ask me to "check the prospect queue," I read the database directly
  (or the code) — I'm not invoking `list_forge_queue` the way an agent would. Don't assume a
  Claude Code session is "using the MCP tools" — it's building/fixing the thing that does.
- **OpenClaw agents (Venus, `prospector`, `outreach`, `marketing-manager`)** — the actual,
  only runtime callers. Each cron in `src/lib/venus-crons.mjs` names which tools an agent may
  call for that run; OpenClaw resolves those names against `tbj-mcp.mjs`'s `ListTools` output.
  See [OPENCLAW.md](OPENCLAW.md) for the agent/cron mechanics.
- **This app (Vercel/Next.js)** — talks to the **same Neon database** directly via Drizzle
  (`src/db/*`), completely independent of MCP. It never calls `tbj-mcp.mjs`. Server actions
  (Joe clicking Approve, Approve-for-marketing, etc.) and MCP tool calls (an agent's writes) are
  **two separate write-paths into the same tables** — the schema is the shared contract between
  them, not shared code. This is exactly why "ship full-stack" (AGENTS.md) matters: a new MCP
  tool and the UI that reads its output must agree on column names/types with nothing to check
  that for you at compile time.

## The duplicated `DATABASE_URL` — a real gotcha, not a bug (yet)

`openclaw.json`'s `servers.tbj.env.DATABASE_URL` is a **separate, hardcoded copy** of the Neon
connection string — it is not read from `~/code/thinkbigjoe/.env.local` the way, say,
`forge-poll.mjs` reads it (see [FORGE.md](FORGE.md)'s connection table). If the Neon connection
string ever rotates, **this is a second place that needs updating** or every OpenClaw agent
silently loses DB access while everything else keeps working. There's no automated sync between
the two right now — check `openclaw.json` by hand after any Neon credential rotation.

## What the tools actually cover

Grouped by what they touch (see [VENUS_UI_MAPPING.md](VENUS_UI_MAPPING.md) for the full
tool-by-tool → UI-surface map):
- **Prospecting**: `add_forge_prospect`, `list_forge_queue`, `list_forge_blacklist`
- **Contact + call-prep enrichment**: `list_forge_needs_contact`, `enrich_forge_contact`,
  `list_forge_needs_callprep`, `save_forge_callprep`
- **Outreach**: `list_forge_outreach_queue` (gated on `marketing_approved_at` — see
  [FORGE.md](FORGE.md)'s lifecycle), `save_forge_outreach_draft`, `mark_forge_outreach_sent`,
  `list_forge_followup_due`
- **Design / brand (brand-lead)**: `save_design_report` + `list_design_reports` (v2.20.0) — the
  Brand Lead's design-research loop. Each 2×/day run reads its prior reports (`list_design_reports`),
  studies a vertical's best-in-class sites, authors a design-language spec in the forge's
  `factory/design-languages.json`, then files a **report** (`save_design_report`) that MUST cite the
  sites it studied (`sources[]` — required; that's how the report is verified). Reports render on
  **/command/engine → Design research**, where Joe verifies/rejects them (`setDesignReportStatus`);
  the design itself is built human-gated from the Template designer (`requestTemplateDesign` →
  `job_requests(kind='design_template')` → `trigger-poll` → `forge-template.sh`). See
  [FORGE.md](FORGE.md) + [OPENCLAW.md](OPENCLAW.md).
- **Monitoring / spend**: `forge_digest` (v2.18.0) — the forge ops snapshot: master +
  per-capability switches, weekly RUN-budget used vs remaining (75/90% warnings), build + edit
  queue depth, 24h/7d throughput. Fetches `GET /api/forge/digest` (`getForgeDigest` — the same
  source the Engine cockpit + Overview render), so ask it anytime for "where are we at with the
  forge, usage, and spend?" `forge_funnel_stats` covers the sell-first funnel counts.
- **Customer voice receptionist** (v2.26.0): `list_calls`, `get_call`, `set_voice_line_status` — the
  calls the AI answered **for a customer's business**, not TBJ's own line. Tenancy comes from
  `voice_lines` (dialled number → site). `list_calls` flags two things loudly because they're what
  actually needs acting on: an **emergency**, and a call where the **owner was never texted**
  (`notified_at` null). `set_voice_line_status` pauses/releases/reactivates a line when a customer
  cancels — it does *not* touch the customer's own phone forwarding (that's their `##61#` kill
  switch). See [VOICE_TENANCY_SPEC.md](VOICE_TENANCY_SPEC.md).
  > **Deliberately NOT a tool: provisioning a line.** Buying a Retell number is a real per-number
  > cost, so an agent must not be able to trigger it. That stays a human-run
  > `scripts/retell/provision-line.mjs --apply`.
- **Paid ads** (v2.29.0): `ads_funnel_report` — the on-site half of ads math: per-campaign
  form-fills → booked calls → accounts for leads carrying `utm_*`/`fbclid` attribution (captured
  on ad landing, stored on `leads`), plus organic volume for contrast. Read-only; combine with
  Meta's spend numbers (the separate `meta-ads` MCP server) for cost per form-fill. See
  [ADS.md](ADS.md).
- **Job applications (whitney)** — `record_found_job`, `list_approved_jobs`,
  `update_application_status`, plus the **question-escalation loop** (v2.42.0):
  `record_question` → `list_answered_questions` → `mark_question_resolved`. When Whitney can't
  proceed truthfully (a field she can't answer from Joe's profile, a judgment call) she posts a
  question instead of guessing — and `record_question` now **pings Joe's Telegram immediately**
  (`notifyJoeTelegram`, using `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` from `.env.local`;
  fail-open, so a Telegram outage never wedges the tool call). The board alone is passive: without
  the ping a blocked application sits dead until Joe happens to look.
  Joe then has **two** valid outcomes on `/command/applications`, and `list_answered_questions`
  returns both:
  - **Answer** (`answerQuestion`) → she resumes the application. A question carrying a `topic`
    slug also upserts `candidate_facts`, so she answers it herself forever after.
  - **Decline to answer** (`declineQuestion`) → the question goes `status='declined'` **and the
    application is cancelled** (`job_applications.status='closed'`). This is a first-class
    outcome, not a failure: a question she can't get past is an application she can't finish.
    She reads the decline, resolves it, and moves to the next job — no re-asking, no rewording,
    no applying anyway. Reversible via `reopenJob` from the board's archive.
- **Priority employers / directed finds** (v2.46.0): `record_found_job` takes `directed: true`
  for a role at an employer **Joe named himself** (the ⭐ PRIORITY EMPLOYERS list in Whitney's
  `USER.md` — currently Anthropic, xAI, and real-estate brokerages/proptech). Those get their own
  review lane (`job_applications.directed`, `DIRECTED_CAP = 20`) and are **exempt from the general
  `REVIEW_CAP = 25`**. The reasoning: the general cap exists to stop indiscriminate spraying that
  costs tokens and puts traffic on Joe's job-board identity — but an employer Joe *chose* is
  already the human judgement that cap is waiting for, so a full board must not block "go look at
  Anthropic." Directed cards show a **★ Your target** badge on `/command/applications` and sort to
  the top. `job_board_count` tells Whitney the directed lane is still open when the general one is
  full, so a full board redirects her rather than idling her.

- **Job-hunt debrief (Venus)** (v2.43.0 / v2.44.0): `get_job_hunt_report` + `send_telegram_update`.
  `get_job_hunt_report` is the rollup behind Joe's 12:30/19:30 Telegram debrief — applications
  submitted in the window **with titles + companies**, interview-stage roles, work in progress,
  and every open question still pending on him. It reads the **tables**, deliberately, so the
  debrief reports what happened rather than what Whitney said happened; her own `log_activity`
  notes ride along underneath, labelled as self-reported.
  `send_telegram_update` is how Venus actually delivers it. That is not a redundancy —
  see [OPENCLAW.md](OPENCLAW.md)'s **Cron delivery** section: OpenClaw's own `--announce`
  routing is fragile enough here that the message is sent by tool call as well.
  ⚠️ Both this and `record_question`'s ping send as **@Venus_JPSbot**, resolved from
  `~/.openclaw/openclaw.json` (v2.45.0) — NOT the `@thinkbigjoe_alerts_bot` token in `.env.local`
  that `src/lib/telegram.ts` uses. Same chat id, different conversation: sending agent messages
  from the alerts bot delivers them successfully into a thread Joe isn't reading. Route any new
  agent-facing notification through here, not through the app's helper.
- **Every state-changing tool in every group calls `audit(...)`** — the mechanism behind
  `/command/jobs`'s "verified" rows. See VENUS_UI_MAPPING.md's Audit log section.

## Adding a new tool

Same rule as everywhere else in this project (AGENTS.md's full-stack rule, specialized): a new
tool must be registered in **both** `ListTools` and `CallTool` in `tbj-mcp.mjs`, bump
`SERVER_VERSION`, call `audit()` if it writes, and be named in the cron(s) that should use it in
`venus-crons.mjs` — then `npm run venus:sync`. No restart needed on the OpenClaw side: it's
stdio-spawned fresh per agent session, so the next run picks up the new version automatically.
