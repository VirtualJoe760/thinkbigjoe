#!/usr/bin/env bash
# Timed sender for the voicemail follow-up text. Reads CRON_SECRET from thinkbigjoe/.env.local, fires
# the PROD endpoint, which sends the follow-up text ~60s after each drop (so the voicemail lands
# first). Wired to launchd: com.thinkbigjoe.vmtextsend (StartInterval 60s).
set -uo pipefail
ENVF="$HOME/code/thinkbigjoe/.env.local"
CRON=$(grep -E '^CRON_SECRET=' "$ENVF" | head -1 | sed -E 's/^CRON_SECRET=//; s/^"//; s/"$//' | tr -d ' ')
[ -z "$CRON" ] && { echo "$(date) — no CRON_SECRET, abort"; exit 1; }
curl -s -m 60 -X POST "https://thinkbigjoe.com/api/leads/vm-text-send" -H "Authorization: Bearer $CRON"
echo ""
