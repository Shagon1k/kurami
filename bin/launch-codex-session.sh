#!/usr/bin/env bash
set -euo pipefail

umask 077

: "${ORCHESTRATOR_HOME:?ORCHESTRATOR_HOME is required}"
: "${HERMES_RUN_ID:?HERMES_RUN_ID is required}"
: "${HERMES_REPOSITORY:?HERMES_REPOSITORY is required}"
: "${HERMES_ISSUE_NUMBER:?HERMES_ISSUE_NUMBER is required}"
: "${HERMES_WORKTREE_PATH:?HERMES_WORKTREE_PATH is required}"
: "${HERMES_INITIAL_PROMPT_B64:?HERMES_INITIAL_PROMPT_B64 is required}"
: "${CODEX_BIN:?CODEX_BIN is required}"

secret_file="${ORCHESTRATOR_HOME}/secrets/github.env"
if [[ ! -f "${secret_file}" ]]; then
  printf 'GitHub credential file not found\n' >&2
  exit 1
fi

secret_mode="$(stat -c '%a' "${secret_file}")"
if (( (8#${secret_mode} & 8#077) != 0 )); then
  printf 'GitHub credential file permissions are too broad\n' >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${secret_file}"
set +a

: "${GH_TOKEN:?GH_TOKEN is missing from the credential file}"

if [[ ! -d "${HERMES_WORKTREE_PATH}" ]]; then
  printf 'Worktree does not exist\n' >&2
  exit 1
fi

cd -- "${HERMES_WORKTREE_PATH}"
initial_prompt="$(printf '%s' "${HERMES_INITIAL_PROMPT_B64}" | base64 --decode)"
unset HERMES_INITIAL_PROMPT_B64
exec "${CODEX_BIN}" \
  -C "${HERMES_WORKTREE_PATH}" \
  --sandbox workspace-write \
  --ask-for-approval on-request \
  -c 'approvals_reviewer="auto_review"' \
  "${initial_prompt}"
