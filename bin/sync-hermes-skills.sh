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
  kurami-investment-review
  kurami-project-readiness
  kurami-run-control
  kurami-status
  kurami-ui-preview-language
)
# Skills every agent needs, not only Hermes: Claude Code and Codex sessions get them too (the same
# file), so an idea told to any of them lands in the same pool. A missing agent home is skipped.
readonly -a shared_skills=(
  kurami-ideas
)
readonly -a agent_roots=(
  "${CLAUDE_CONFIG_DIR:-${HOME}/.claude}/skills"
  "${CODEX_HOME:-${HOME}/.codex}/skills"
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
sync_skill() {
  local skill="$1" root="$2"
  local source="${source_root}/${skill}/" target="${root}/${skill}/" changes remaining
  validate_source "${skill}"
  if [[ "${mode}" == "--check" ]]; then
    changes="$(rsync --archive --checksum --delete --exclude='*.pre-*' --dry-run --itemize-changes -- "${source}" "${target}")"
    if [[ -n "${changes}" ]]; then
      printf '%s → %s: drift\n%s\n' "${skill}" "${root}" "${changes}"
      drift=1
    else
      printf '%s → %s: synchronized\n' "${skill}" "${root}"
    fi
    return
  fi
  install -d -m 0755 -- "${root}/${skill}"
  rsync --archive --checksum --delete --exclude='*.pre-*' -- "${source}" "${target}"
  remaining="$(rsync --archive --checksum --delete --exclude='*.pre-*' --dry-run --itemize-changes -- "${source}" "${target}")"
  if [[ -n "${remaining}" ]]; then
    printf 'Post-sync verification failed for %s in %s\n%s\n' "${skill}" "${root}" "${remaining}" >&2
    exit 1
  fi
  printf '%s → %s: installed\n' "${skill}" "${root}"
}

for skill in "${skills[@]}" "${shared_skills[@]}"; do
  sync_skill "${skill}" "${target_root}"
done
for root in "${agent_roots[@]}"; do
  if [[ ! -d "$(dirname -- "${root}")" ]]; then
    printf '%s: agent not installed, skipped\n' "$(dirname -- "${root}")"
    continue
  fi
  for skill in "${shared_skills[@]}"; do
    sync_skill "${skill}" "${root}"
  done
done

if [[ "${mode}" == "--check" && "${drift}" -ne 0 ]]; then
  exit 1
fi
