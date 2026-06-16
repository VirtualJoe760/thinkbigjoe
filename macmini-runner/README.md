# Cowork runner — Mac Mini setup

The Mac Mini is the always-on runner. You text **@thinkbigjoe_alerts_bot** → the
site queues a job → this runner claims it and runs the Cowork playbook against
the LinkedIn-logged-in Chrome on this machine, then pings you the result.

```
Telegram command → webhook → cowork_jobs (Neon) → Mac Mini polls /api/cowork/claim
                                                 → runs `claude -p` (drives LinkedIn)
                                                 → /api/cowork/complete → Telegram you
```

## Prerequisites on the Mini
- **Node 18+** (`node -v`). Find its path: `which node` (often `/opt/homebrew/bin/node` on Apple Silicon, `/usr/local/bin/node` on Intel).
- **Claude Code** installed + signed in (`claude` runs). Find its path: `which claude`.
- **Chrome** signed into Joe's LinkedIn + Sales Navigator, with the **Claude-in-Chrome extension** installed and connected (so `claude -p` can use the browser tools headless).

## 1. Clone the repo
```bash
cd ~/code            # or wherever you keep projects
git clone https://github.com/VirtualJoe760/thinkbigjoe.git
cd thinkbigjoe
pnpm install          # or npm install
```

### Sync your private playbook (optional but recommended)
The `prospecting/` folder (refined humble tone + per-vertical message bank) is
gitignored, so the clone won't include it. Copy it from your Windows machine to
the Mini's repo dir so Cowork uses your exact voice. Without it, the runner
falls back to the tone rules baked into its prompt (still humble/reply-first,
just less tailored). PII (prospect CSVs) never needs to be committed.

## 2. Create `.env.local` (the runner + Claude read DB creds from here)
The runner itself only needs the token; the Claude session needs `DATABASE_URL`
to write prospects. Easiest: link Vercel and pull, then add the token.
```bash
npx vercel link --yes --project thinkbigjoe-cyio --scope joes-projects-e3fd5dcd
npx vercel env pull .env.local              # pulls DATABASE_URL etc.
echo 'COWORK_RUNNER_TOKEN="<paste the runner token>"' >> .env.local
```
The runner token is the value of `COWORK_RUNNER_TOKEN` in Vercel (Joe has it).

## 3. Install the launchd service
```bash
cp macmini-runner/com.thinkbigjoe.cowork.plist ~/Library/LaunchAgents/
```
Edit `~/Library/LaunchAgents/com.thinkbigjoe.cowork.plist` and replace:
- `REPLACE_REPO_DIR` → absolute repo path, e.g. `/Users/joe/code/thinkbigjoe`
- `REPLACE_RUNNER_TOKEN` → the same `COWORK_RUNNER_TOKEN`
- `REPLACE_CLAUDE_BIN` → output of `which claude`
- `REPLACE_HOME` → your home dir, e.g. `/Users/joe`
- the `node` path in `ProgramArguments` → output of `which node`

Then load it:
```bash
launchctl load -w ~/Library/LaunchAgents/com.thinkbigjoe.cowork.plist
tail -f ~/Library/Logs/cowork-runner.out.log     # watch it
```
You should see `[cowork] runner up.` It polls every 2 min for queued jobs.

## 4. Test
From your phone, text the bot: `find 5 insurance leads in California`.
Within ~2 min the Mini claims it, you'll see activity in the log, and when it
finishes you get a Telegram `✅ Job #N done — …`. New prospects appear in
`/command`.

## Modes & safety
- **Auto-send is ON** (`COWORK_AUTOSEND=1` in the plist). The runner may send
  opening LinkedIn connection requests itself, **hard-capped at 20/day**, at
  human pace. Set it to `0` to go draft-first (you approve sends in `/command`).
- It **stops and hands off** the instant anyone replies with a real question or
  starts a conversation — it never auto-replies into a live thread.
- It **stops** on any captcha / 2FA / verification screen and reports it.
- These guardrails live in `prospecting/cowork-loop.md`, which the Claude
  session reads at the start of every job.

## Manage
```bash
launchctl unload ~/Library/LaunchAgents/com.thinkbigjoe.cowork.plist   # stop
launchctl load   -w ~/Library/LaunchAgents/com.thinkbigjoe.cowork.plist # start
```
Cancel a queued job anytime at `/command/jobs`.
