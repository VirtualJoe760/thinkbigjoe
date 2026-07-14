#!/usr/bin/env bash
# Sync TBJ leads into Joe's Google Contacts ("TBJ Leads" group). Reads CRON_SECRET from
# thinkbigjoe/.env.local, fires the PROD endpoint. No-ops until Joe connects his Google (with the
# Contacts scope) on /portal/calendar. Wired to launchd: com.thinkbigjoe.gcontacts (~every 2h).
set -uo pipefail
ENVF="$HOME/code/thinkbigjoe/.env.local"
CRON=$(grep -E '^CRON_SECRET=' "$ENVF" | head -1 | sed -E 's/^CRON_SECRET=//; s/^"//; s/"$//' | tr -d ' ')
[ -z "$CRON" ] && { echo "$(date) — no CRON_SECRET, abort"; exit 1; }
curl -s -m 110 -X POST "https://thinkbigjoe.com/api/google/sync-tbj-contacts" -H "Authorization: Bearer $CRON"
echo ""
