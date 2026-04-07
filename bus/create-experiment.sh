#!/usr/bin/env bash
# create-experiment.sh — Create a new experiment proposal
# Usage: create-experiment.sh <metric_name> "<hypothesis>" [--surface <path>] [--direction higher|lower] [--window <duration>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

METRIC="${1:-}"
HYPOTHESIS="${2:-}"

if [[ -z "$METRIC" || -z "$HYPOTHESIS" ]]; then
  echo "Usage: create-experiment.sh <metric_name> \"<hypothesis>\" [--surface <path>] [--direction higher|lower] [--window <duration>]" >&2
  exit 1
fi

shift 2
exec node "$CLI" bus create-experiment "$METRIC" "$HYPOTHESIS" "$@"
