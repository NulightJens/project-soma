#!/usr/bin/env bash
# ack-inbox.sh — wrapper for Node.js CLI
# Usage: ack-inbox.sh <message_id>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

ID="${1:-}"

if [[ -z "$ID" ]]; then
  echo "Usage: ack-inbox.sh <message_id>" >&2
  exit 1
fi

exec node "$CLI" bus ack-inbox "$ID"
