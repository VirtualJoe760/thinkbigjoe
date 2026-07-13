#!/usr/bin/env bash
# Fallback sweep for delivery-gated voicemail follow-up texts. Reads CRON_SECRET from
# thinkbigjoe/.env.local, fires the PROD endpoint, which sends the non-VM follow-up text to any
# lead still vm_text_pending ~8+ min after the drop (i.e. no Drop Cowboy delivery webhook arrived).
# Wired to launchd: com.thinkbigjoe.vmtextfallback (StartInterval 300s, ~every 5 min).
set -uo pipefail
ENVF="$HOME/code/thinkbigjoe/.env.local"
CRON=$(grep -E '^CRON_SECRET=' "$ENVF" | head -1 | sed -E 's/^CRON_SECRET=//; s/^"//; s/"$//' | tr -d ' ')
[ -z "$CRON" ] && { echo "$(date) — no CRON_SECRET, abort"; exit 1; }
echo "=== $(date) — firing vm-text fallback sweep ==="
curl -s -m 90 -X POST "https://thinkbigjoe.com/api/leads/vm-text-fallback" -H "Authorization: Bearer $CRON"
echo ""
