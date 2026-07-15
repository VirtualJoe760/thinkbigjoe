#!/usr/bin/env bash
# Paced newsletter send tick — drains a batch of the newsletter_sends queue each run.
# Reads CRON_SECRET from thinkbigjoe/.env.local, fires the PROD endpoint (SES lives there once creds
# are set; falls back to Zoho until then). Resumable: each run marks the recipients it sends.
# Wired to launchd: com.thinkbigjoe.newslettersend (StartInterval 120s). See docs/EMAIL_SCALE.md.
set -uo pipefail
ENVF="$HOME/code/thinkbigjoe/.env.local"
CRON=$(grep -E '^CRON_SECRET=' "$ENVF" | head -1 | sed -E 's/^CRON_SECRET=//; s/^"//; s/"$//' | tr -d ' ')
[ -z "$CRON" ] && { echo "$(date) — no CRON_SECRET, abort"; exit 1; }
curl -s -m 110 -X POST "https://thinkbigjoe.com/api/newsletter/send-batch" -H "Authorization: Bearer $CRON"
echo ""
