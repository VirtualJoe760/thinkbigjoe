# Windows drip-sender setup

Sends your **approved** LinkedIn connection requests on a human-paced drip during your
working hours — on this Windows machine (residential IP, your real session = safe). It reads
all its rules from the dashboard at **/command/automation**; you never edit code to tune it.

```
Task Scheduler (every ~10 min)  →  run-sender.mjs (the brain)
   reads /command/automation config · checks day/hours · paces vs ramp target
   → when it's time, hands ONE invite to headless Claude → clicks it in your browser
   → marks it sent · pings Telegram · stops + alerts on any LinkedIn checkpoint
```

## How sending stays safe
- **Only human-approved prospects go out.** It sends from `outreach.status = 'approved'` — so you
  approve a batch in `/command` (Prospecting → Approve), and the sender drips them over days.
- **Hard daily cap + ramp** from the dashboard (start ~10/day → 30). **Paused** prospects are skipped.
- **Even drip + jitter** across your hours — never bursts.
- **Stops itself** on any captcha/verification and Telegrams you (then you re-enable in the dashboard).

## Prerequisites
- This repo cloned here with `node_modules` installed (`pnpm install` already done).
- **Claude Code** installed + signed in (`claude` on PATH).
- **Chrome** logged into your LinkedIn, with the **Claude-in-Chrome extension** connected (that's
  how the headless `claude` session clicks the invite).
- `.env.local` present in the repo root (has `DATABASE_URL` + `TELEGRAM_*`).

## 1. Confirm it runs
```cmd
cd /d F:\web-clients\joseph-sardella\thinkbigjoe
node windows-sender\run-sender.mjs
```
With automation OFF it prints `disabled — exit`. That's correct — turn it on in the dashboard
when you're ready.

## 2. Schedule it (every 10 min, all day — the runner self-gates)
Open **Task Scheduler → Create Task**:
- **General:** name `ThinkBigJoe Sender`; "Run only when user is logged on" (it needs your browser session).
- **Triggers:** New → "On a schedule" → Daily → **Repeat task every 10 minutes** for a duration of "Indefinitely".
- **Actions:** New → Start a program → Program: `F:\web-clients\joseph-sardella\thinkbigjoe\windows-sender\run-sender.cmd`
- **Conditions:** uncheck "Start only if on AC power" if it's a desktop.
- Save.

(You don't need to restrict the trigger to 9–5 / weekdays — the runner reads your dashboard hours
and exits quietly outside them. One schedule, fully controlled from `/command/automation`.)

## 3. Go live
1. In `/command` → Prospecting, **Approve** the prospects you want sent.
2. In `/command/automation`, set hours + daily goal/ramp, then flip **Automated prospecting ON**.
3. Watch `windows-sender\sender.log` and your Telegram — you'll get a ✅ ping per send.

## Manage
- Pause everything instantly: toggle OFF in `/command/automation` (or disable the Task).
- Pause one conversation: the `paused` flag on a prospect (skipped by the sender).
- It auto-pauses + alerts on a LinkedIn checkpoint — if that happens, check your account before re-enabling.
