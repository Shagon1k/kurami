#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly ORCHESTRATOR_HOME="/home/shagon1k/_hermes/_orchestrator"
readonly NODE_BIN="${ORCHESTRATOR_HOME}/runtime/node/bin/node"

export ORCHESTRATOR_HOME
exec "${NODE_BIN}" "${ORCHESTRATOR_HOME}/app/src/backup-state.ts" create --summary-text
