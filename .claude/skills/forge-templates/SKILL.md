---
name: forge-templates
description: Operate the ThinkBigJoe forge's template + brand-design pipeline — review the Brand Lead's design research, author new design-languages, queue/approve templates, diversify which templates leads land on, and fix template bugs safely. Use when Joe wants to add/approve/fix a website template, work with the brand-lead agent's design research, change which designs the forge uses, or diversify built sites. Do NOT use for editing one live customer site's content (that's the portal editor) or for the thinkbigjoe app UI itself.
argument-hint: [what you want to do with templates]
---

# Working the forge template + brand pipeline

Three codebases, one Neon DB (all on Joe's Mac):
- **App** `~/code/thinkbigjoe` (Vercel/Next.js) — command center `/command/**` + portal `/portal/**`.
- **Forge** `~/code/webdev-templates` (Joe's Mac only) — builds real sites from templates.
- **Brand Lead** — an OpenClaw agent (`~/.openclaw/agents/brand-lead/`) that researches verticals and authors design-languages. It does **not** build templates.

**The chain:** Brand Lead research → `design_reports` (DB) + a spec in `factory/design-languages.json` → Joe queues a build → `forge-template.sh` builds `templates/<id>/` (registers `enabled:false`) → Joe **approves** it in `/command/engine` → `forge-build.sh` selects it for matching businesses.

Read `docs/FORGE.md` (source of truth) and the map in this repo before deep work. The full pipeline detail is also mirrored in the brand-lead's `~/.openclaw/agents/brand-lead/TOOLS.md`.

## ⚠️ Cost-safety (read before queuing ANY build)
Template/site builds are **expensive `claude -p --max-turns 160` runs on Joe's Max subscription**. The 2026-07-06 incident: overlapping runs burned real money. Load-bearing rules:
- **One build at a time.** The forge holds a lock (`sites/.forge.lock.d`); never spawn a second. `forge-poll.mjs` claims exactly one job per tick.
- **Never mass-fire** template builds. Queue **one** design-language, let it finish (~30–40 min), review, then the next.
- Spend is measured in **runs, not dollars** — `forge_engine.weekly_run_budget` (default 40), `templates_per_day` (default 2). Telegram warns at 75/90/100%.
- `claude -p` must run on the **Max subscription** (the forge unsets `ANTHROPIC_API_KEY`). If cost looks wrong, verify that first.

## Where templates live & what "enabled" means
- **Source of truth for `enabled`: the cloud DB `templates` table.** Toggle it from **`/command/engine` → "Templates" panel** (`command/actions.ts:setTemplateEnabled`).
- `forge-poll.mjs` **mirrors** those flags into `templates/registry.json` each tick, so `forge-build.sh` (which reads the registry) honors the UI. Don't hand-edit `registry.json` — the DB overwrites it next poll.
- The app's owner-facing picker mirror is `src/lib/forge-templates.ts` (hand-kept — update when templates are added/retired).
- Each `templates/<id>/` is a standalone Next.js app cloned from `frontend-base`, composing the **locked** `@webdev/ui` library. Structural distinctness = **skeleton** (`app/page.tsx` section order) + **variants** + **tokens** (`app/globals.css` hue/neutral-temp/radius/fonts) + 5 theme presets (`THEMES.md`). Never hard-code colors; brand tokens only.

## Common tasks

### Approve / diversify (no build cost)
1. Preview candidates: `templates/<id>/preview.png` (Read the image).
2. Enable good ones in the **Templates panel** (or, scripted, `UPDATE templates SET enabled=true WHERE id=$id`).
3. More enabled templates + `forge-build.sh`'s anti-repeat rotation = more diversity across leads. Check what a live site actually uses by visiting `tbj-<slug>.vercel.app`; DB `forge_sites.preferred_template` is only set on owner override (else forge niche-matches at build).

### Author a new design-language (Brand Lead's job; you can too)
Add ONE entry to `~/code/webdev-templates/factory/design-languages.json` — `{id,name,mood,bestFor,type,color,motion,composition,newSections,distinctFrom}`. **`composition` (section order) is what makes it distinct** — must not match another language. Keep it genuinely different (check `distinctFrom` + `registry.json`). This is a spec, not code.

### Queue a template build (human-gated, costs a run)
- UI: `/command/engine` → "Design a new template" (`requestTemplateDesign()` → `job_requests` → the Mac's `trigger-poll.mjs` runs `forge-template.sh <next-unbuilt-language>`).
- Or idle: `forge_engine.idle_templates_enabled` on → the forge builds unbuilt languages when otherwise idle (order in `design-languages.json` = priority).
- **One at a time.** It registers `enabled:false`; review `preview.png`, then approve.

### Review the Brand Lead's design research
`/command/engine → Design research` lists `design_reports` (each with cited `sources[]`). Verify/reject with `setDesignReportStatus()` — verified reports steer the agent's next run. Its `language_id` links to the `design-languages.json` entry to build.

### Fix a template bug
A bug on a live site almost always belongs in **`templates/<id>/`** (fixes all future builds), NOT `sites/<slug>/` (fixes only that one). Shared-component bugs go in `packages/ui/` — but that's the **locked layer**; changes reach a site only on its next build.

## Plugin / new-verticals surface (future)
Shipping templates are **frontend-only** (no auth/backend). `templates/backend-service-business/` is the proof-of-concept full-stack template (Better Auth + Drizzle/Neon + Stripe + Resend + `/admin`) — **not yet forge-wired**. Wiring it in (registry entry + `forge-build.sh` clone/select + per-site env/DB provisioning) is the path to auth/email/multi-tenant tiers (e.g. restaurants with ordering, member sites).

## After changes — keep in sync
- Added/retired a template → update **both** `templates/registry.json` (auto via DB sync) **and** the app mirror `src/lib/forge-templates.ts`, and the brand-lead's `TOOLS.md` template count.
- Touched the forge lifecycle, an env var, a `/command` surface, or a cron → update `docs/FORGE.md` (and `docs/VENUS_UI_MAPPING.md` for nav/tools) in the same change.
- Forge changes commit to the forge repo's working branch, **not pushed** (deployed sites are frozen; changes reach a site on its next build).
