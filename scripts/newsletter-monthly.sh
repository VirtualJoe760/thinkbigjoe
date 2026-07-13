#!/usr/bin/env bash
# Monthly customer-newsletter engine. Reads CRON_SECRET from thinkbigjoe/.env.local, fires the PROD
# endpoint hourly; the route gates on the Pacific calendar — drafts before the 15th (emails clients to
# review), auto-sends on the 15th at noon PT. Idempotent. Wired to launchd: com.thinkbigjoe.newsletter.
set -uo pipefail
ENVF="$HOME/code/thinkbigjoe/.env.local"
CRON=$(grep -E '^CRON_SECRET=' "$ENVF" | head -1 | sed -E 's/^CRON_SECRET=//; s/^"//; s/"$//' | tr -d ' ')
[ -z "$CRON" ] && { echo "$(date) — no CRON_SECRET, abort"; exit 1; }
curl -s -m 280 -X POST "https://thinkbigjoe.com/api/newsletter/monthly" -H "Authorization: Bearer $CRON"
echo ""
