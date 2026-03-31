#!/usr/bin/env bash
# enable-agent.sh - Enable a cortextOS agent
# Usage: enable-agent.sh <agent_name> [--org <org>] [--restart]

set -euo pipefail

TEMPLATE_ROOT="$(cd "$(dirname "$0")" && pwd)"

# Parse args
AGENT=""
CTX_ORG=""
RESTART=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --org) CTX_ORG="$2"; shift 2 ;;
        --restart) RESTART=true; shift ;;
        *) [[ -z "${AGENT}" ]] && AGENT="$1"; shift ;;
    esac
done

if [[ -z "${AGENT}" ]]; then
    echo "Usage: enable-agent.sh <agent_name> [--org <org>] [--restart]"
    exit 1
fi

# Load instance ID
REPO_ENV="${TEMPLATE_ROOT}/.env"
if [[ -f "${REPO_ENV}" ]]; then
    CTX_INSTANCE_ID=$(grep '^CTX_INSTANCE_ID=' "${REPO_ENV}" 2>/dev/null | cut -d= -f2)
    [[ -z "${CTX_INSTANCE_ID:-}" ]] && CTX_INSTANCE_ID=$(grep '^CRM_INSTANCE_ID=' "${REPO_ENV}" 2>/dev/null | cut -d= -f2)
fi
CTX_INSTANCE_ID="${CTX_INSTANCE_ID:-default}"
CTX_ROOT="${HOME}/.cortextos/${CTX_INSTANCE_ID}"

# Resolve agent directory
AGENT_DIR=""
if [[ -n "${CTX_ORG}" ]]; then
    AGENT_DIR="${TEMPLATE_ROOT}/orgs/${CTX_ORG}/agents/${AGENT}"
else
    # Auto-detect: check root agents/, then scan orgs/
    if [[ -d "${TEMPLATE_ROOT}/agents/${AGENT}" ]]; then
        AGENT_DIR="${TEMPLATE_ROOT}/agents/${AGENT}"
    else
        for org_dir in "${TEMPLATE_ROOT}"/orgs/*/agents/"${AGENT}"; do
            if [[ -d "${org_dir}" ]]; then
                AGENT_DIR="${org_dir}"
                # Extract org name from path
                CTX_ORG=$(echo "${org_dir}" | sed 's|.*/orgs/\([^/]*\)/agents/.*|\1|')
                break
            fi
        done
    fi
fi

ENABLED_FILE="${CTX_ROOT}/config/enabled-agents.json"

# Validate agent directory exists
if [[ -z "${AGENT_DIR}" || ! -d "${AGENT_DIR}" ]]; then
    echo "ERROR: Unknown agent '${AGENT}'"
    echo ""
    echo "Available agents:"
    # List root-level agents
    for d in "${TEMPLATE_ROOT}/agents"/*/; do
        [[ -d "$d" ]] || continue
        name=$(basename "$d")
        echo "  ${name}"
    done
    # List org agents
    for d in "${TEMPLATE_ROOT}"/orgs/*/agents/*/; do
        [[ -d "$d" ]] || continue
        name=$(basename "$d")
        org=$(echo "$d" | sed 's|.*/orgs/\([^/]*\)/agents/.*|\1|')
        echo "  ${name} (org: ${org})"
    done
    exit 1
fi

# Preflight: .env must exist with BOT_TOKEN and CHAT_ID set
AGENT_ENV="${AGENT_DIR}/.env"
if [[ ! -f "${AGENT_ENV}" ]]; then
    echo "ERROR: ${AGENT}/.env not found."
    echo ""
    echo "Create it before enabling the agent:"
    echo "  cat > ${AGENT_ENV} << EOF"
    echo "  BOT_TOKEN=<your_telegram_bot_token>"
    echo "  CHAT_ID=<your_telegram_chat_id>"
    echo "  ALLOWED_USER=<your_telegram_username>"
    echo "  EOF"
    echo ""
    echo "Without .env, the agent would inherit the parent bot token and send"
    echo "messages to the wrong Telegram chat."
    exit 1
fi

_BOT_TOKEN_VAL=$(grep '^BOT_TOKEN=' "${AGENT_ENV}" | cut -d= -f2- | tr -d '"' | tr -d "'")
_CHAT_ID_VAL=$(grep '^CHAT_ID=' "${AGENT_ENV}" | cut -d= -f2- | tr -d '"' | tr -d "'")

if [[ -z "${_BOT_TOKEN_VAL:-}" ]]; then
    echo "ERROR: BOT_TOKEN is not set in ${AGENT_ENV}"
    echo "Add: BOT_TOKEN=<your_telegram_bot_token>"
    exit 1
fi
if [[ -z "${_CHAT_ID_VAL:-}" ]]; then
    echo "ERROR: CHAT_ID is not set in ${AGENT_ENV}"
    echo "Add: CHAT_ID=<your_telegram_chat_id>"
    exit 1
fi

# Build plist name (includes org if present)
if [[ -n "${CTX_ORG}" ]]; then
    PLIST_NAME="cortextos.${CTX_INSTANCE_ID}.${CTX_ORG}.${AGENT}"
    TMUX_SESSION="ctx-${CTX_INSTANCE_ID}-${CTX_ORG}-${AGENT}"
else
    PLIST_NAME="cortextos.${CTX_INSTANCE_ID}.${AGENT}"
    TMUX_SESSION="ctx-${CTX_INSTANCE_ID}-${AGENT}"
fi
PLIST="${HOME}/Library/LaunchAgents/${PLIST_NAME}.plist"

# Check if already enabled (unless restarting)
if [[ "${RESTART}" != "true" ]]; then
    IS_ENABLED=$(jq -r ".\"${AGENT}\".enabled" "${ENABLED_FILE}" 2>/dev/null || echo "false")
    if [[ "${IS_ENABLED}" == "true" ]]; then
        echo "${AGENT} is already enabled."
        echo "Use --restart to restart it, or ./disable-agent.sh ${AGENT} first."
        exit 0
    fi
fi

echo "========================================="
echo "  Enabling: ${AGENT}"
[[ -n "${CTX_ORG}" ]] && echo "  Org: ${CTX_ORG}"
echo "========================================="
echo ""

if [[ "${RESTART}" == "true" ]]; then
    echo "Restarting ${AGENT}..."

    # Reset crash counter
    rm -f "${CTX_ROOT}/logs/${AGENT}/.crash_count_today"

    # Reload launchd
    if [[ -f "${PLIST}" ]]; then
        launchctl unload "${PLIST}" 2>/dev/null || true
        launchctl load "${PLIST}"
        echo "${AGENT} restarted."
    else
        echo "No launchd plist found. Running full setup..."
        CTX_ORG="${CTX_ORG}" CTX_AGENT_DIR="${AGENT_DIR}" \
            "${TEMPLATE_ROOT}/scripts/generate-launchd.sh" "${AGENT}" "${AGENT_DIR}"
    fi
    exit 0
fi

# Set environment for the agent
export CTX_AGENT_NAME="${AGENT}"
export CTX_INSTANCE_ID="${CTX_INSTANCE_ID}"
export CTX_ROOT="${CTX_ROOT}"
export CTX_FRAMEWORK_ROOT="${TEMPLATE_ROOT}"
export CTX_ORG
export CTX_AGENT_DIR="${AGENT_DIR}"

# Ensure all scripts are executable
chmod +x "${TEMPLATE_ROOT}/"*.sh 2>/dev/null || true
chmod +x "${TEMPLATE_ROOT}/scripts/"*.sh 2>/dev/null || true
chmod +x "${TEMPLATE_ROOT}/bus/"*.sh 2>/dev/null || true

# Create per-agent state directories (flat bus paths)
mkdir -p "${CTX_ROOT}/inbox/${AGENT}"
mkdir -p "${CTX_ROOT}/outbox/${AGENT}"
mkdir -p "${CTX_ROOT}/processed/${AGENT}"
mkdir -p "${CTX_ROOT}/inflight/${AGENT}"
mkdir -p "${CTX_ROOT}/logs/${AGENT}"
mkdir -p "${CTX_ROOT}/state/${AGENT}"

# Generate and load launchd plist
echo ""
echo "Setting up persistence with launchd..."
"${TEMPLATE_ROOT}/scripts/generate-launchd.sh" "${AGENT}" "${AGENT_DIR}"

# Update enabled status
if [[ -n "${CTX_ORG}" ]]; then
    jq ".\"${AGENT}\".enabled = true | .\"${AGENT}\".status = \"configured\" | .\"${AGENT}\".org = \"${CTX_ORG}\"" "${ENABLED_FILE}" > "${ENABLED_FILE}.tmp"
else
    jq ".\"${AGENT}\".enabled = true | .\"${AGENT}\".status = \"configured\"" "${ENABLED_FILE}" > "${ENABLED_FILE}.tmp"
fi
mv "${ENABLED_FILE}.tmp" "${ENABLED_FILE}"

echo ""
echo "========================================="
echo "  ${AGENT} is now LIVE"
echo "========================================="
echo ""
echo "  launchd: loaded (auto-restarts on crash)"
echo "  tmux: attach with: tmux attach -t ${TMUX_SESSION}"
echo ""
echo "  Test it: Send a message to the agent's Telegram bot"
echo ""
