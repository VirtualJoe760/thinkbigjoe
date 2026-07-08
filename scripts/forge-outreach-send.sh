#!/usr/bin/env bash
# 10am owner-outreach batch for BUILT + marketing-approved sites.
# Reads CRON_SECRET from thinkbigjoe/.env.local, fires the PROD endpoint (Zoho SMTP lives there).
# Wired to launchd: com.thinkbigjoe.outreach (StartCalendarInterval 10:00 local).
set -uo pipefail
ENVF="$HOME/code/thinkbigjoe/.env.local"
CRON=$(grep -E '^CRON_SECRET=' "$ENVF" | head -1 | sed -E 's/^CRON_SECRET=//; s/^"//; s/"$//' | tr -d ' ')
[ -z "$CRON" ] && { echo "$(date) — no CRON_SECRET, abort"; exit 1; }
echo "=== $(date) — firing 10am owner outreach ==="
curl -s -m 90 -X POST "https://thinkbigjoe.com/api/forge/send-outreach" -H "Authorization: Bearer $CRON"
echo ""
