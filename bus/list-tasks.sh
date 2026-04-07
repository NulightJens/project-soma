#!/usr/bin/env bash
# list-tasks.sh — List tasks with optional filters
# Usage: list-tasks.sh [--agent <name>] [--status <status>] [--format json|text]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

exec node "$CLI" bus list-tasks "$@"
