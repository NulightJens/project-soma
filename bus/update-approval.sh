#!/usr/bin/env bash
# update-approval.sh — wrapper for Node.js CLI
# Usage: update-approval.sh <id> <decision> [note]
# decision: approved | rejected
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

ID="${1:-}"
DECISION="${2:-}"
NOTE="${3:-}"

if [[ -z "$ID" || -z "$DECISION" ]]; then
  echo "Usage: update-approval.sh <id> <decision> [note]" >&2
  exit 1
fi

ARGS=("$ID" "$DECISION")
[[ -n "$NOTE" ]] && ARGS+=("$NOTE")

exec node "$CLI" bus update-approval "${ARGS[@]}"
