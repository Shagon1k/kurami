#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly KURAMI_HOME="/home/shagon1k/_hermes/_kurami"
readonly NODE_BIN="${KURAMI_HOME}/runtime/node/bin/node"
readonly POLLER_JS="${KURAMI_HOME}/app/dist/briefing/poller.js"
readonly STATE_DIR="${KURAMI_HOME}/state/briefing"
readonly LOCK_PATH="${STATE_DIR}/.central-poller.lock"

if [[ ! -x "${NODE_BIN}" ]]; then
  echo "Kurami pinned Node runtime is unavailable" >&2
  exit 78
fi
if [[ ! -r "${POLLER_JS}" ]]; then
  echo "Digest Central Poller build is unavailable" >&2
  exit 78
fi
if [[ -z "${COMPOSIO_READ_MCP_URL:-}" || -z "${COMPOSIO_READ_API_KEY:-}" ]]; then
  echo "Restricted Composio read runtime is unavailable" >&2
  exit 78
fi
if [[ "${COMPOSIO_READ_MCP_URL}" != https://* ]]; then
  echo "Restricted Composio read MCP endpoint must use HTTPS" >&2
  exit 78
fi

mkdir -p "${STATE_DIR}"
exec 9>"${LOCK_PATH}"
if ! flock -n 9; then
  # A healthy previous poll still owns the lock. Overlap is a no-op, not an error.
  exit 0
fi

cd "${KURAMI_HOME}/app"
exec "${NODE_BIN}" "${POLLER_JS}" --apply --quiet
