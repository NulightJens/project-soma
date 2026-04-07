#!/usr/bin/env bash
# gather-context.sh — Gather experiment context for an agent
# Usage: gather-context.sh [--agent <name>] [--format json|markdown]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

exec node "$CLI" bus gather-context "$@"
