#!/usr/bin/env bash
set -euo pipefail

umask 077

KURAMI_HOME="${KURAMI_HOME:-${ORCHESTRATOR_HOME:-}}"
: "${KURAMI_HOME:?KURAMI_HOME or ORCHESTRATOR_HOME is required}"
: "${KURAMI_REVIEW_ID:?KURAMI_REVIEW_ID is required}"
: "${NODE_BIN:?NODE_BIN is required}"
export KURAMI_HOME
export ORCHESTRATOR_HOME="${KURAMI_HOME}"

readonly secret_file="${KURAMI_HOME}/secrets/github-reviewer-app.env"
readonly worker="${KURAMI_HOME}/app/src/orchestrator/projects/reviews/worker.ts"

if [[ ! -f "${secret_file}" ]]; then
  printf 'GitHub reviewer App credential file not found\n' >&2
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

: "${KURAMI_GITHUB_REVIEWER_APP_ID:?GitHub reviewer App ID is missing}"
: "${KURAMI_GITHUB_REVIEWER_INSTALLATION_ID:?GitHub reviewer App installation ID is missing}"
: "${KURAMI_GITHUB_REVIEWER_PRIVATE_KEY_FILE:?GitHub reviewer App private-key path is missing}"

# The detached review path must never inherit the broad user credential used
# by the project poller and primary engineering task.
unset GH_TOKEN GITHUB_TOKEN

exec "${NODE_BIN}" "${worker}" --review-id "${KURAMI_REVIEW_ID}"
