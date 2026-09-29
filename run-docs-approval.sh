#!/usr/bin/env bash
# Hermes no_agent job (every minute): advance owner-approved docs proposals.
# Silent unless something fails; details go to the log.
set -Eeuo pipefail
umask 077

readonly KURAMI_HOME="/home/shagon1k/_hermes/_kurami"
readonly HERMES_HOME="/home/shagon1k/_hermes/_core"
readonly NODE_BIN="${KURAMI_HOME}/runtime/node/bin/node"
readonly WORKER="${KURAMI_HOME}/app/src/human-docs/approval/worker.ts"
readonly LOCK_FILE="${KURAMI_HOME}/state/docs-approval.lock"
readonly LOG_FILE="${KURAMI_HOME}/logs/docs-approval.log"

export KURAMI_HOME HERMES_HOME
export PATH="${KURAMI_HOME}/runtime/node/bin:/home/shagon1k/.local/bin:/usr/local/bin:/usr/bin:/bin"
# User systemd for the docs service restart when started outside a login session.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

install -d -m 700 "${KURAMI_HOME}/state" "${KURAMI_HOME}/logs"

# A revision can take minutes; the next ticks simply skip while it runs.
exec 9>"${LOCK_FILE}"
if ! flock --nonblock 9; then
  exit 0
fi

if ! "${NODE_BIN}" "${WORKER}" tick 2>>"${LOG_FILE}"; then
  printf 'Docs approval worker failed. Log: %s\n' "${LOG_FILE}" >&2
  exit 1
fi
