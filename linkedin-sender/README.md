> ## ⚠️ RETIRED — the LinkedIn/B2B funnel is not the current business
>
> ThinkBigJoe's focus shifted to **local-service webdev via the forge** (see
> [`docs/FORGE.md`](../docs/FORGE.md)) — building and selling websites to owner-operated local
> trades (HVAC, plumbing, roofing, etc.), not the insurance/mortgage/wealth/law B2B outreach this
> sender was built for (2026-07-06, per Joe).
>
> **This code is NOT deleted and its GitHub Actions workflow (`linkedin-sender.yml`) is not
> disabled** — it will still run every ~10 min if `/command/automation` is toggled on and there
> are approved LinkedIn prospects queued. Treat it as dormant infrastructure for a demoted
> secondary channel, not the plan. If you're reading this because a LinkedIn message went out
> unexpectedly, check `/command/automation`'s toggle first.
>
> **For the current architecture, read [`docs/FORGE.md`](../docs/FORGE.md)** (the actual pipeline)
> and [`docs/README.md`](../docs/README.md) (the doc index).
>
> Everything below is kept for historical/setup reference only.

---

# LinkedIn sender — cloud (Browserbase + Playwright)

Sends your **approved** LinkedIn connection requests on a human-paced drip during your working
hours, and posts your **approved** replies — running in the **cloud** (Browserbase), so nothing
pops up on your machine and it needs no always-on PC. Login is carried by a persistent
**Browserbase Context**; traffic exits a **residential proxy** pinned to your region. All rules
come from **/command/automation**.

> ⚠️ **This is the unattended automation bot — it carries the most LinkedIn ToS/ban risk.**
> Driving a personal LinkedIn account with automation can get it restricted. The caps (daily
> ramp), human pacing, paused-skip, and checkpoint-auto-stop reduce risk but don't remove it.
> Keep the ramp low; a residential proxy geo-matched to where you normally log in matters.

```
GitHub Actions cron (every ~10 min)  →  run-sender.mjs (brain)
  reads config · checks day/hours · paces vs ramp · picks next APPROVED prospect
  → Browserbase cloud Chromium (your login via Context, residential proxy)
  → Connect + note → Send → mark + Telegram      (auto-pauses on any checkpoint)
```

This supersedes `../windows-sender/` (local Chrome). Same brain + send logic; only the browser
is now cloud (`browserbase.mjs`).

## 1. Get Browserbase keys
Sign up at browserbase.com → copy your **API key** and **Project ID**. Add to repo root `.env.local`:
```
BROWSERBASE_API_KEY=bb_live_xxx
BROWSERBASE_PROJECT_ID=xxxxxxxx-xxxx-xxxx
# residential proxy geo (match where you normally sign in):
BROWSERBASE_PROXY_COUNTRY=US
BROWSERBASE_PROXY_STATE=CA
# BROWSERBASE_PROXY=0   # uncomment to disable the proxy (not recommended for LinkedIn)
```
(`DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` are already in `.env.local`.)

```bash
cd linkedin-sender && npm install
```

## 2. Log into LinkedIn once (seeds the Context)
```bash
node seed-auth.mjs
```
It prints a **live-view URL**. Open it, sign into LinkedIn (handle 2FA), land on the feed, then
press Ctrl+C. If it printed a new `BROWSERBASE_CONTEXT_ID=...`, paste that into `.env.local`.
Your login now persists in the cloud — no re-login, no picker.

## 3. DRY RUN — verify the buttons before anything sends
Approve a prospect in `/command` first, then:
```bash
npm run dry      # = DRY_RUN=1 node run-sender.mjs
```
Expect `DRY RUN ok — DRYRUN ready-to-send` (nothing sent). If you see `SKIP no-connect-option`
or an error, the LinkedIn selectors need a tweak — send me the log and I'll adjust `linkedin.mjs`.
**Do not schedule live sends until a dry run passes.**

## 4. Schedule it (machine-free)
A workflow is already in `.github/workflows/linkedin-sender.yml`. Add these **GitHub repo
secrets** (Settings → Secrets and variables → Actions): `BROWSERBASE_API_KEY`,
`BROWSERBASE_PROJECT_ID`, `BROWSERBASE_CONTEXT_ID`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, and optionally `BROWSERBASE_PROXY_COUNTRY/STATE/CITY`. It runs every ~10 min
and self-exits outside your hours. Use **Run workflow** (Actions tab) for a manual dry run.
*(Alternatives: Vercel Cron → an API route, or `node run-sender.mjs` from any cron — same script.)*

## 5. Go live
1. `/command` → Prospecting → **Approve** the prospects to send to.
2. `/command/automation` → set hours + ramp/goal → flip **ON**.
3. Watch Telegram + the Actions run logs.

## Manage
- Pause everything: toggle OFF in `/command/automation`.
- Pause one conversation: set that prospect's `paused` flag.
- Auto-pauses + alerts on a LinkedIn checkpoint — check your account before re-enabling.
- `DRY_RUN=1` anytime to rehearse without sending.

## Cost (plan for it)
Per Browserbase session-minute + proxy GB ($8/GB residential). A drip of ~20–30 short sessions/day
is low; watch the dashboard the first week.
