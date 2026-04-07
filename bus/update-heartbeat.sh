#!/usr/bin/env bash
# update-heartbeat.sh — wrapper for Node.js CLI
# Usage: update-heartbeat.sh <status> [--task <desc>] [--timezone <tz>] [--interval <i>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

STATUS="${1:-idle}"
shift || true

exec node "$CLI" bus update-heartbeat "$STATUS" "$@"
