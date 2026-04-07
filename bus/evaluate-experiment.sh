#!/usr/bin/env bash
# evaluate-experiment.sh — Evaluate a running experiment with a measured value
# Usage: evaluate-experiment.sh <id> <value> [--score <n>] [--justification <text>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

ID="${1:-}"
VALUE="${2:-}"

if [[ -z "$ID" || -z "$VALUE" ]]; then
  echo "Usage: evaluate-experiment.sh <id> <value> [--score <n>] [--justification <text>]" >&2
  exit 1
fi

shift 2
exec node "$CLI" bus evaluate-experiment "$ID" "$VALUE" "$@"
