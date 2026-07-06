# Venus ↔ UI Mapping

Every surface in the TBJ command center is powered by a specific Venus cron or MCP tool.
This doc is the source of truth for that connection. **When you change a UI feature, check
this doc and update the cron/tool that feeds it — and vice versa.**

---

## THE RULE: Venus features ship full-stack, in one PR

A Venus feature is never "just UI" or "just backend." Every Venus capability is **three layers
that ship together** so we never build the feature twice:

1. **UI surface** — the page/section in `/command/**` where Joe sees or controls it.
2. **MCP tool** — a named tool in `mcp-server/tbj-mcp.mjs` that reads/writes the right DB table.
3. **Cron entry** — a declaration in `src/lib/venus-crons.mjs` (the manifest) so Venus actually
   runs it on a schedule, then `npm run venus:sync` to push it to OpenClaw.

If any layer is missing, the feature is half-built and will silently fail:
- UI with no tool → the page is forever empty (this was the LinkedIn-replies bug).
- Tool with no cron → Venus has the ability but never uses it.
- Cron with no UI → work happens invisibly with no way to review or control it.

**Build all three in the same change.** The checklist at the bottom enforces this.

---

## Crons-as-code architecture (the scalable part)

Venus's crons are **declared in the repo**, not buried in CLI history on the Mac:

```
  src/lib/venus-crons.mjs   ← SOURCE OF TRUTH (schedule, prompt, tools, uiSurface per cron)
        │
        ├── npm run venus:sync ──→ reconciles OpenClaw (add/edit by name) — OpenClaw just executes
        │
        └── imported by /command/crons ──→ dashboard: schedule, tools, prompt, last-run (activity_log)
```

- **Editing a cron**: change `venus-crons.mjs`, run `npm run venus:sync`. Never edit prompts via
  `openclaw cron edit` directly — that drift is invisible and gets overwritten on the next sync.
- **Seeing what runs**: the `/command/crons` tab renders the manifest + last-run from `activity_log`.
  If every "last ran" is stale, the OpenClaw gateway (Joe's Mac) is down.
- **`npm run venus:sync -- --dry`**: preview changes without touching OpenClaw.

---

## Rule: UI feature = agent workflow

If a UI surface shows data that Venus is supposed to populate, there must be a named MCP tool
that writes to the correct DB table/column. If there isn't one, the surface will always be
empty — no matter how smart the cron prompt is.

---

## Surface-by-surface map

### `/command` — Dashboard

| Stat | DB source | Venus tool that writes it | Cron |
|---|---|---|---|
| Prospects in DB | `prospects` count | `add_prospect` | TBJ Prospect Scout (2am daily) |
| Drafts awaiting review | `outreach.status = 'draft'` | `add_prospect` (auto-creates draft) | TBJ Prospect Scout |
| Ready to send | `outreach.status = 'approved'` | Joe approves in UI → `approveDraft()` | n/a (manual) |
| Sent this week | `outreach.status = 'sent'` AND `sent_at` within 7d | `mark_sent` | TBJ LinkedIn Outreach (hourly) |
| Inbound leads | `leads` table | Site form submissions (not Venus) | n/a |
| Booked calls | `leads.status = 'booked'` | Site booking form + `book_appointment` | n/a |

**Gotcha — "7 ready to be sent" not clearing:** The outreach cron calls `check_outreach_window`
first. If automation is disabled in `/command/automation`, or it's outside working hours, Venus
stops at step 1 and nothing sends. Check `/command/automation` to confirm the status reads
"On & active." If it says "Off" or "outside working hours," that's why the queue is stuck.

---

### `/command/prospects` — Prospect queue

| Tab | DB source | Venus action | Cron |
|---|---|---|---|
| Priority / All pending | `outreach.status IN ('draft','edited')` | `add_prospect` writes both prospect + outreach draft | TBJ Prospect Scout |
| Ready to send | `outreach.status = 'approved'` | Joe clicks Approve in UI | n/a |
| Sent | `outreach.status = 'sent'` | `mark_sent` | TBJ LinkedIn Outreach |

---

### `/command/leads` — Leads page

| Section | DB source | Venus action | Cron |
|---|---|---|---|
| LinkedIn replies | `prospects.status = 'replied'` + `reply_drafts` | **`save_inbound_reply`** then **`save_reply_draft`** | TBJ LinkedIn Inbox Check (every 30m) |
| Inbound form leads | `leads` table | Site forms (not Venus) | n/a |

**How it works end-to-end:**
1. Venus opens linkedin.com/messaging during the inbox check cron.
2. Finds a new message → calls `save_inbound_reply(prospect_name, message)`.
   - Writes row to `conversations` table (direction='inbound').
   - Sets `prospects.status = 'replied'`.
   - Returns conversation history.
3. Venus drafts a reply using the history for context.
4. Calls `save_reply_draft(prospect_name, their_message, draft)`.
   - Creates `reply_drafts` row with `status='awaiting'`.
5. Prospect appears in the "LinkedIn replies" section on `/command/leads`.
6. Joe reviews, edits if needed, clicks "Approve & queue."
   - `reply_drafts.status → 'approved'`, `final_text` saved.
7. Venus (or manual) sends the approved text on LinkedIn.

**What was broken before (fixed 2026-06-25):** The inbox check cron told Venus to "draft a
response via Telegram" — bypassing the DB entirely. The `conversations` and `reply_drafts`
tables were never written. Added `save_inbound_reply` + `save_reply_draft` MCP tools and
updated the cron to call them.

---

### `/command/[id]` — Prospect detail page

| Section | DB source | Venus action |
|---|---|---|
| Outreach sequence steps | `outreach` table | Auto-created by `add_prospect`; Joe approves in UI |
| Conversation thread | `conversations` table | `save_inbound_reply` (inbound), `saveOutboundMessage` server action (outbound) |
| Reply panel | `reply_drafts` table | `save_reply_draft` creates it; `approveReply` server action approves |

---

### `/command/sites` — Forge sites (Phase 1: find → approve → build)

The bridge between Venus's prospecting and the site-building forge (`~/code/webdev-templates`, a
separate local pipeline that runs Claude Code — see its own `factory/README.md`). Phase 1 only:
finding + qualifying + building. Outreach (drafting/sending an email once a site is built) is a
later phase — built sites just land in a visible "ready for outreach next" state.

| Section | DB source | Who writes it |
|---|---|---|
| Needs your review | `forge_sites.status = 'discovered'` | `add_forge_prospect` (Venus) |
| Queued to build | `forge_sites.status IN ('approved','building')` | Joe clicks Approve → `approveForgeSite()` server action; then `factory/forge-poll.mjs` (NOT Venus — a plain poller on Joe's Mac) flips it to `building` when it claims the row |
| Built | `forge_sites.status = 'built'` | `POST /api/forge/register` (called by `forge-poll.mjs` after `forge-build.sh` finishes) |
| Denied / failed | `forge_sites.status IN ('denied','build_failed')` | Joe clicks Deny → `denyForgeSite()`; or a build error via `/api/forge/register` |

**How it works end-to-end:**
1. Daily, "TBJ Forge Prospect Scout" has Venus research local service businesses with no/bad
   website and call `add_forge_prospect` for each — lands as `status='discovered'`.
2. Joe reviews `/command/sites` and clicks Approve or Deny per business.
3. `factory/forge-poll.mjs` (a plain script, cron/launchd on Joe's Mac — deliberately NOT an
   OpenClaw/Venus cron, since running an 8-10 minute `claude -p` build isn't a cognitive task)
   polls for `status='approved'` rows, claims one, writes a `business.json`, and runs the existing
   `factory/forge-build.sh` pipeline (build → screenshot → push to GitHub → deploy to Vercel).
4. On completion it `POST`s to `thinkbigjoe.com/api/forge/register` (Bearer `CRON_SECRET`, same
   auth pattern as `/api/cron/daily-digest`), which flips the row to `built` (or `build_failed`)
   and logs to `activity_log` (`actor: 'forge'` — not `'venus'`, since this event is deterministic
   infra reporting a result, not an LLM decision).

**Why the build itself isn't a Venus cron:** Joe's call — site builds spend real Claude Max-plan
minutes and should require his explicit approval before that happens; a babysitting LLM turn for a
10-minute subprocess is also the wrong shape for a cron. Venus's crons are all bounded, fast,
tool-calling turns — the forge poller is boring, reliable, unattended infrastructure instead.

**Built → outreach handoff.** Once a site is `built` (and unclaimed), the **"TBJ Forge Outreach"**
cron has the **outreach** agent pull it with `list_forge_outreach_queue` and draft the owner email
with `save_forge_outreach_draft` (sets `forge_sites.outreach_status='drafted'`, `audit()`s
`forge_outreach_drafted`). Joe reviews each draft in `/command/prospects` → **Built** and clicks
**Approve & send** (`sendForgeOutreach()` server action → SMTP via `sendForgeOutreachEmail`, which
appends the live-site link, the **claim code**, and a **book-a-call** button). Sending flips
`outreach_status='sent'` + `contacted_at`. The agent only drafts — Joe's approve-&-send is the human
gate on outbound email; the owner's two doors are *sign in & claim the site* or *book a call with Joe*.

---

### `/command/automation` — Automation settings

Controls `automation_settings` table row. `check_outreach_window` reads this on every
outreach run. If `enabled = false`, Venus exits immediately — nothing sends regardless of
what's approved in the queue. This is the first place to check when approved prospects
aren't being sent.

---

### `/command/jobs` — Audit log

| Content | DB source | Venus action | Cron |
|---|---|---|---|
| Verified actions | `activity_log` (`metadata.auto = true`) | `audit()` — auto-called by every state-changing MCP tool | all crons (as a side effect of their tools) |
| Reported summaries | `activity_log` (no `auto` flag) | `log_activity` | every cron calls this at the end |

**Verified vs reported.** Every state-changing MCP tool (`mark_sent`, `save_inbound_reply`,
`save_reply_draft`, `handle_reply`, `add_prospect`, `add_forge_prospect`, `save_forge_outreach_draft`,
`update_prospect`, `schedule_followup`, `mark_followup_sent`, `book_appointment`) calls `audit()` as a side effect of
its real DB write. `actor` is normally `'venus'`; `/api/forge/register` is the one exception — it
logs with `actor: 'forge'` because that event is reported by deterministic infra (the build
poller), not an LLM decision.
Those rows are **verified** — they reflect what actually changed in the database, independent of
whatever Venus says in her end-of-cron `log_activity` summary (**reported**). When the two
disagree, that's the signal to investigate. The audit log attributes each action to the cron that
owns its `event_type` (from the manifest's `eventTypes`).

**Adding a state-changing tool?** It MUST call `audit(action, summary, { prospectId, target, detail })`,
and the action's `event_type` should be listed in the owning cron's `eventTypes` in
`src/lib/venus-crons.mjs` so it's attributed to the right agent.

---

## Cron → tool → UI surface map

| Cron | Key tools called | UI surfaces updated |
|---|---|---|
| TBJ Prospect Scout (2am daily) | `add_prospect`, `update_prospect`, `list_needs_enrichment`, `log_activity` | `/command` prospects count, `/command/prospects` queue |
| TBJ LinkedIn Outreach (hourly) | `check_outreach_window`, `list_approved_for_outreach`, `mark_sent`, `log_activity` | `/command` sent count, `/command/prospects` sent tab |
| TBJ LinkedIn Inbox Check (every 30m) | `save_inbound_reply`, `save_reply_draft`, `list_connected_without_followups`, `schedule_followup`, `log_activity` | `/command/leads` LinkedIn replies, `/command/[id]` conversation thread |
| TBJ Follow-up Drip (weekdays 10am) | `list_due_followups`, `mark_followup_sent`, `log_activity` | `/command` (no dedicated surface yet) |
| TBJ Follow-up Scheduler (Sunday 3am) | `list_connected_without_followups`, `list_incomplete_followup_sequences`, `schedule_followup`, `log_activity` | `/command` (no dedicated surface yet) |
| TBJ Forge Prospect Scout (4am daily) | `add_forge_prospect`, `list_forge_queue`, `log_activity` | `/command/sites` (Needs your review) |
| TBJ Forge Outreach (4pm daily) | `list_forge_outreach_queue`, `save_forge_outreach_draft`, `log_activity` | `/command/prospects` (Built — draft → Approve & send) |
| TBJ Forge Follow-up (5pm daily) | `list_forge_followup_due`, `save_forge_outreach_draft`, `log_activity` | `/command/prospects` (Built — follow-up touch 2–3 → Approve & send) |
| *(not a Venus cron)* `factory/forge-poll.mjs` on Joe's Mac | n/a — plain poller, not an MCP tool | `/command/sites` (Queued to build → Built) |

---

## Shipping a Venus feature — full-stack checklist

Every Venus feature ships all three layers in the same PR. Before merging:

**Backend (MCP tool)**
- [ ] Tool added to `mcp-server/tbj-mcp.mjs` that reads/writes the correct DB table/column.
- [ ] Tool registered in BOTH the `ListToolsRequestSchema` handler AND the `CallToolRequestSchema` switch.
- [ ] Tool output column names/types match what the UI query expects.
- [ ] If it changes state, it calls `audit(action, summary, { prospectId, target, detail })`.
- [ ] MCP server `version` bumped.

**Schedule (cron manifest)**
- [ ] Cron entry added/updated in `src/lib/venus-crons.mjs` with `tools`, `uiSurface`, `eventTypes`, and the exact prompt.
- [ ] The prompt actually calls the new tool (by name).
- [ ] `npm run venus:sync -- --dry` shows the expected change, then `npm run venus:sync` applied it.

**UI surface**
- [ ] Page/section under `/command/**` renders the data the tool writes.
- [ ] If it's a new top-level area, added to `src/app/(frontend)/command/nav.tsx`.

**Docs**
- [ ] This doc updated (surface map + cron→tool→UI map).
- [ ] `npm run build` passes.
