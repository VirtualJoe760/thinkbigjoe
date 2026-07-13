#!/usr/bin/env bash
# Call-back reminders. Reads CRON_SECRET from thinkbigjoe/env.local, fires the PROD endpoint,
# which Telegrams Joe for any lead whose scheduled call-back time has arrived (once per callback).
# Wired to launchd: com.thinkbigjoe.callbackreminders (StartInterval 1800s, ~every 30 min).
set -uo pipefail
ENVF="$HOME/code/thinkbigjoe/.env.local"
CRON=$(grep -E '^CRON_SECRET=' "$ENVF" | head -1 | sed -E 's/^CRON_SECRET=//; s/^"//; s/"$//' | tr -d ' ')
[ -z "$CRON" ] && { echo "$(date) — no CRON_SECRET, abort"; exit 1; }
echo "=== $(date) — firing call-back reminders ==="
curl -s -m 90 -X POST "https://thinkbigjoe.com/api/leads/callback-reminders" -H "Authorization: Bearer $CRON"
echo ""
