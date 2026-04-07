#!/usr/bin/env bash
# create-approval.sh — wrapper for Node.js CLI
# Usage: create-approval.sh <title> <category> [context]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

TITLE="${1:-}"
CATEGORY="${2:-other}"
CONTEXT="${3:-}"

if [[ -z "$TITLE" ]]; then
  echo "Usage: create-approval.sh <title> <category> [context]" >&2
  exit 1
fi

ARGS=("$TITLE" "$CATEGORY")
[[ -n "$CONTEXT" ]] && ARGS+=("$CONTEXT")

exec node "$CLI" bus create-approval "${ARGS[@]}"
