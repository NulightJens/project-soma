#!/usr/bin/env bash
# archive-tasks.sh — Archive completed tasks older than 7 days
# Usage: archive-tasks.sh [--dry-run]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

exec node "$CLI" bus archive-tasks "$@"
