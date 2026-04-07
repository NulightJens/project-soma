#!/usr/bin/env bash
# manage-cycle.sh — Manage experiment cycles
# Usage: manage-cycle.sh <action> <agent> [options]
#   create: --cycle <name> --metric <name> --metric-type <quantitative|qualitative>
#           --surface <path> --direction <higher|lower> --window <dur>
#           --measurement "<how>" --loop-interval <dur>
#   modify: --cycle <name> [--window <dur>] [--loop-interval <dur>] [--surface <path>]
#           [--measurement "<how>"] [--enabled <true|false>]
#   remove: --cycle <name>
#   list:   (no extra flags)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

ACTION="${1:-}"
AGENT="${2:-}"

if [[ -z "$ACTION" || -z "$AGENT" ]]; then
  echo "Usage: manage-cycle.sh <create|modify|remove|list> <agent> [--cycle <name>] [--metric <name>] [--metric-type <type>] [--surface <path>] [--direction <higher|lower>] [--window <dur>] [--measurement <how>] [--loop-interval <dur>] [--enabled <true|false>]" >&2
  echo "Actions: create, modify, remove, list" >&2
  exit 1
fi

shift 2
exec node "$CLI" bus manage-cycle "$ACTION" "$AGENT" "$@"
