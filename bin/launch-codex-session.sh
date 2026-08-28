#!/usr/bin/env bash
set -euo pipefail

umask 077

KURAMI_HOME="${KURAMI_HOME:-}"
: "${KURAMI_HOME:?KURAMI_HOME is required}"
: "${HERMES_RUN_ID:?HERMES_RUN_ID is required}"
: "${HERMES_REPOSITORY:?HERMES_REPOSITORY is required}"
: "${HERMES_ISSUE_NUMBER:?HERMES_ISSUE_NUMBER is required}"
: "${HERMES_WORKTREE_PATH:?HERMES_WORKTREE_PATH is required}"
: "${HERMES_CANONICAL_REPOSITORY:?HERMES_CANONICAL_REPOSITORY is required}"
: "${HERMES_INITIAL_PROMPT_B64:?HERMES_INITIAL_PROMPT_B64 is required}"
: "${CODEX_BIN:?CODEX_BIN is required}"
export KURAMI_HOME

secret_file="${KURAMI_HOME}/secrets/github.env"
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

if [[ ! -d "${HERMES_CANONICAL_REPOSITORY}" ]]; then
  printf 'Canonical repository does not exist\n' >&2
  exit 1
fi

canonical_repository="$(realpath -e -- "${HERMES_CANONICAL_REPOSITORY}")"
canonical_git_dir="$(git -C "${canonical_repository}" rev-parse --path-format=absolute --git-dir)"
worktree_common_dir="$(git -C "${HERMES_WORKTREE_PATH}" rev-parse --path-format=absolute --git-common-dir)"
if [[ "${canonical_repository}" != "${HERMES_CANONICAL_REPOSITORY}" || "${canonical_git_dir}" != "${worktree_common_dir}" ]]; then
  printf 'Managed worktree does not belong to the configured canonical repository\n' >&2
  exit 1
fi
if [[ "${canonical_repository}" == *'"'* || "${canonical_repository}" == *'\\'* || "${canonical_repository}" == *$'\n'* ]]; then
  printf 'Canonical repository path cannot be represented safely in Codex config\n' >&2
  exit 1
fi
trust_override="projects.\"${canonical_repository}\".trust_level=\"trusted\""

cd -- "${HERMES_WORKTREE_PATH}"
initial_prompt="$(printf '%s' "${HERMES_INITIAL_PROMPT_B64}" | base64 --decode)"
unset HERMES_INITIAL_PROMPT_B64
exec "${CODEX_BIN}" \
  -C "${HERMES_WORKTREE_PATH}" \
  --sandbox workspace-write \
  --ask-for-approval on-request \
  -c 'approvals_reviewer="auto_review"' \
  -c "${trust_override}" \
  "${initial_prompt}"
