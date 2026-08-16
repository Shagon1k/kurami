#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly ORCHESTRATOR_HOME="/home/shagon1k/_hermes/_orchestrator"
readonly NODE_BIN="${ORCHESTRATOR_HOME}/runtime/node/bin/node"

export ORCHESTRATOR_HOME
export PATH="${ORCHESTRATOR_HOME}/runtime/node/bin:/usr/local/bin:/usr/bin:/bin"
exec "${NODE_BIN}" "${ORCHESTRATOR_HOME}/app/src/monthly-maintenance.ts" --apply --summary-text
