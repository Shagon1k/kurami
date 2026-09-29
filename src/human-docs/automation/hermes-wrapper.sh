#!/usr/bin/env bash
set -Eeuo pipefail

# Install a copy under the active Hermes profile's scripts directory. Only a
# dedicated audit checkout may be configured here, never the application tree.
if [[ "$(TZ=Europe/Vilnius date +%u%H)" != "106" ]]; then
  printf '{"wakeAgent":false}\n'
  exit 0
fi

: "${KURAMI_DOCS_AUDIT_CHECKOUT:?Set a dedicated clean Kurami audit checkout}"
cd -P -- "${KURAMI_DOCS_AUDIT_CHECKOUT}"
if [[ "$(git rev-parse --show-toplevel)" != "${PWD}" ]]; then
  printf 'Audit checkout must be the Git worktree root\n' >&2
  exit 1
fi
# A standalone clone has its own .git directory. The local, untracked marker
# must be installed deliberately; a worktree or the application checkout must
# not be used as the scheduler's auto-updating source.
if [[ ! -d .git || ! -f .git/kurami-docs-audit ]] || [[ "$(<.git/kurami-docs-audit)" != "kurami-docs-audit-v1" ]]; then
  printf 'Audit checkout must be a dedicated marked clone\n' >&2
  exit 1
fi
if [[ "$(git symbolic-ref --quiet --short HEAD)" != "main" ]]; then
  printf 'Audit checkout must be on main\n' >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  printf 'Audit checkout must be clean\n' >&2
  exit 1
fi

# Fail on a rewritten/divergent main; never update the application checkout.
GIT_TERMINAL_PROMPT=0 git -c core.hooksPath=/dev/null fetch --quiet --no-tags origin refs/heads/main:refs/remotes/origin/main
git -c core.hooksPath=/dev/null merge --ff-only --quiet refs/remotes/origin/main
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse refs/remotes/origin/main)" ]]; then
  printf 'Audit checkout main must exactly match origin/main\n' >&2
  exit 1
fi
exec node ./src/human-docs/automation/cron-payload.ts
