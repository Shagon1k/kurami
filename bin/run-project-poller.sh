#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly ORCHESTRATOR_HOME="/home/shagon1k/_hermes/_orchestrator"
readonly NODE_BIN="${ORCHESTRATOR_HOME}/runtime/node/bin/node"
readonly POLLER="${ORCHESTRATOR_HOME}/app/src/poll-projects.ts"
readonly CONSUMER="${ORCHESTRATOR_HOME}/app/src/process-project-events.ts"
readonly CONTROLLER="${ORCHESTRATOR_HOME}/app/src/controller.ts"
readonly OBSERVER="${ORCHESTRATOR_HOME}/app/src/observe-sessions.ts"
readonly ENV_FILE="${ORCHESTRATOR_HOME}/secrets/github.env"
readonly PROJECT="${1:-}"

case "${PROJECT}" in
  tailortales|pickflick) ;;
  *)
    printf 'Usage: %s <tailortales|pickflick>\n' "$0" >&2
    exit 64
    ;;
esac

readonly LOCK_FILE="${ORCHESTRATOR_HOME}/state/project-poller-${PROJECT}.lock"
readonly CONSUMER_LOCK_FILE="${ORCHESTRATOR_HOME}/state/project-event-consumer.lock"
readonly ERROR_LOG="${ORCHESTRATOR_HOME}/logs/project-poller-${PROJECT}-errors.log"
readonly CONSUMER_ERROR_LOG="${ORCHESTRATOR_HOME}/logs/project-event-consumer-errors.log"
readonly CONTROLLER_ERROR_LOG="${ORCHESTRATOR_HOME}/logs/controller-errors.log"
readonly OBSERVER_ERROR_LOG="${ORCHESTRATOR_HOME}/logs/session-observer-errors.log"

export ORCHESTRATOR_HOME
export POLLER_PROJECT="${PROJECT}"
export POLLER_QUIET=1
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

if ! "${NODE_BIN}" "${OBSERVER}" --project "${PROJECT}" 2>>"${OBSERVER_ERROR_LOG}"; then
  printf 'Session observer failed for %s. Log: %s\n' "${PROJECT}" "${OBSERVER_ERROR_LOG}"
  exit 1
fi

if ! "${NODE_BIN}" "${POLLER}" 2>>"${ERROR_LOG}"; then
  printf 'Project poller failed for %s. Log: %s\n' "${PROJECT}" "${ERROR_LOG}"
  exit 1
fi

exec 8>"${CONSUMER_LOCK_FILE}"
if flock --nonblock 8; then
  if ! CONSUMER_QUIET=1 "${NODE_BIN}" "${CONSUMER}" 2>>"${CONSUMER_ERROR_LOG}"; then
    printf 'Project event consumer failed. Log: %s\n' "${CONSUMER_ERROR_LOG}"
    exit 1
  fi
  if ! CONTROLLER_QUIET=1 "${NODE_BIN}" "${CONTROLLER}" --apply 2>>"${CONTROLLER_ERROR_LOG}"; then
    printf 'Orchestrator controller failed. Log: %s\n' "${CONTROLLER_ERROR_LOG}"
    exit 1
  fi
fi
