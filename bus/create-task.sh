#!/usr/bin/env bash
# create-task.sh — wrapper for Node.js CLI
# Usage: create-task.sh <title> [description] [assignee] [priority] [project] [--needs-approval]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

TITLE="${1:-}"
DESC="${2:-}"
ASSIGNEE="${3:-}"
PRIORITY="${4:-normal}"
PROJECT="${5:-}"

if [[ -z "$TITLE" ]]; then
  echo "Usage: create-task.sh <title> [description] [assignee] [priority] [project] [--needs-approval]" >&2
  exit 1
fi

# Build args
ARGS=("$TITLE")
[[ -n "$DESC" ]] && ARGS+=(--desc "$DESC")
[[ -n "$ASSIGNEE" ]] && ARGS+=(--assignee "$ASSIGNEE")
[[ -n "$PRIORITY" ]] && ARGS+=(--priority "$PRIORITY")
[[ -n "$PROJECT" ]] && ARGS+=(--project "$PROJECT")

# Pass through --needs-approval if present in remaining args
for arg in "${@:6}"; do
  if [[ "$arg" == "--needs-approval" ]]; then
    ARGS+=(--needs-approval)
    break
  fi
done

exec node "$CLI" bus create-task "${ARGS[@]}"
