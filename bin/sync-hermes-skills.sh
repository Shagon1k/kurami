#!/usr/bin/env bash
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
readonly source_root="${repo_root}/integrations/hermes/skills"
readonly hermes_home="${HERMES_HOME:-/home/shagon1k/_hermes/_core}"
readonly target_root="${hermes_home}/skills"
readonly -a skills=(
  kurami-daily-briefing
  kurami-ideas
  kurami-investment-review
  kurami-project-readiness
  kurami-run-control
  kurami-ui-preview-language
)

if [[ ! -d "${source_root}" ]]; then
  printf 'Tracked skill source is missing: %s\n' "${source_root}" >&2
  exit 1
fi
if [[ ! -d "${target_root}" ]]; then
  printf 'Hermes skill directory is missing: %s\n' "${target_root}" >&2
  exit 1
fi
if ! command -v rsync >/dev/null 2>&1; then
  printf 'rsync is required\n' >&2
  exit 1
fi

validate_source() {
  local skill="$1"
  local source="${source_root}/${skill}"

  if [[ ! -f "${source}/SKILL.md" ]]; then
    printf 'Missing SKILL.md for %s\n' "${skill}" >&2
    return 1
  fi
  if ! grep -Fqx "name: ${skill}" "${source}/SKILL.md"; then
    printf 'Frontmatter name does not match directory for %s\n' "${skill}" >&2
    return 1
  fi
  if find "${source}" -type f \( -name '.env' -o -name '*.db' -o -name '*.sqlite' -o -name '*.pem' -o -name '*.key' \) -print -quit | grep -q .; then
    printf 'Forbidden runtime or secret file found in %s\n' "${skill}" >&2
    return 1
  fi
}

drift=0
for skill in "${skills[@]}"; do
  validate_source "${skill}"
  source="${source_root}/${skill}/"
  target="${target_root}/${skill}/"

  if [[ "${mode}" == "--check" ]]; then
    changes="$(rsync --archive --checksum --delete --exclude='*.pre-*' --dry-run --itemize-changes -- "${source}" "${target}")"
    if [[ -n "${changes}" ]]; then
      printf '%s: drift\n%s\n' "${skill}" "${changes}"
      drift=1
    else
      printf '%s: synchronized\n' "${skill}"
    fi
    continue
  fi

  install -d -m 0755 -- "${target_root}/${skill}"
  rsync --archive --checksum --delete --exclude='*.pre-*' -- "${source}" "${target}"
  remaining="$(rsync --archive --checksum --delete --exclude='*.pre-*' --dry-run --itemize-changes -- "${source}" "${target}")"
  if [[ -n "${remaining}" ]]; then
    printf 'Post-sync verification failed for %s\n%s\n' "${skill}" "${remaining}" >&2
    exit 1
  fi
  printf '%s: installed\n' "${skill}"
done

if [[ "${mode}" == "--check" && "${drift}" -ne 0 ]]; then
  exit 1
fi
