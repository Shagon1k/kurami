---
name: kurami-project-readiness
description: Read-only compatibility assessment for a project registered with Kurami Orchestrator. Use when Alex asks whether a project is ready, compatible, correctly configured, or safe to onboard. Reports PASS/WARN/FAIL without changing GitHub, Discord, Git, SQLite, files, services, or settings.
---

# Kurami Project Readiness

Use this skill only to inspect compatibility. It has no apply, repair, onboarding,
or mutation path.

Use only these fixed production paths:

```text
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_kurami
NODE=/home/shagon1k/_hermes/_kurami/runtime/node/bin/node
CHECKER=/home/shagon1k/_hermes/_kurami/app/src/project-readiness.ts
```

## Resolve the project

Accept only an exact configured registry key matching `^[a-z0-9-]+$`. Current
keys are discovered by running the config-only checker without `--project`; do
not infer a key from a repository title or conversation memory.

For one configured project, run config validation first:

```text
ORCHESTRATOR_HOME=$ORCHESTRATOR_HOME $NODE $CHECKER --project <key> --json
```

If that returns zero failures and the owner asked for live verification, run:

```text
ORCHESTRATOR_HOME=$ORCHESTRATOR_HOME $NODE $CHECKER --project <key> --live --json
```

The live mode is still read-only. It may read the configured GitHub repository,
Project fields/options, base-branch check runs, workspace path existence, Compose
file existence, and preview-secret file existence. It never reads secret file
contents and never prints credentials.

Never add `--apply`, run a poller, edit configuration, create a Project field,
change a status, start a run, create a worktree, or repair a failed check. The
checker intentionally has no mutation option. Never substitute raw GitHub, Git,
SQLite, Discord, Docker, tmux, or filesystem mutation commands.

## Interpret the result

- `PASS`: the required fact was proven.
- `WARN`: compatibility may be acceptable, but an optional capability or live
  proof needs an explicit owner decision.
- `FAIL`: do not describe the project as ready and do not start onboarding.

Summarize results by subsystem: identity/Project, workspace, Discord, CI, triage,
preview, and live evidence. Preserve exact failed or warned check messages, but
do not dump the full registry or any environment values.

An exact CI name missing from base-branch check runs is a warning because some
checks run only on pull requests. Tell the owner to confirm the configured names
against a representative PR. A GitHub read failure is not proof that credentials
are invalid; distinguish network reachability, authentication, and missing scopes.

Project readiness does not authorize onboarding. After PASS, offer the documented
onboarding exit checklist in `app/docs/project-readiness.md` and wait for an
explicit request before any production or external mutation.
