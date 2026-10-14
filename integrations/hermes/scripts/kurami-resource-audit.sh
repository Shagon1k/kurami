#!/usr/bin/env bash
set -Eeuo pipefail
export KURAMI_HOME="${KURAMI_HOME:-/home/shagon1k/_hermes/_kurami}"
export HERMES_HOME="${HERMES_HOME:-/home/shagon1k/_hermes/_core}"
# Collect host metadata, then start an independent Hermes session with zero tools.
# The script stores reports; it has no cleanup mode or approval-to-delete handler.
exec nice -n 19 ionice -c3 "${HERMES_HOME}/hermes-agent/venv/bin/python" \
  "${KURAMI_HOME}/app/bin/resource-audit.py" run --home "${KURAMI_HOME}" --hermes-home "${HERMES_HOME}"
