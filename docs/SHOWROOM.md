# The Showroom — the sell-first preview engine

The showroom flips the old model. Instead of **building** a full site for every prospect upfront
(slow, ~$/build, hits Vercel limits), we **sell the vision cheaply** — a personalized *preview* —
and only run the expensive forge build when a prospect **claims** it. A claim, not a build, is what
qualifies a lead.

- **A preview costs ~$0.0002** (one Gemini text call) — no forge build, no per-prospect deploy.
- **The full build fires only on a claim** — you never pay to build for people who ghost you.
- So you can preview your **entire** prospect queue for pennies and pace outreach by capacity, not
  by build cost. See [FORGE.md](FORGE.md) for the build side, [VENUS_UI_MAPPING.md](VENUS_UI_MAPPING.md)
  for the UI/cron/tool mapping.

---

## The funnel

```
discovered ──▶ preview ──▶ (outreach: "claim your preview") ──▶ CLAIMED ──▶ building ──▶ built ──▶ paid
   scrape     Gemini copy      the outreach agent invites          the claim    forge     deploy
              + claim code     them to claim (email / DM)          TRIGGERS     builds
              + 14-day hold                                        the build
```

**The key inversion:** the claim code is minted at the **preview** stage (not at build), and
claiming an unbuilt preview flips `forge_sites.status='approved'` → the forge poller builds it.
Claiming *is* the build trigger.

---

## The pieces (what's built) ✅

**Preview generation** — `src/lib/forge-preview.ts` (`generatePreview(siteId)`)
- Gemini 2.5 Flash writes tailored hero copy (eyebrow / headline / subcopy); the hero image reuses
  the already-scraped business photo (no image gen). Mints the claim code (`generateClaimCode`),
  sets a **14-day** `preview_expires_at`, stores it all in the `forge_sites.preview` jsonb, and
  audits. Fallback-safe (templated copy if Gemini fails). Needs `GEMINI_API_KEY`.

**Trigger API** — `src/app/api/forge/preview/route.ts` (`POST`, `Bearer CRON_SECRET`)
- The single entry point (`{siteId}` or `{slug}`); the MCP tool, the engine, and manual calls all
  go through it, so generation logic lives in one place.

**The public preview page** — `src/app/(frontend)/s/[slug]/page.tsx`
- A personalized one-page site rendered from the prospect's data: business name, niche, city, brand
  color, real Google reviews, phone, a **"reserved for N days"** countdown, and claim-&-build CTAs.
  Dynamic render — no build, no deploy per prospect.

**Claim = build trigger** — `src/app/(frontend)/portal/actions.ts`
- `claimSite()`: claiming an unbuilt preview attaches the owner **and** sets `status='approved'`
  (queues the forge) + returns a "we're building your site now" state.
- `chooseTemplate()`: a claimed owner picks a different design → sets `preferred_template` +
  re-queues a rebuild. Template list in `src/lib/forge-templates.ts`.

**Portal UI** — `portal/page.tsx` (a "building your site" banner + the `TemplatePicker`),
`portal/claim/claim-form.tsx` (a building state on claim).

**The preview engine (paced waves)** — `scripts/preview-engine.mjs` + `com.thinkbigjoe.previewengine`
- Generates previews in **daily waves**, warmest-first, capped by a config budget. Config lives in
  the **`preview_engine`** table (`daily_budget` = wave size, `enabled`); it counts what's already
  been generated today and generates only the remainder, then records `last_run_summary` + a
  `preview_engine_run` activity event. The plist is created **unloaded** — `launchctl load` it to
  start waves. The wave budget exists to keep previews **fresh** (14-day expiry) and paced to
  outreach capacity — **not** to save money (generation is nearly free).

**Outreach agent integration** — the communications (outreach) agent works the preview stage:
- `list_forge_preview_outreach` (MCP) — preview-ready prospects with the `/s/<slug>` link, claim
  code, reserved-days, and channels.
- `save_forge_outreach_draft` accepts preview-stage sites; `list_forge_followup_due` is
  preview-aware (re-shares the link). The `TBJ Forge Outreach` + `Follow-up` crons pitch
  **"claim your free preview"** instead of "your site is live." (Agent persona files must reflect
  this too — see [AGENT_PLAYBOOK.md](AGENT_PLAYBOOK.md).)

**MCP tools** — `generate_forge_preview` (mint one preview), `list_forge_preview_outreach`
(the outreach queue). In `mcp-server/tbj-mcp.mjs`.

---

## Schema

`forge_sites` gained (migrate on Neon → `npm run db:pull`):

| Column | Purpose |
|---|---|
| `preview` (jsonb) | `{ eyebrow, headline, subcopy, heroUrl, model }` — the generated content |
| `preview_generated_at` | when it was minted (wave counting + freshness) |
| `preview_scraped_at` | when the underlying data was last scraped (re-scrape logic) |
| `preview_expires_at` | the 14-day "reserved" window (drives the countdown + expiry) |
| `claim_code` (existing) | now minted at **preview** time, not build time |

Plus the **`preview_engine`** config table (`daily_budget`, `enabled`, `last_run_summary`).

---

## Control + economics

- **Cost:** ~$0.0002/preview (Gemini text) + a reused scraped photo. The entire ~420-prospect queue
  ≈ **$0.06** and ~15 min. The forge build (the expensive part) only runs on a claim.
- **Pacing:** `preview_engine.daily_budget` throttles the waves. Set it to ~1.5× your daily outreach
  goal so there's always fresh inventory ahead of the outreach agent, never a 400-deep backlog that
  expires unsent.
- **Freshness:** previews expire in 14 days; re-scrape-on-open (past ~30 days) keeps reopened
  previews from looking dated.
- **The real bottleneck is outreach + review capacity, not generation** — you pace by how many you
  can responsibly send + close, not by token cost.

---

## Roadmap (not yet wired) ⏳

- **Daily outreach goal + token cap** — an `outreach_engine` config (`daily_goal`) so the outreach
  agent drafts a fixed number/day → flat, predictable token spend. (Preview supply auto-tracks the
  goal ×1.5.)
- **Marketing-manager as funnel operator** — `forge_funnel_stats`, `set_outreach_goal`,
  `list_expiring_previews` tools + a daily cron that paces waves, chases expiring previews, and
  reports **calls booked**.
- **Control panel** on `/command/prospects` — set the daily goal + see the funnel (previews ready ·
  drafted today / goal · claimed · calls booked).
- **Agent persona updates** — rewrite the outreach + marketing-manager persona files to the
  preview flow (via `/edit-agent`) + gateway restart, so the live agents act on it.

These are the phased plan to make the preview + outreach engine fully self-pacing.
