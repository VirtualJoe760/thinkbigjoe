# Windows drip-sender + reply-poster (Playwright)

Sends your **approved** LinkedIn connection requests on a human-paced drip during your
working hours, and posts your **approved** replies — all on this Windows machine (residential
IP, your real logged-in Chrome = safest IP-wise). It drives Chrome with **Playwright** against a
persistent profile (no extension, no Claude). It reads all its rules from **/command/automation**.

```
Task Scheduler (every ~10 min)  →  run-sender.mjs (brain)
   reads config · checks day/hours · paces vs ramp · picks next APPROVED prospect
   → Playwright opens your logged-in Chrome → Connect + note → Send → mark + Telegram
   (auto-pauses automation on any LinkedIn checkpoint)
```

> ⚠️ **This is the unattended automation bot — it carries the most LinkedIn ToS/ban risk.**
> The caps (≤daily ramp), human pacing, paused-skip, and checkpoint-stop are there to protect
> your account, but the residual risk is real. Start with the ramp low.

## 1. Install Playwright-core
Uses your installed Chrome (no big browser download):
```cmd
cd /d F:\web-clients\joseph-sardella\thinkbigjoe\windows-sender
npm install
```

## 2. Log into LinkedIn once (creates the persistent profile)
```cmd
cd /d F:\web-clients\joseph-sardella\thinkbigjoe
node windows-sender\linkedin.mjs --login
```
A Chrome window opens with a fresh automation profile — log into LinkedIn there, then close it.
The session persists in `windows-sender\chrome-profile` and is reused every run. (This profile is
separate from your everyday Chrome so automation never disrupts your normal browsing.)

## 3. DRY RUN first — verify the buttons before anything sends
LinkedIn's page layout shifts, so confirm the selectors find Connect / Add-a-note / Send **without
clicking Send.** Approve a prospect in `/command` first, then:
```cmd
cd /d F:\web-clients\joseph-sardella\thinkbigjoe
set DRY_RUN=1 && node windows-sender\run-sender.mjs
```
It should open the profile and log `DRY RUN ok — DRYRUN ready-to-send` (nothing sent). If it logs
`SKIP no-connect-option` or an error, the selectors need a tweak — send me the log and I'll adjust
`linkedin.mjs`. **Do not schedule live sends until a dry run passes.**

## 4. Schedule (every ~10 min; the runner self-gates on your dashboard hours)
Task Scheduler → Create Task (run only when logged on):
- **Sender:** Trigger: daily, repeat every **10 min**, indefinitely. Action: `…\windows-sender\run-sender.cmd`
- **Reply-poster:** Trigger: daily, repeat every **5 min**. Action: `…\windows-sender\run-replies.cmd`

(No need to limit triggers to 9–5/weekdays — the runner reads your dashboard window and exits
outside it.)

## 5. Go live
1. `/command` → Prospecting → **Approve** the prospects to send to.
2. `/command/automation` → set hours + ramp/goal → flip **ON**.
3. Watch `windows-sender\sender.log` + Telegram.

## Manage
- Pause everything: toggle OFF in `/command/automation` (or disable the Tasks).
- Pause one conversation: a prospect's `paused` flag (skipped).
- Auto-pauses + alerts on a LinkedIn checkpoint — check your account before re-enabling.
- `DRY_RUN=1` anytime to rehearse without sending.
