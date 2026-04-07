#!/usr/bin/env bash
# hard-restart.sh — Plan a hard restart (fresh session, no --continue)
# Usage: hard-restart.sh [--reason <why>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

exec node "$CLI" bus hard-restart "$@"
