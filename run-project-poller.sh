#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly ORCHESTRATOR_HOME="/home/shagon1k/_hermes/_orchestrator"
readonly NODE_BIN="${ORCHESTRATOR_HOME}/runtime/node/bin/node"
readonly POLLER="${ORCHESTRATOR_HOME}/app/src/poll-projects.ts"
readonly CONSUMER="${ORCHESTRATOR_HOME}/app/src/process-project-events.ts"
readonly CI_OBSERVER="${ORCHESTRATOR_HOME}/app/src/observe-ci.ts"
readonly CONTROLLER="${ORCHESTRATOR_HOME}/app/src/controller.ts"
readonly RUNTIME_BUDGET="${ORCHESTRATOR_HOME}/app/src/runtime-budget.ts"
readonly DISCORD_NOTIFIER="${ORCHESTRATOR_HOME}/app/src/notify-discord-controls.ts"
readonly METADATA_SYNC="${ORCHESTRATOR_HOME}/app/src/metadata-sync.ts"
readonly PROJECTS_DIGEST="${ORCHESTRATOR_HOME}/app/run-projects-digest.sh"
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
readonly CI_OBSERVER_ERROR_LOG="${ORCHESTRATOR_HOME}/logs/ci-observer-errors.log"
readonly CONTROLLER_ERROR_LOG="${ORCHESTRATOR_HOME}/logs/controller-errors.log"
readonly RUNTIME_BUDGET_ERROR_LOG="${ORCHESTRATOR_HOME}/logs/runtime-budget-errors.log"
readonly DISCORD_NOTIFIER_ERROR_LOG="${ORCHESTRATOR_HOME}/logs/discord-control-notifier-errors.log"
readonly METADATA_SYNC_ERROR_LOG="${ORCHESTRATOR_HOME}/logs/metadata-sync-errors.log"
readonly PROJECTS_DIGEST_EVENT_LOG="${ORCHESTRATOR_HOME}/logs/projects-digest-event-refresh.log"
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

poll_output=""
poll_changed=0
if poll_output="$("${NODE_BIN}" "${POLLER}" 2>>"${ERROR_LOG}")"; then
  if [[ -n "${poll_output}" ]]; then
    poll_changed=1
    printf '%s\n' "${poll_output}"
  fi
else
  printf 'Project poller failed for %s; continuing safe reconciliation. Log: %s\n' \
    "${PROJECT}" "${ERROR_LOG}"
fi

metadata_sync_changed=0
metadata_sync_output=""
if metadata_sync_output="$("${NODE_BIN}" "${METADATA_SYNC}" --project "${PROJECT}" --apply \
  2>>"${METADATA_SYNC_ERROR_LOG}")"; then
  if [[ "${metadata_sync_output}" != *'"action":"unchanged"'* ]]; then
    metadata_sync_changed=1
    printf '%s\n' "${metadata_sync_output}"
  fi
else
  printf 'Guarded metadata sync failed for %s; owner values remain protected. Log: %s\n' \
    "${PROJECT}" "${METADATA_SYNC_ERROR_LOG}" >>"${METADATA_SYNC_ERROR_LOG}"
fi

if ! CI_OBSERVER_QUIET=1 "${NODE_BIN}" "${CI_OBSERVER}" --project "${PROJECT}" --apply \
  2>>"${CI_OBSERVER_ERROR_LOG}"; then
  printf 'CI observer failed for %s; continuing core reconciliation.\n' "${PROJECT}" \
    >>"${CI_OBSERVER_ERROR_LOG}"
fi

exec 8>"${CONSUMER_LOCK_FILE}"
if flock --nonblock 8; then
  if ! CONSUMER_QUIET=1 "${NODE_BIN}" "${CONSUMER}" 2>>"${CONSUMER_ERROR_LOG}"; then
    printf 'Project event consumer failed. Log: %s\n' "${CONSUMER_ERROR_LOG}"
    exit 1
  fi
  if ! RUNTIME_BUDGET_QUIET=1 "${NODE_BIN}" "${RUNTIME_BUDGET}" --apply \
    2>>"${RUNTIME_BUDGET_ERROR_LOG}"; then
    printf 'Runtime budget enforcement failed. Log: %s\n' "${RUNTIME_BUDGET_ERROR_LOG}"
    exit 1
  fi
  if ! CONTROLLER_QUIET=1 "${NODE_BIN}" "${CONTROLLER}" --apply 2>>"${CONTROLLER_ERROR_LOG}"; then
    printf 'Orchestrator controller failed. Log: %s\n' "${CONTROLLER_ERROR_LOG}"
    exit 1
  fi
  if ! DISCORD_NOTIFIER_QUIET=1 HERMES_HOME=/home/shagon1k/_hermes/_core \
    "${NODE_BIN}" "${DISCORD_NOTIFIER}" --apply 2>>"${DISCORD_NOTIFIER_ERROR_LOG}"; then
    printf 'Discord control notification failed. Log: %s\n' "${DISCORD_NOTIFIER_ERROR_LOG}"
    exit 1
  fi
fi

if (( poll_changed == 1 || metadata_sync_changed == 1 )); then
  if ! "${PROJECTS_DIGEST}" --project "${PROJECT}" >>"${PROJECTS_DIGEST_EVENT_LOG}" 2>&1; then
    printf 'Projects Digest refresh failed for %s; daily baseline remains active.\n' \
      "${PROJECT}" >>"${PROJECTS_DIGEST_EVENT_LOG}"
  fi
fi
