#!/usr/bin/env bash
# complete-task.sh — wrapper for Node.js CLI
# Usage: complete-task.sh <id> [result_summary]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

ID="${1:-}"
RESULT="${2:-}"

if [[ -z "$ID" ]]; then
  echo "Usage: complete-task.sh <id> [result_summary]" >&2
  exit 1
fi

ARGS=("$ID")
[[ -n "$RESULT" ]] && ARGS+=(--result "$RESULT")

exec node "$CLI" bus complete-task "${ARGS[@]}"
