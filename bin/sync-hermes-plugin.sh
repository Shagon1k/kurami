#!/usr/bin/env bash
# Keep the installed Hermes Discord plugin equal to the tracked copy.
# --apply copies files only; Hermes loads the plugin when hermes-gateway restarts.
set -euo pipefail

usage() {
  printf 'Usage: %s --check|--apply\n' "$(basename "$0")" >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

mode="$1"
if [[ "${mode}" != "--check" && "${mode}" != "--apply" ]]; then
  usage
  exit 2
fi

readonly script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly repo_root="$(cd -- "${script_dir}/.." && pwd -P)"
readonly plugin="kurami-discord-controls"
readonly source="${repo_root}/integrations/hermes/plugins/${plugin}/"
readonly hermes_home="${HERMES_HOME:-/home/shagon1k/_hermes/_core}"
readonly target="${hermes_home}/plugins/${plugin}/"
readonly -a rsync_args=(--recursive --checksum --delete --exclude='__pycache__/' --exclude='*.pre-*')

if [[ ! -f "${source}/plugin.yaml" ]]; then
  printf 'Tracked plugin source is missing: %s\n' "${source}" >&2
  exit 1
fi
if [[ ! -d "${hermes_home}/plugins" ]]; then
  printf 'Hermes plugin directory is missing: %s\n' "${hermes_home}/plugins" >&2
  exit 1
fi
if find "${source}" -type f \( -name '.env' -o -name '*.db' -o -name '*.pem' -o -name '*.key' \) -print -quit | grep -q .; then
  printf 'Forbidden runtime or secret file found in %s\n' "${plugin}" >&2
  exit 1
fi

if [[ "${mode}" == "--check" ]]; then
  changes="$(rsync "${rsync_args[@]}" --dry-run --itemize-changes -- "${source}" "${target}")"
  if [[ -n "${changes}" ]]; then
    printf '%s: drift\n%s\n' "${plugin}" "${changes}"
    exit 1
  fi
  printf '%s: synchronized\n' "${plugin}"
  exit 0
fi

install -d -m 0755 -- "${target}"
rsync "${rsync_args[@]}" -- "${source}" "${target}"
remaining="$(rsync "${rsync_args[@]}" --dry-run --itemize-changes -- "${source}" "${target}")"
if [[ -n "${remaining}" ]]; then
  printf 'Post-sync verification failed for %s\n%s\n' "${plugin}" "${remaining}" >&2
  exit 1
fi
printf '%s: installed; restart hermes-gateway to load it\n' "${plugin}"
