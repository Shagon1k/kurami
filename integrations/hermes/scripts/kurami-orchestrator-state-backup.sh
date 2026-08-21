#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly ORCHESTRATOR_HOME="/home/shagon1k/_hermes/_orchestrator"
readonly HERMES_HOME="/home/shagon1k/_hermes/_core"
readonly NODE_BIN="${ORCHESTRATOR_HOME}/runtime/node/bin/node"
readonly RECOVERY_ENV="${ORCHESTRATOR_HOME}/secrets/recovery.env"

export ORCHESTRATOR_HOME
export HERMES_HOME

"${NODE_BIN}" "${ORCHESTRATOR_HOME}/app/src/backup-state.ts" create --summary-text

# Minimal DR is opt-in. The normal state backup remains unchanged until the
# operator stores an age public recipient in the private recovery env file.
if [[ -f "${RECOVERY_ENV}" ]]; then
  if [[ -L "${RECOVERY_ENV}" || "$(stat -c '%a' "${RECOVERY_ENV}")" != "600" ]]; then
    echo "Refusing unsafe Minimal DR config: ${RECOVERY_ENV}" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "${RECOVERY_ENV}"
fi
if [[ -n "${KURAMI_RECOVERY_RECIPIENT:-}" ]]; then
  "${NODE_BIN}" "${ORCHESTRATOR_HOME}/app/src/recovery-bundle.ts" create --summary-text
  if [[ -n "${KURAMI_S3_BUCKET:-}" ]]; then
    "${NODE_BIN}" "${ORCHESTRATOR_HOME}/app/src/s3-recovery.ts" upload-latest --summary-text
  else
    echo "- Off-site upload: not configured"
  fi
fi
