#!/usr/bin/env bash
# submit-community-item.sh — Submit a prepared item to the community catalog
# Usage: submit-community-item.sh <name> <type> <description> [--dry-run] [--catalog-dir <dir>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

NAME="${1:-}"
TYPE="${2:-}"
DESC="${3:-}"

if [[ -z "$NAME" || -z "$TYPE" || -z "$DESC" ]]; then
  echo "Usage: submit-community-item.sh <name> <type> <description> [--dry-run] [--catalog-dir <dir>]" >&2
  exit 1
fi

shift 3
exec node "$CLI" bus submit-community-item "$NAME" "$TYPE" "$DESC" "$@"
