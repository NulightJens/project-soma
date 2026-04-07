#!/usr/bin/env bash
# cortextOS shared environment resolution
# Source this at the top of bus/ and scripts/ files after determining SCRIPT_DIR.
#
# Handles:
# - CRM_ -> CTX_ backward compatibility
# - Agent dir resolution (with/without org)
# - Flat message bus paths
# - .env sourcing helper

# ── Source .cortextos-env if present (written by the Node.js daemon) ─────
# This is the most reliable fallback: a file in the agent's working dir
# that contains the correct CTX_ vars, regardless of env var inheritance.
if [[ -z "${CTX_ROOT:-}" ]]; then
    if [[ -f "$(pwd)/.cortextos-env" ]]; then
        source "$(pwd)/.cortextos-env" 2>/dev/null || true
    elif [[ -n "${CTX_AGENT_DIR:-}" && -f "${CTX_AGENT_DIR}/.cortextos-env" ]]; then
        source "${CTX_AGENT_DIR}/.cortextos-env" 2>/dev/null || true
    fi
fi

# ── Backward compat: accept CRM_ or CTX_ vars ──────────────────────────
CTX_INSTANCE_ID="${CTX_INSTANCE_ID:-${CRM_INSTANCE_ID:-default}}"
CTX_AGENT_NAME="${CTX_AGENT_NAME:-${CRM_AGENT_NAME:-$(basename "$(pwd)")}}"

# ── Validate agent name to prevent path traversal ─────────────────────────
if [[ -n "${CTX_AGENT_NAME}" && ! "${CTX_AGENT_NAME}" =~ ^[a-z0-9_-]+$ ]]; then
    echo "FATAL: CTX_AGENT_NAME '${CTX_AGENT_NAME}' contains invalid characters (allowed: a-z 0-9 _ -)" >&2
    exit 1
fi
CTX_FRAMEWORK_ROOT="${CTX_FRAMEWORK_ROOT:-${CRM_TEMPLATE_ROOT:-}}"
CTX_ROOT="${CTX_ROOT:-${CRM_ROOT:-${HOME}/.cortextos/${CTX_INSTANCE_ID}}}"
CTX_PROJECT_ROOT="${CTX_PROJECT_ROOT:-}"
CTX_ORG="${CTX_ORG:-}"

# ── Canonical agent directory (never construct manually elsewhere) ──────
if [[ -n "${CTX_AGENT_DIR:-}" ]]; then
    : # already set explicitly (e.g. by the Node.js daemon)
elif [[ -n "${CTX_ORG}" && -n "${CTX_PROJECT_ROOT}" ]]; then
    CTX_AGENT_DIR="${CTX_PROJECT_ROOT}/orgs/${CTX_ORG}/agents/${CTX_AGENT_NAME}"
elif [[ -n "${CTX_PROJECT_ROOT}" ]]; then
    CTX_AGENT_DIR="${CTX_PROJECT_ROOT}/agents/${CTX_AGENT_NAME}"
fi

# ── Flat message bus paths (not org-nested) ─────────────────────────────
CTX_INBOX="${CTX_ROOT}/inbox/${CTX_AGENT_NAME}"
CTX_INFLIGHT="${CTX_ROOT}/inflight/${CTX_AGENT_NAME}"
CTX_PROCESSED="${CTX_ROOT}/processed/${CTX_AGENT_NAME}"
CTX_LOG_DIR="${CTX_ROOT}/logs/${CTX_AGENT_NAME}"
CTX_STATE="${CTX_ROOT}/state/${CTX_AGENT_NAME}"

# ── Org-aware state paths (tasks, approvals, analytics are org-scoped) ──
if [[ -n "${CTX_ORG}" ]]; then
    CTX_TASK_DIR="${CTX_ROOT}/orgs/${CTX_ORG}/tasks"
    CTX_APPROVAL_DIR="${CTX_ROOT}/orgs/${CTX_ORG}/approvals"
    CTX_ANALYTICS_DIR="${CTX_ROOT}/orgs/${CTX_ORG}/analytics"
else
    CTX_TASK_DIR="${CTX_ROOT}/tasks"
    CTX_APPROVAL_DIR="${CTX_ROOT}/approvals"
    CTX_ANALYTICS_DIR="${CTX_ROOT}/analytics"
fi

# ── Timezone from org context.json ───────────────────────────────────────
# Used by update-heartbeat.sh for day/night mode and any time-of-day logic.
# Falls back to system timezone if not configured.
if [[ -z "${CTX_TIMEZONE:-}" ]]; then
    if [[ -n "${CTX_ORG}" && -n "${CTX_PROJECT_ROOT:-}" ]]; then
        CTX_TIMEZONE=$(jq -r '.timezone // empty' "${CTX_PROJECT_ROOT}/orgs/${CTX_ORG}/context.json" 2>/dev/null || echo "")
    fi
    if [[ -z "${CTX_TIMEZONE}" ]]; then
        CTX_TIMEZONE=$(readlink /etc/localtime 2>/dev/null | sed 's:.*/zoneinfo/::' || echo "UTC")
    fi
fi

# ── Orchestrator name from org context.json ───────────────────────────────
# Used by update-task.sh to notify the orchestrator about blocked tasks.
if [[ -z "${CTX_ORCHESTRATOR:-}" ]]; then
    if [[ -n "${CTX_ORG}" && -n "${CTX_PROJECT_ROOT:-}" ]]; then
        CTX_ORCHESTRATOR=$(jq -r '.orchestrator // empty' "${CTX_PROJECT_ROOT}/orgs/${CTX_ORG}/context.json" 2>/dev/null || echo "")
    fi
    CTX_ORCHESTRATOR="${CTX_ORCHESTRATOR:-orchestrator}"
fi

# ── .env sourcing helper ────────────────────────────────────────────────
ctx_source_env() {
    if [[ -n "${CTX_AGENT_DIR:-}" && -f "${CTX_AGENT_DIR}/.env" ]]; then
        { set +x; } 2>/dev/null
        set -a; source "${CTX_AGENT_DIR}/.env"; set +a
    elif [[ -f ".env" ]]; then
        { set +x; } 2>/dev/null
        set -a; source ".env"; set +a
    fi
}

# ── Instance ID from repo .env (for scripts that need it before CTX_ROOT) ──
ctx_resolve_instance() {
    local framework_root="${1:-${CTX_FRAMEWORK_ROOT:-}}"
    if [[ -n "${framework_root}" && -f "${framework_root}/.env" ]]; then
        local id
        id=$(grep '^CTX_INSTANCE_ID=' "${framework_root}/.env" 2>/dev/null | cut -d= -f2)
        if [[ -z "${id}" ]]; then
            id=$(grep '^CRM_INSTANCE_ID=' "${framework_root}/.env" 2>/dev/null | cut -d= -f2)
        fi
        CTX_INSTANCE_ID="${id:-${CTX_INSTANCE_ID}}"
    fi
    CTX_ROOT="${HOME}/.cortextos/${CTX_INSTANCE_ID}"
}
