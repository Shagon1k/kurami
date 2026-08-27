#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly KURAMI_HOME="/home/shagon1k/_hermes/_kurami"
readonly HERMES_HOME="/home/shagon1k/_hermes/_core"
readonly NODE_BIN="${KURAMI_HOME}/runtime/node/bin/node"
readonly COLLECTOR="${KURAMI_HOME}/app/src/orchestrator/projects/triage/snapshot.ts"
readonly RANKER="${KURAMI_HOME}/app/src/orchestrator/projects/triage/rank.ts"
readonly METADATA_SCHEDULER="${KURAMI_HOME}/app/src/metadata-proposal-scheduler.ts"
readonly DIGEST_NOTIFIER="${KURAMI_HOME}/app/src/notify-discord-digest.ts"
readonly ENV_FILE="${KURAMI_HOME}/secrets/github.env"
readonly LOCK_FILE="${KURAMI_HOME}/state/projects-digest.lock"
readonly CONSUMER_LOCK_FILE="${KURAMI_HOME}/state/project-event-consumer.lock"
readonly FACTS_ERROR_LOG="${KURAMI_HOME}/logs/projects-digest-facts-errors.log"
readonly RANKING_ERROR_LOG="${KURAMI_HOME}/logs/projects-digest-ranking-errors.log"
readonly METADATA_ERROR_LOG="${KURAMI_HOME}/logs/metadata-proposal-scheduler-errors.log"
readonly DISCORD_ERROR_LOG="${KURAMI_HOME}/logs/projects-digest-discord-errors.log"

export KURAMI_HOME HERMES_HOME
export ORCHESTRATOR_HOME="${KURAMI_HOME}"
export PATH="${KURAMI_HOME}/runtime/node/bin:/home/shagon1k/.local/bin:/usr/local/bin:/usr/bin:/bin:/snap/bin"

install -d -m 700 "${KURAMI_HOME}/state" "${KURAMI_HOME}/logs"

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

# The argument-free invocation is the once-daily recovery baseline. Event-driven
# per-project refreshes update facts/ranking/cards, but never create extra AI batches.
if (( $# == 0 )); then
  exec 8>"${CONSUMER_LOCK_FILE}"
  if flock --wait 60 8; then
    if ! "${NODE_BIN}" "${METADATA_SCHEDULER}" --apply \
      2>>"${METADATA_ERROR_LOG}"; then
      printf 'Automatic metadata proposals failed; digest delivery continues. Log: %s\n' \
        "${METADATA_ERROR_LOG}" >&2
    fi
  else
    printf 'Automatic metadata proposals deferred; controller lock is busy.\n' >&2
  fi
fi

if ! "${NODE_BIN}" "${DIGEST_NOTIFIER}" "$@" --apply 2>>"${DISCORD_ERROR_LOG}"; then
  printf 'Projects Digest delivery failed. Log: %s\n' "${DISCORD_ERROR_LOG}" >&2
  exit 1
fi
