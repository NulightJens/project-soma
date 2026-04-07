#!/usr/bin/env bash
# log-event.sh — wrapper for Node.js CLI
# Usage: log-event.sh <category> <event> <severity> [metadata_json]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

CATEGORY="${1:-action}"
EVENT="${2:-}"
SEVERITY="${3:-info}"
META="${4:-{}}"

if [[ -z "$EVENT" ]]; then
  echo "Usage: log-event.sh <category> <event> <severity> [metadata_json]" >&2
  exit 1
fi

exec node "$CLI" bus log-event "$CATEGORY" "$EVENT" "$SEVERITY" --meta "$META"
