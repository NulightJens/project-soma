#!/usr/bin/env bash
# Check Claude Max API usage via the OAuth usage endpoint.
# Reads the OAuth token from macOS Keychain, calls the undocumented
# api.anthropic.com/api/oauth/usage endpoint, and returns utilization data.
#
# Usage:
#   cortextos bus check-usage-api [--warn-7day N] [--warn-5h N] [--chat-id ID]
#
# Options:
#   --warn-7day N   Warn (via Telegram) if 7-day utilization >= N% (default: 80)
#   --warn-5h N     Warn (via Telegram) if 5-hour utilization >= N% (default: 90)
#   --chat-id ID    Telegram chat ID to send alerts to (uses CTX_TELEGRAM_CHAT_ID if omitted)
#   --force         Bypass the 3-minute result cache
#
# Output: JSON with utilization fields, or exits 1 on error.
#
# Cache: results are cached for 3 minutes at $CTX_ROOT/state/usage/api-cache.json
# to avoid hitting the hard rate limit (~5 requests per token before 429).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_ctx-env.sh"

# ── Defaults ────────────────────────────────────────────────────────────────
WARN_7DAY=80
WARN_5H=90
CHAT_ID="${CTX_TELEGRAM_CHAT_ID:-}"
FORCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --warn-7day) WARN_7DAY="$2"; shift 2 ;;
    --warn-5h)   WARN_5H="$2";   shift 2 ;;
    --chat-id)   CHAT_ID="$2";   shift 2 ;;
    --force)     FORCE=true;     shift   ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Source agent .env for CHAT_ID if not set ────────────────────────────────
if [[ -z "${CHAT_ID}" ]]; then
  ctx_source_env
  CHAT_ID="${CTX_TELEGRAM_CHAT_ID:-}"
fi

# ── Cache check ─────────────────────────────────────────────────────────────
CACHE_DIR="${CTX_ROOT}/state/usage"
CACHE_FILE="${CACHE_DIR}/api-cache.json"
CACHE_TTL=180  # 3 minutes

mkdir -p "$CACHE_DIR"

if [[ "$FORCE" == "false" && -f "$CACHE_FILE" ]]; then
  cache_age=$(( $(date +%s) - $(date -r "$CACHE_FILE" +%s 2>/dev/null || echo 0) ))
  if [[ $cache_age -lt $CACHE_TTL ]]; then
    cat "$CACHE_FILE"
    exit 0
  fi
fi

# ── Read OAuth token from Keychain ──────────────────────────────────────────
if ! command -v security &>/dev/null; then
  echo '{"error":"macOS Keychain (security) not available"}' >&2
  exit 1
fi

RAW_CREDS=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || true)
if [[ -z "$RAW_CREDS" ]]; then
  echo '{"error":"Claude Code credentials not found in Keychain"}' >&2
  exit 1
fi

ACCESS_TOKEN=$(echo "$RAW_CREDS" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d['claudeAiOauth']['accessToken'])
except Exception as e:
    sys.stderr.write(str(e) + '\n')
    sys.exit(1)
" 2>/dev/null || true)

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo '{"error":"Could not parse access token from Keychain credentials"}' >&2
  exit 1
fi

# ── Call usage API ───────────────────────────────────────────────────────────
RESPONSE=$(curl -sf "https://api.anthropic.com/api/oauth/usage" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "anthropic-beta: oauth-2025-04-20" \
  --max-time 10 2>/dev/null || true)

if [[ -z "$RESPONSE" ]]; then
  echo '{"error":"Usage API request failed or timed out"}' >&2
  exit 1
fi

# Validate it's JSON with expected fields
if ! echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'five_hour' in d or 'seven_day' in d" 2>/dev/null; then
  echo "{\"error\":\"Unexpected API response\",\"raw\":$(echo "$RESPONSE" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')}" >&2
  exit 1
fi

# Cache the result
echo "$RESPONSE" > "$CACHE_FILE"

# ── Threshold checks + Telegram alerts ──────────────────────────────────────
ALERT_SENT=false

if [[ -n "$CHAT_ID" ]]; then
  FIVE_H=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); v=d.get('five_hour',{}).get('utilization'); print(v if v is not None else -1)" 2>/dev/null || echo -1)
  SEVEN_D=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); v=d.get('seven_day',{}).get('utilization'); print(v if v is not None else -1)" 2>/dev/null || echo -1)
  SEVEN_D_RESET=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('seven_day',{}).get('resets_at','unknown'))" 2>/dev/null || echo "unknown")
  FIVE_H_RESET=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('five_hour',{}).get('resets_at','unknown'))" 2>/dev/null || echo "unknown")

  # 7-day critical threshold
  if python3 -c "import sys; v=float('${SEVEN_D}'); sys.exit(0 if v >= ${WARN_7DAY} else 1)" 2>/dev/null; then
    SEND_MSG="CODE RED: Claude Max 7-day usage at ${SEVEN_D}%. Resets: ${SEVEN_D_RESET}. Agents will hit hard limit soon. Action needed: reduce agent frequency or pause non-critical crons."
    # Use send-telegram if available
    if [[ -f "$SCRIPT_DIR/send-telegram.sh" ]]; then
      bash "$SCRIPT_DIR/send-telegram.sh" "$CHAT_ID" "$SEND_MSG" 2>/dev/null || true
    fi
    ALERT_SENT=true
    echo "$SEND_MSG" >&2
  fi

  # 5-hour warning threshold
  if python3 -c "import sys; v=float('${FIVE_H}'); sys.exit(0 if v >= ${WARN_5H} else 1)" 2>/dev/null; then
    SEND_MSG="Warning: Claude Max 5-hour window at ${FIVE_H}%. Resets: ${FIVE_H_RESET}."
    if [[ -f "$SCRIPT_DIR/send-telegram.sh" ]]; then
      bash "$SCRIPT_DIR/send-telegram.sh" "$CHAT_ID" "$SEND_MSG" 2>/dev/null || true
    fi
    echo "$SEND_MSG" >&2
  fi
fi

# ── Output ───────────────────────────────────────────────────────────────────
echo "$RESPONSE"
