#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly ORCHESTRATOR_HOME="/home/shagon1k/_hermes/_orchestrator"
readonly NODE_BIN="${ORCHESTRATOR_HOME}/runtime/node/bin/node"
readonly HEALTH_CHECK="${ORCHESTRATOR_HOME}/app/src/runtime-health.ts"

export ORCHESTRATOR_HOME
export PATH="${ORCHESTRATOR_HOME}/runtime/node/bin:/usr/local/bin:/usr/bin:/bin"

set +e
output="$("${NODE_BIN}" "${HEALTH_CHECK}" --alert-text 2>&1)"
status=$?
set -e

case "${status}" in
  0)
    exit 0
    ;;
  2)
    printf '%s\n' "${output}"
    exit 0
    ;;
  *)
    printf 'Kurami runtime health check failed to execute\n%s\n' "${output}"
    exit 1
    ;;
esac
