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
worktree_git_dir="$(git -C "${HERMES_WORKTREE_PATH}" rev-parse --path-format=absolute --git-dir)"
if [[ "${canonical_repository}" != "${HERMES_CANONICAL_REPOSITORY}" || "${canonical_git_dir}" != "${worktree_common_dir}" ]]; then
  printf 'Managed worktree does not belong to the configured canonical repository\n' >&2
  exit 1
fi
if [[ "${worktree_git_dir}" != "${worktree_common_dir}"/worktrees/* ]]; then
  printf 'Managed worktree Git directory is not an isolated linked-worktree directory\n' >&2
  exit 1
fi
if [[ "${canonical_repository}" == *'"'* || "${canonical_repository}" == *'\\'* || "${canonical_repository}" == *$'\n'* ]]; then
  printf 'Canonical repository path cannot be represented safely in Codex config\n' >&2
  exit 1
fi
trust_override="projects.\"${canonical_repository}\".trust_level=\"trusted\""

# CI repair and review fix use protocol events; tmux supervises these workers.
if [[ -n "${HERMES_CODEX_TASK_ID:-}" ]]; then
  exec node "$(dirname -- "$(realpath -- "$0")")/../src/orchestrator/integrations/codex/managed-worker.ts"
fi

cd -- "${HERMES_WORKTREE_PATH}"
if [[ -n "${HERMES_INITIAL_PROMPT_FILE:-}" ]]; then
  [[ -f "${HERMES_INITIAL_PROMPT_FILE}" ]] || { printf 'Initial prompt file not found\n' >&2; exit 1; }
  initial_prompt="$(base64 --decode < "${HERMES_INITIAL_PROMPT_FILE}")"
  rm -f -- "${HERMES_INITIAL_PROMPT_FILE}"
elif [[ -n "${HERMES_INITIAL_PROMPT_B64:-}" ]]; then
  initial_prompt="$(printf '%s' "${HERMES_INITIAL_PROMPT_B64}" | base64 --decode)"
  unset HERMES_INITIAL_PROMPT_B64
else
  printf 'Initial prompt is required\n' >&2
  exit 1
fi
exec "${CODEX_BIN}" \
  -C "${HERMES_WORKTREE_PATH}" \
  --sandbox workspace-write \
  --add-dir "${worktree_git_dir}" \
  --add-dir "${worktree_common_dir}" \
  -c 'sandbox_workspace_write.network_access=true' \
  --ask-for-approval never \
  -c 'approvals_reviewer="auto_review"' \
  -c "${trust_override}" \
  "${initial_prompt}"
