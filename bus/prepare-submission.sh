#!/usr/bin/env bash
# prepare-submission.sh — Prepare a skill/agent/org for community submission with PII scanning
# Usage: prepare-submission.sh <type> <source-path> <name> [--output-dir <dir>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

TYPE="${1:-}"
SOURCE="${2:-}"
NAME="${3:-}"

if [[ -z "$TYPE" || -z "$SOURCE" || -z "$NAME" ]]; then
  echo "Usage: prepare-submission.sh <type> <source-path> <name> [--output-dir <dir>]" >&2
  exit 1
fi

shift 3
exec node "$CLI" bus prepare-submission "$TYPE" "$SOURCE" "$NAME" "$@"
