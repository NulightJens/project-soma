#!/usr/bin/env bash
# list-experiments.sh — List experiments with optional filters
# Usage: list-experiments.sh [--agent <name>] [--status <status>] [--metric <metric>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

exec node "$CLI" bus list-experiments "$@"
