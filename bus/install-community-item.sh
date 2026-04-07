#!/usr/bin/env bash
# install-community-item.sh — Install a community catalog item
# Usage: install-community-item.sh <name> [--type skill|agent|org] [--target-dir <path>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "Usage: install-community-item.sh <name> [--type skill|agent|org] [--target-dir <path>]" >&2
  exit 1
fi

shift
exec node "$CLI" bus install-community-item "$NAME" "$@"
