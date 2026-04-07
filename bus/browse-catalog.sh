#!/usr/bin/env bash
# browse-catalog.sh — Browse community catalog for items
# Usage: browse-catalog.sh [--type skill|agent|org] [--search <query>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

exec node "$CLI" bus browse-catalog "$@"
