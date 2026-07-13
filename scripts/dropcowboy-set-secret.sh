#!/usr/bin/env bash
#
# Set the Drop Cowboy API secret (and optionally the recording id) in Vercel WITHOUT
# exposing the value to anyone but you. You paste the secret at a hidden prompt; it is
# streamed straight to Vercel's API over HTTPS and never printed, logged, or passed on
# the command line (so it can't show up in your shell history or `ps`).
#
# Usage:  bash scripts/dropcowboy-set-secret.sh
#
set -euo pipefail

PROJECT_ID="prj_yhuVSXdJGnI1AJ3uzvvsOfSO4Mfa"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Find a Vercel token the same way the rest of the tooling does.
TOKEN="$(grep -hoE 'VERCEL_(API_)?TOKEN=.*' "$HOME/code/nanocrew/.env.local" "$REPO_ROOT/env.local" 2>/dev/null \
         | head -1 | sed -E 's/^[^=]+=//; s/^["'"'"']//; s/["'"'"']$//')"
if [ -z "${TOKEN:-}" ]; then
  echo "❌ Couldn't find a Vercel token (VERCEL_TOKEN / VERCEL_API_TOKEN) in ~/code/nanocrew/.env.local or env.local." >&2
  exit 1
fi

# Upsert one env var across all environments. The value is passed to curl via stdin
# (--data @-), so it never appears in the process list or shell history.
set_env () {
  local key="$1" val="$2"
  KEY="$key" VAL="$val" python3 -c '
import json, os
print(json.dumps({"key": os.environ["KEY"], "value": os.environ["VAL"],
                  "type": "encrypted", "target": ["production", "preview", "development"]}))' \
  | curl -sS -X POST "https://api.vercel.com/v10/projects/$PROJECT_ID/env?upsert=true" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data @- \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("  ✓ set '"$key"'" if not d.get("error") else "  ❌ "+str(d["error"]))'
}

printf "Paste your Drop Cowboy API secret (input hidden), then press Enter:\n> "
read -rs DC_SECRET
echo
if [ -z "${DC_SECRET:-}" ]; then
  echo "  (nothing entered — DROPCOWBOY_SECRET not changed)"
else
  set_env "DROPCOWBOY_SECRET" "$DC_SECRET"
fi
unset DC_SECRET

printf "\nOptional — the TBJ voicemail's recording_id (from Recordings → view). Press Enter to skip:\n> "
read -r DC_REC
if [ -n "${DC_REC:-}" ]; then
  set_env "DROPCOWBOY_RECORDING_ID" "$DC_REC"
fi
unset DC_REC

echo
echo "Done. The new values apply on the next deploy — tell Claude and I'll redeploy + run a test drop."
