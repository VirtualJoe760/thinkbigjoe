> ## ⚠️ RETIRED — there is no VPS anymore (and the thing it was replaced by is ALSO retired)
>
> This DigitalOcean Gmail-IMAP sentinel has been decommissioned. It was superseded by a "TBJ
> LinkedIn Inbox Check" cron calling `save_inbound_reply` — **that cron has since been removed
> too** (the LinkedIn/B2B funnel is retired; see [`linkedin-sender/README.md`](../linkedin-sender/README.md)).
> `save_inbound_reply`/`schedule_followup` still exist in `mcp-server/tbj-mcp.mjs` but nothing
> calls them right now — orphaned tools, not active infrastructure. This file's *previous*
> banner claimed the cron replacement was current; it wasn't kept in sync when that, too, was
> retired — a real example of exactly the doc-drift AGENTS.md's docs protocol exists to prevent.
>
> **For the current architecture, read [`docs/FORGE.md`](../docs/FORGE.md)** (the actual
> business/pipeline now) and [`docs/README.md`](../docs/README.md) (the doc index).
>
> Everything below is kept for historical reference only.

---

# Reply Sentinel — DigitalOcean setup

A tiny always-on service that watches your Gmail for the emails **LinkedIn already
sends you** ("X accepted your invitation", "X sent you a message") and pings your
Telegram bot. **It never logs into LinkedIn** — so there's no datacenter-IP ban
risk and it's fully within LinkedIn's ToS. Reuses `@thinkbigjoe_alerts_bot`.

```
LinkedIn → emails your inbox → droplet (IMAP, 24/7) → detects accept/reply → Telegram you
```

The risky part (sending connects/messages) stays on your residential machine. This
box only does the safe, read-only watching.

## 1. Get a Gmail App Password (~2 min)
LinkedIn notifications land in `josephsardella@gmail.com`. The sentinel reads them
via IMAP using an **App Password** (a 16-char token, separate from your real
password; revocable anytime — the sentinel never sees your actual password).
1. Google Account → **Security** → 2-Step Verification must be ON.
2. Search "App passwords" (myaccount.google.com/apppasswords) → create one named
   "Reply Sentinel" → copy the 16-char code.
> If your LinkedIn emails are filtered out of the inbox, also note that; you'll set
> `MAILBOX="[Gmail]/All Mail"` below.

## 2. Create the droplet
DigitalOcean → Create → Droplet → **Ubuntu 24.04, Basic, $4–6/mo (512MB–1GB)** is
plenty. Add your SSH key. Once it's up, SSH in: `ssh root@<droplet-ip>`.

```bash
# install Node 20 + git
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# get the code
git clone https://github.com/VirtualJoe760/thinkbigjoe.git
cd thinkbigjoe/vps-sentinel
npm install            # installs imapflow only
```

## 3. Configure
```bash
cp .env.example .env
nano .env              # fill GMAIL_USER, GMAIL_APP_PASSWORD, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
```
The Telegram values are the same ones in your site's Vercel env / local `.env.local`.

**Mailbox = the `LinkedIn` label.** A Gmail filter routes all `linkedin.com` mail to a
`LinkedIn` label and skips the inbox, so the Sentinel watches that label (`MAILBOX="LinkedIn"`,
already set in `.env.example`) — verified IMAP-visible. If it ever can't find it, check
Gmail → Settings → Labels → `LinkedIn` → "Show in IMAP" is on.

## 4. Run it as a service
```bash
sudo cp cowork-sentinel.service /etc/systemd/system/
sudo nano /etc/systemd/system/cowork-sentinel.service   # replace REPLACE_SENTINEL_DIR + REPLACE_USER
#   REPLACE_SENTINEL_DIR → /root/thinkbigjoe/vps-sentinel   (output of `pwd`)
#   REPLACE_USER → root
sudo systemctl daemon-reload
sudo systemctl enable --now cowork-sentinel
journalctl -u cowork-sentinel -f      # watch it; you should get a "👀 Reply Sentinel online" Telegram
```

## 5. Test
Have someone accept a pending invite (or send you a LinkedIn message). Within ~1 min
you get a Telegram ping. Done — it now runs forever, surviving reboots.

## Manage
```bash
sudo systemctl restart cowork-sentinel   # after editing .env
sudo systemctl stop cowork-sentinel
journalctl -u cowork-sentinel -n 50      # recent logs
```

## Notes & next
- **Baseline:** on first run it marks "now" so it won't replay old emails — only new
  ones alert you.
- **Latency** is the poll interval (default 60s) — effectively real-time for this.
- **Same droplet can later host the web-sourced lead finder** (the safe, no-LinkedIn
  lane that fills your prospect queue 24/7). Ask and I'll add it here.
- If LinkedIn message emails don't include the sender cleanly, the alert still fires
  ("Someone replied on LinkedIn") — open LinkedIn to see who.
