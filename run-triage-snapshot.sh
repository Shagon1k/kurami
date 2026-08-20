#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly ORCHESTRATOR_HOME="/home/shagon1k/_hermes/_orchestrator"
readonly NODE_BIN="${ORCHESTRATOR_HOME}/runtime/node/bin/node"
readonly COLLECTOR="${ORCHESTRATOR_HOME}/app/src/triage-snapshot.ts"
readonly ENV_FILE="${ORCHESTRATOR_HOME}/secrets/github.env"
readonly LOCK_FILE="${ORCHESTRATOR_HOME}/state/project-triage-snapshot.lock"
readonly ERROR_LOG="${ORCHESTRATOR_HOME}/logs/project-triage-snapshot-errors.log"

export ORCHESTRATOR_HOME
export PATH="${ORCHESTRATOR_HOME}/runtime/node/bin:/home/shagon1k/.local/bin:/usr/local/bin:/usr/bin:/bin:/snap/bin"

install -d -m 700 "${ORCHESTRATOR_HOME}/state" "${ORCHESTRATOR_HOME}/logs"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

exec 9>"${LOCK_FILE}"
if ! flock --nonblock 9; then
  exit 0
fi

if ! "${NODE_BIN}" "${COLLECTOR}" 2>>"${ERROR_LOG}"; then
  printf 'Project triage snapshot failed. Log: %s\n' "${ERROR_LOG}" >&2
  exit 1
fi
