#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly KURAMI_HOME="/home/shagon1k/_hermes/_kurami"
readonly NODE_BIN="${KURAMI_HOME}/runtime/node/bin/node"
readonly HERMES_HOME="/home/shagon1k/_hermes/_core"
readonly HEALTH_DELIVERY="${KURAMI_HOME}/app/src/system/health/system-health-discord.ts"

export KURAMI_HOME
export ORCHESTRATOR_HOME="${KURAMI_HOME}"
export HERMES_HOME
export PATH="${KURAMI_HOME}/runtime/node/bin:/usr/local/bin:/usr/bin:/bin"
exec "${NODE_BIN}" "${HEALTH_DELIVERY}" --run
