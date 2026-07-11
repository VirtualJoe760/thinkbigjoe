#!/usr/bin/env bash
# First-touch SMS outreach drip. Reads CRON_SECRET from thinkbigjoe/.env.local, fires the PROD
# endpoint (Twilio creds live there). The route gates to weekday 9am–6pm PT and drips a small
# jittered number per run, capped by SMS_OUTREACH_DAILY_GOAL — so texts trickle like a real person.
# Wired to launchd: com.thinkbigjoe.smsoutreach (StartInterval 1200s, ~every 20 min).
set -uo pipefail
ENVF="$HOME/code/thinkbigjoe/.env.local"
CRON=$(grep -E '^CRON_SECRET=' "$ENVF" | head -1 | sed -E 's/^CRON_SECRET=//; s/^"//; s/"$//' | tr -d ' ')
[ -z "$CRON" ] && { echo "$(date) — no CRON_SECRET, abort"; exit 1; }
echo "=== $(date) — firing SMS first-touch outreach ==="
curl -s -m 90 -X POST "https://thinkbigjoe.com/api/forge/send-sms-outreach" -H "Authorization: Bearer $CRON"
echo ""
