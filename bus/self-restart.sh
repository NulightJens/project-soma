#!/usr/bin/env bash
# self-restart.sh — wrapper for Node.js CLI
# Usage: self-restart.sh [--reason <why>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

exec node "$CLI" bus self-restart "$@"
