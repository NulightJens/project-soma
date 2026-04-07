#!/usr/bin/env bash
# sync-org-config.sh — push org config updates to all running agents
# Usage: CTX_ORG=<org> bash sync-org-config.sh [--org <org>]
#        Also honours CTX_ROOT and CTX_INSTANCE_ID from environment.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── python3 availability check ──────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 is required but not found in PATH" >&2
  exit 1
fi

# ── Load shared env (CTX_ROOT / CTX_INSTANCE_ID may already be in environment
#    from the caller; _ctx-env.sh only fills in defaults for vars that are unset)
source "${SCRIPT_DIR}/_ctx-env.sh"

ORG="${CTX_ORG:-}"
SOURCE="${1:-dashboard}"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --org) ORG="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -z "$ORG" ]]; then
  echo "ERROR: CTX_ORG not set and --org not provided" >&2
  exit 1
fi

CONTEXT_FILE="${CTX_FRAMEWORK_ROOT}/orgs/${ORG}/context.json"
if [[ ! -f "$CONTEXT_FILE" ]]; then
  echo "ERROR: context.json not found at ${CONTEXT_FILE}" >&2
  exit 1
fi

# Read enabled agents
ENABLED_AGENTS_FILE="${CTX_ROOT}/config/enabled-agents.json"
if [[ ! -f "$ENABLED_AGENTS_FILE" ]]; then
  echo "No enabled-agents.json found — nothing to notify"
  exit 0
fi

# Get list of agent names
AGENTS=$(python3 - "$ENABLED_AGENTS_FILE" << 'PYEOF'
import json, sys
path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
if isinstance(data, list):
    for a in data:
        name = a.get('name') or a.get('agent_name') or (a if isinstance(a, str) else '')
        if name:
            print(name)
elif isinstance(data, dict):
    for name in data.keys():
        print(name)
PYEOF
)

COUNT=0
while IFS= read -r AGENT_NAME; do
  [[ -z "$AGENT_NAME" ]] && continue

  # Update agent's config.json with org values
  AGENT_CFG="${CTX_FRAMEWORK_ROOT}/orgs/${ORG}/agents/${AGENT_NAME}/config.json"
  if [[ -f "$AGENT_CFG" ]]; then
    if python3 - "$CONTEXT_FILE" "$AGENT_CFG" << 'PYEOF' 2>&1; then
import json, sys, os, tempfile

ctx_path, cfg_path = sys.argv[1], sys.argv[2]
with open(ctx_path) as f:
    ctx = json.load(f)
with open(cfg_path) as f:
    cfg = json.load(f)

def ctx_value_valid(v):
    """Return True only if the context value is non-null and non-empty."""
    return v is not None and v != ""

def agent_value_empty(v):
    """Return True if the agent's current value is absent, null, or empty string."""
    return v is None or v == ""

# Only propagate a context value when it is valid AND the agent has no
# meaningful value of its own (or the agent still carries the org default).
for key in ['timezone', 'day_mode_start', 'day_mode_end', 'communication_style']:
    ctx_val = ctx.get(key)
    agent_val = cfg.get(key)
    if ctx_value_valid(ctx_val) and agent_value_empty(agent_val):
        cfg[key] = ctx_val

if ctx_value_valid(ctx.get('default_approval_categories')):
    existing_always_ask = cfg.get('approval_rules', {}).get('always_ask')
    if agent_value_empty(existing_always_ask) or existing_always_ask == []:
        cfg.setdefault('approval_rules', {})
        cfg['approval_rules']['always_ask'] = ctx['default_approval_categories']
        cfg['approval_rules'].setdefault('never_ask', [])

# Atomic write: write to temp file beside the target, then replace
cfg_dir = os.path.dirname(cfg_path)
fd, tmp_path = tempfile.mkstemp(dir=cfg_dir, suffix='.tmp')
try:
    with os.fdopen(fd, 'w') as f:
        json.dump(cfg, f, indent=2)
        f.write('\n')
    os.replace(tmp_path, cfg_path)
except Exception:
    os.unlink(tmp_path)
    raise
PYEOF
      COUNT=$((COUNT + 1))
      # Send inbox message to notify agent — sender is "system" since this is
      # a framework-level notification, not from a specific agent session.
      export CTX_AGENT_NAME="system"
      bash "${SCRIPT_DIR}/send-message.sh" "$AGENT_NAME" normal \
        "Org config updated by ${SOURCE}. Re-read config.json and apply new operational settings at your next heartbeat cycle." \
        2>/dev/null || true
    else
      echo "WARNING: Failed to update config for agent '${AGENT_NAME}' — skipping" >&2
    fi
  fi
done <<< "$AGENTS"

echo "Notified ${COUNT} agents of org config update"
