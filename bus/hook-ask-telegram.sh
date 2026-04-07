#!/usr/bin/env bash
# hook-ask-telegram.sh - PreToolUse hook for AskUserQuestion
# Non-blocking: sends question(s) to Telegram, exits 0.
# Saves state file so fast-checker can navigate the TUI correctly.
#
# Handles three cases:
# 1. Single question, single-select (multiSelect: false)
# 2. Single question, multi-select (multiSelect: true)
# 3. Multiple questions in sequence (questions array > 1)

set -euo pipefail

INPUT=$(cat)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/_ctx-env.sh" 2>/dev/null || true
TEMPLATE_ROOT="${CTX_FRAMEWORK_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
AGENT="${CTX_AGENT_NAME:-$(basename "$(pwd)")}"

ENV_FILE="${CTX_AGENT_DIR:-.}/.env"
{ set +x; } 2>/dev/null
if [[ -f "$ENV_FILE" ]]; then
    set -a; source "$ENV_FILE"; set +a
elif [[ -f ".env" ]]; then
    set -a; source ".env"; set +a
fi

if [[ -z "${BOT_TOKEN:-}" ]] || [[ -z "${CHAT_ID:-}" ]]; then
    exit 0
fi

source "${TEMPLATE_ROOT}/bus/_telegram-curl.sh"

QUESTIONS_JSON=$(echo "$INPUT" | jq -c '.tool_input.questions // []' 2>/dev/null || echo "[]")
QUESTION_COUNT=$(echo "$QUESTIONS_JSON" | jq 'length' 2>/dev/null || echo "0")

if [[ "$QUESTION_COUNT" -eq 0 ]]; then
    exit 0
fi

# Save state file for fast-checker to know question structure
# Use state dir instead of predictable /tmp path
ASK_STATE_DIR="${CTX_ROOT:-${HOME}/.cortextos/default}/state/${AGENT}"
mkdir -p "${ASK_STATE_DIR}"
STATE_FILE="${ASK_STATE_DIR}/ask-state.json"
echo "$QUESTIONS_JSON" | jq -c '{
    questions: [.[] | {
        question: .question,
        header: (.header // ""),
        multiSelect: (.multiSelect // false),
        options: [.options[] | (.label // .)]
    }],
    current_question: 0,
    total_questions: length,
    multi_select_chosen: []
}' > "$STATE_FILE"

if [[ ! -f "$STATE_FILE" ]]; then
    echo "ERROR: Failed to create ask state file" >&2
    exit 0
fi

# Send first question (fast-checker sends subsequent ones for multi-question)
Q_IDX=0
Q_TEXT=$(echo "$QUESTIONS_JSON" | jq -r ".[$Q_IDX].question // \"Question\"" 2>/dev/null)
Q_HEADER=$(echo "$QUESTIONS_JSON" | jq -r ".[$Q_IDX].header // empty" 2>/dev/null || echo "")
Q_MULTI=$(echo "$QUESTIONS_JSON" | jq -r ".[$Q_IDX].multiSelect // false" 2>/dev/null)
Q_OPTIONS=$(echo "$QUESTIONS_JSON" | jq -c ".[$Q_IDX].options // []" 2>/dev/null)
Q_OPT_COUNT=$(echo "$Q_OPTIONS" | jq 'length' 2>/dev/null || echo "0")

# Build message text
if [[ "$QUESTION_COUNT" -gt 1 ]]; then
    MSG="QUESTION (1/${QUESTION_COUNT}) - ${AGENT}:"
else
    MSG="QUESTION - ${AGENT}:"
fi
[[ -n "$Q_HEADER" ]] && MSG+="
${Q_HEADER}"
MSG+="
${Q_TEXT}
"

if [[ "$Q_MULTI" == "true" ]]; then
    MSG+="
(Multi-select: tap options to toggle, then tap Submit)"
fi

for i in $(seq 0 $((Q_OPT_COUNT - 1))); do
    LABEL=$(echo "$Q_OPTIONS" | jq -r ".[$i].label // .[$i] // \"Option $((i+1))\"" 2>/dev/null)
    DESC=$(echo "$Q_OPTIONS" | jq -r ".[$i].description // empty" 2>/dev/null || echo "")
    MSG+="
$((i+1)). ${LABEL}"
    [[ -n "$DESC" ]] && MSG+="
   ${DESC}"
done

# Build keyboard based on type
if [[ "$Q_MULTI" == "true" ]]; then
    # Multi-select: each option is a toggle, plus Submit button
    KEYBOARD=$(echo "$Q_OPTIONS" | jq -c '[to_entries[] | [{
        text: (.value.label // .value // "Option \(.key + 1)"),
        callback_data: "asktoggle_'"$Q_IDX"'_\(.key)"
    }]] + [[{text: "Submit Selections", callback_data: "asksubmit_'"$Q_IDX"'"}]]' 2>/dev/null)
else
    # Single-select: each option selects and advances
    KEYBOARD=$(echo "$Q_OPTIONS" | jq -c '[to_entries[] | [{
        text: (.value.label // .value // "Option \(.key + 1)"),
        callback_data: "askopt_'"$Q_IDX"'_\(.key)"
    }]]' 2>/dev/null)
fi
KEYBOARD="{\"inline_keyboard\":${KEYBOARD}}"

telegram_api_post "sendMessage" \
    -H "Content-Type: application/json" \
    -d "$(jq -n -c \
        --arg chat_id "$CHAT_ID" \
        --arg text "$MSG" \
        --argjson reply_markup "$KEYBOARD" \
        '{chat_id: $chat_id, text: $text, reply_markup: $reply_markup}')" > /dev/null 2>&1 || true

exit 0
