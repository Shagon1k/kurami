#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly ORCHESTRATOR_HOME="/home/shagon1k/_hermes/_orchestrator"
readonly NODE_BIN="${ORCHESTRATOR_HOME}/runtime/node/bin/node"
readonly HERMES_HOME="/home/shagon1k/_hermes/_core"
readonly HEALTH_DELIVERY="${ORCHESTRATOR_HOME}/app/src/system-health-discord.ts"

export ORCHESTRATOR_HOME
export HERMES_HOME
export PATH="${ORCHESTRATOR_HOME}/runtime/node/bin:/usr/local/bin:/usr/bin:/bin"
exec "${NODE_BIN}" "${HEALTH_DELIVERY}" --alerts
