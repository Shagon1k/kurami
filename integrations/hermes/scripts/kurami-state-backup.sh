#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly KURAMI_HOME="/home/shagon1k/_hermes/_kurami"
readonly HERMES_HOME="/home/shagon1k/_hermes/_core"
readonly NODE_BIN="${KURAMI_HOME}/runtime/node/bin/node"
readonly RECOVERY_ENV="${KURAMI_HOME}/secrets/recovery.env"

export KURAMI_HOME
export ORCHESTRATOR_HOME="${KURAMI_HOME}"
export HERMES_HOME

"${NODE_BIN}" "${KURAMI_HOME}/app/src/system/recovery/backup-state.ts" create --summary-text

# Minimal DR is opt-in. The normal state backup remains unchanged until the
# operator stores an age public recipient in the private recovery env file.
if [[ -f "${RECOVERY_ENV}" ]]; then
  if [[ -L "${RECOVERY_ENV}" || "$(stat -c '%a' "${RECOVERY_ENV}")" != "600" ]]; then
    echo "Refusing unsafe Minimal DR config: ${RECOVERY_ENV}" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "${RECOVERY_ENV}"
  set +a
fi
if [[ -n "${KURAMI_RECOVERY_RECIPIENT:-}" ]]; then
  "${NODE_BIN}" "${KURAMI_HOME}/app/src/system/recovery/recovery-bundle.ts" create --summary-text
  if [[ -n "${KURAMI_S3_BUCKET:-}" ]]; then
    "${NODE_BIN}" "${KURAMI_HOME}/app/src/system/recovery/s3-recovery.ts" upload-latest --summary-text
  else
    echo "- Off-site upload: not configured"
  fi
fi
