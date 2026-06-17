# Brief for Claude on the Mac Mini — Cowork Runner setup & operation

You are Claude Code running on Joe's **always-on Mac Mini**. This machine is the
**standing runner** for ThinkBigJoe's prospecting automation: it stays logged
into LinkedIn + Sales Navigator and runs jobs that Joe queues by texting a
Telegram bot. Your task right now is to **finish setup, verify it works, and get
the runner live.** Then, when jobs run, you execute the prospecting playbook.

Work step by step. Run commands, read output, fix problems, and tell Joe what
you find. Don't assume — verify each thing.

---

## What's already done (Joe did this)
- Repo cloned to this machine (you're in it). Confirm with `git remote -v` →
  should be `github.com/VirtualJoe760/thinkbigjoe`, branch `main`.
- `.env.local` copied into the repo root (has `DATABASE_URL` + `COWORK_RUNNER_TOKEN`).
- `prospecting/` folder copied into the repo root (the private playbook + tone).
- `pnpm install` run.

## The architecture (how it all connects)
```
Joe texts @thinkbigjoe_alerts_bot → webhook queues a job in Neon (cowork_jobs)
→ THIS machine polls https://thinkbigjoe.com/api/cowork/claim every 2 min
→ claims the oldest job, runs `claude -p` (you) to do the work in Chrome
→ posts the result to /api/cowork/complete → Joe gets a Telegram ping
```
The poller is `macmini-runner/run-cowork.mjs`, kept alive by a launchd service.

---

## HARD rules (never break these)
1. **≤ 20 LinkedIn connection requests per day**, total, across all jobs. Before
   sending, count outreach rows marked `sent` today and stay under 20.
2. **Human pace** — randomized gaps, never burst. You are not a scraper.
3. **Stop on reply.** The instant anyone replies with a real question or starts a
   conversation, do NOT respond — pause that thread and surface it to Joe.
4. **Stop on any captcha / 2FA / verification / unexpected screen** — report it,
   never try to bypass bot-detection.
5. **Tone:** humble, grateful, curious, reply-first. Never pushy or pitchy. Read
   `prospecting/cowork-loop.md`, `prospecting/per-lead-routine.md`, and
   `prospecting/outreach-templates.md` and follow them exactly.

---

## Setup steps (do these now, in order)

### 1. Verify prerequisites
```bash
node -v            # need 18+
which node         # note this path
which claude       # note this path; Claude Code must be installed + signed in
echo "$HOME"       # note your home dir
pwd                # note the repo dir (should end in /thinkbigjoe)
```
Report any that are missing.

### 2. Confirm the secrets + playbook are present
```bash
grep -c DATABASE_URL .env.local          # expect >= 1
grep -c COWORK_RUNNER_TOKEN .env.local   # expect 1
ls prospecting/cowork-loop.md            # expect it to exist
```
If `prospecting/` or `.env.local` is missing, stop and tell Joe to PairDrop it.

### 3. Confirm Chrome can be driven (the critical dependency)
The runner drives LinkedIn through the **Claude-in-Chrome extension**. Verify YOU
(this Claude session) can control Chrome: try listing tabs / reading the current
page. Then confirm Chrome is **logged into Joe's LinkedIn** (open linkedin.com,
check it's his account, and that Sales Navigator is accessible).
- If you CAN control Chrome + LinkedIn is logged in → great, full LinkedIn mode works.
- If you CANNOT control Chrome headlessly → tell Joe. `find_leads` jobs can still
  run via public-web research (no browser needed), but LinkedIn auto-send is
  blocked until the extension connection is sorted. Don't fake it.

### 4. Install + configure the launchd service
```bash
cp macmini-runner/com.thinkbigjoe.cowork.plist ~/Library/LaunchAgents/
```
Now edit `~/Library/LaunchAgents/com.thinkbigjoe.cowork.plist` and replace every
`REPLACE_*` placeholder using the real values you gathered:
- `REPLACE_REPO_DIR` → the repo path from `pwd` (e.g. `/Users/joe/code/thinkbigjoe`)
- `REPLACE_RUNNER_TOKEN` → run `grep COWORK_RUNNER_TOKEN .env.local` and paste the
  value (between the quotes). **Do not print this token into any file you might commit.**
- `REPLACE_CLAUDE_BIN` → the `which claude` path
- `REPLACE_HOME` → your `$HOME`
- the `node` path in `ProgramArguments` → the `which node` path

Leave `COWORK_AUTOSEND` = `1` (Joe wants full auto-send) unless he says otherwise.

### 5. Load it and confirm it's alive
```bash
launchctl load -w ~/Library/LaunchAgents/com.thinkbigjoe.cowork.plist
sleep 3
tail -n 20 ~/Library/Logs/cowork-runner.out.log
```
You should see a line like `[cowork] runner up. site=https://thinkbigjoe.com
autosend=on poll=120000ms`. If it crash-loops, check `cowork-runner.err.log`,
fix the cause (usually a wrong path in the plist), then:
```bash
launchctl unload ~/Library/LaunchAgents/com.thinkbigjoe.cowork.plist
launchctl load -w ~/Library/LaunchAgents/com.thinkbigjoe.cowork.plist
```

### 6. End-to-end test
Tell Joe to text the bot: `find 5 insurance leads in California` (or there may
already be a queued job #1). Within ~2 min the runner should claim it — watch:
```bash
tail -f ~/Library/Logs/cowork-runner.out.log
```
You'll see `claimed job #N`, then a `claude -p` session does the work, then
`job #N done`. Joe gets a Telegram `✅ Job #N done — …`. New prospects appear at
thinkbigjoe.com/command.

---

## When a job runs (what you do inside each `claude -p`)
The runner hands you the job. Your steps:
1. Read `prospecting/cowork-loop.md` + `per-lead-routine.md` + `outreach-templates.md`.
2. **Check the LinkedIn inbox first.** Any new reply with a question / real
   conversation → stop that thread, surface to Joe, don't proceed on it.
3. **find_leads:** source matching owners/principals for the vertical + location
   (Sales Nav recipe in `prospecting/`, or public web). For each: recon → fit
   score → draft a humble connection note. Insert NEW rows into the `prospects`
   and `outreach` tables (status `draft`) using `DATABASE_URL` from `.env.local`.
   Skip anyone already in the DB. In auto-send mode, send openers to fresh
   qualifieds within the 20/day cap.
4. **start_prospecting:** send the queued openers for already-qualified prospects.
5. End by printing ONE final line: `SUMMARY: <one sentence of what happened>` —
   that line is what Joe sees on Telegram.

---

## Managing the service later
```bash
launchctl unload ~/Library/LaunchAgents/com.thinkbigjoe.cowork.plist   # pause
launchctl load   -w ~/Library/LaunchAgents/com.thinkbigjoe.cowork.plist # resume
tail -f ~/Library/Logs/cowork-runner.out.log                            # watch
```
Joe can cancel any queued job at thinkbigjoe.com/command/jobs.

## If something's wrong, say so
If Chrome can't be driven, if LinkedIn isn't logged in, if a path is wrong, or if
anything looks risky for Joe's account — **stop and tell him plainly**. Don't
push connection requests if you're unsure. Getting this safe matters more than
getting it fast.
