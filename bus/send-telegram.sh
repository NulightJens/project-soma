#!/usr/bin/env bash
# send-telegram.sh — wrapper for Node.js CLI
# Usage: send-telegram.sh <chat_id> <message> [--image /path/to/image]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

exec node "$CLI" bus send-telegram "$@"
