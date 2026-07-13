#!/usr/bin/env bash
# Voicemail-first outreach: the first touch for a new lead is a ringless voicemail drop; the follow-up
# text auto-sends ~60s later (vmtextsend). Reads CRON_SECRET from thinkbigjoe/.env.local, fires the
# PROD endpoint, which gates to weekday 9am–6pm PT and drips a small jittered count per run capped by
# VOICEMAIL_OUTREACH_DAILY_GOAL. Wired to launchd: com.thinkbigjoe.voicemailoutreach (~every 20 min).
set -uo pipefail
ENVF="$HOME/code/thinkbigjoe/.env.local"
CRON=$(grep -E '^CRON_SECRET=' "$ENVF" | head -1 | sed -E 's/^CRON_SECRET=//; s/^"//; s/"$//' | tr -d ' ')
[ -z "$CRON" ] && { echo "$(date) — no CRON_SECRET, abort"; exit 1; }
echo "=== $(date) — firing voicemail-first outreach ==="
curl -s -m 90 -X POST "https://thinkbigjoe.com/api/forge/send-voicemail-outreach" -H "Authorization: Bearer $CRON"
echo ""
