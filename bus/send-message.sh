#!/usr/bin/env bash
# send-message.sh — wrapper for Node.js CLI
# Usage: send-message.sh <to> <priority> <text> [reply_to_id]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

TO="${1:-}"
PRIORITY="${2:-normal}"
TEXT="${3:-}"
REPLY_TO="${4:-}"

if [[ -z "$TO" || -z "$TEXT" ]]; then
  echo "Usage: send-message.sh <to> <priority> <text> [reply_to_id]" >&2
  exit 1
fi

ARGS=("$TO" "$PRIORITY" "$TEXT")
[[ -n "$REPLY_TO" ]] && ARGS+=(--reply-to "$REPLY_TO")

exec node "$CLI" bus send-message "${ARGS[@]}"
