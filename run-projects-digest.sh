#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly ORCHESTRATOR_HOME="/home/shagon1k/_hermes/_orchestrator"
readonly HERMES_HOME="/home/shagon1k/_hermes/_core"
readonly NODE_BIN="${ORCHESTRATOR_HOME}/runtime/node/bin/node"
readonly COLLECTOR="${ORCHESTRATOR_HOME}/app/src/triage-snapshot.ts"
readonly RANKER="${ORCHESTRATOR_HOME}/app/src/triage-rank.ts"
readonly DIGEST_NOTIFIER="${ORCHESTRATOR_HOME}/app/src/notify-discord-digest.ts"
readonly ENV_FILE="${ORCHESTRATOR_HOME}/secrets/github.env"
readonly LOCK_FILE="${ORCHESTRATOR_HOME}/state/projects-digest.lock"
readonly FACTS_ERROR_LOG="${ORCHESTRATOR_HOME}/logs/projects-digest-facts-errors.log"
readonly RANKING_ERROR_LOG="${ORCHESTRATOR_HOME}/logs/projects-digest-ranking-errors.log"
readonly DISCORD_ERROR_LOG="${ORCHESTRATOR_HOME}/logs/projects-digest-discord-errors.log"

export ORCHESTRATOR_HOME HERMES_HOME
export PATH="${ORCHESTRATOR_HOME}/runtime/node/bin:/home/shagon1k/.local/bin:/usr/local/bin:/usr/bin:/bin:/snap/bin"

install -d -m 700 "${ORCHESTRATOR_HOME}/state" "${ORCHESTRATOR_HOME}/logs"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

exec 9>"${LOCK_FILE}"
if ! flock --wait 60 9; then
  exit 0
fi

if ! "${NODE_BIN}" "${COLLECTOR}" "$@" 2>>"${FACTS_ERROR_LOG}"; then
  printf 'Projects Digest fact collection failed. Log: %s\n' "${FACTS_ERROR_LOG}" >&2
  exit 1
fi

if ! "${NODE_BIN}" "${RANKER}" "$@" 2>>"${RANKING_ERROR_LOG}"; then
  printf 'Projects Digest ranking failed. Log: %s\n' "${RANKING_ERROR_LOG}" >&2
  exit 1
fi

if ! "${NODE_BIN}" "${DIGEST_NOTIFIER}" "$@" --apply 2>>"${DISCORD_ERROR_LOG}"; then
  printf 'Projects Digest delivery failed. Log: %s\n' "${DISCORD_ERROR_LOG}" >&2
  exit 1
fi
