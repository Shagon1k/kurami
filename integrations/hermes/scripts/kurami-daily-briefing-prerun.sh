#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly KURAMI_HOME="/home/shagon1k/_hermes/_kurami"
readonly NODE_BIN="${KURAMI_HOME}/runtime/node/bin/node"
readonly CLI_JS="${KURAMI_HOME}/app/dist/briefing/cli.js"
readonly READ_ENV="${KURAMI_HOME}/connectors/external/composio-read-session/.env"
readonly LOCAL_DATE="$(TZ=Europe/Vilnius date +%F)"

if [[ ! -x "${NODE_BIN}" || ! -r "${CLI_JS}" || ! -r "${READ_ENV}" ]]; then
  echo '{"ok":false,"gate":"live-collector","error":"runtime_unavailable"}'
  exit 78
fi

set -a
# shellcheck disable=SC1090
source "${READ_ENV}"
set +a

cd "${KURAMI_HOME}/app"
exec "${NODE_BIN}" --jitless "${CLI_JS}" collect-live --id "daily:${LOCAL_DATE}"
