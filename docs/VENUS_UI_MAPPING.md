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

### `/command/automation` — Automation settings

Controls `automation_settings` table row. `check_outreach_window` reads this on every
outreach run. If `enabled = false`, Venus exits immediately — nothing sends regardless of
what's approved in the queue. This is the first place to check when approved prospects
aren't being sent.

---

### `/command/jobs` — Activity log

| Content | DB source | Venus action | Cron |
|---|---|---|---|
| All Venus activity | `activity_log` table | `log_activity` | Every cron calls this at the end |

---

## Cron → tool → UI surface map

| Cron | Key tools called | UI surfaces updated |
|---|---|---|
| TBJ Prospect Scout (2am daily) | `add_prospect`, `update_prospect`, `list_needs_enrichment`, `log_activity` | `/command` prospects count, `/command/prospects` queue |
| TBJ LinkedIn Outreach (hourly) | `check_outreach_window`, `list_approved_for_outreach`, `mark_sent`, `log_activity` | `/command` sent count, `/command/prospects` sent tab |
| TBJ LinkedIn Inbox Check (every 30m) | `save_inbound_reply`, `save_reply_draft`, `list_connected_without_followups`, `schedule_followup`, `log_activity` | `/command/leads` LinkedIn replies, `/command/[id]` conversation thread |
| TBJ Follow-up Drip (weekdays 10am) | `list_due_followups`, `mark_followup_sent`, `log_activity` | `/command` (no dedicated surface yet) |
| TBJ Follow-up Scheduler (Sunday 3am) | `list_connected_without_followups`, `list_incomplete_followup_sequences`, `schedule_followup`, `log_activity` | `/command` (no dedicated surface yet) |

---

## Shipping a Venus feature — full-stack checklist

Every Venus feature ships all three layers in the same PR. Before merging:

**Backend (MCP tool)**
- [ ] Tool added to `mcp-server/tbj-mcp.mjs` that reads/writes the correct DB table/column.
- [ ] Tool registered in BOTH the `ListToolsRequestSchema` handler AND the `CallToolRequestSchema` switch.
- [ ] Tool output column names/types match what the UI query expects.
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
