#!/usr/bin/env bash
# run-experiment.sh — Start running a proposed experiment
# Usage: run-experiment.sh <id> [description]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

ID="${1:-}"
if [[ -z "$ID" ]]; then
  echo "Usage: run-experiment.sh <id> [description]" >&2
  exit 1
fi

shift
exec node "$CLI" bus run-experiment "$ID" "$@"
