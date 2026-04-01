#!/usr/bin/env bash
# auto-commit.sh — wrapper for Node.js CLI
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

exec node "$CLI" bus auto-commit "$@"
