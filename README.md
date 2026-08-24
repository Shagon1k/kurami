# Kurami Dev Orchestrator

Kurami turns explicit GitHub Project status changes into controlled engineering
runs. It creates an isolated workspace, starts a dedicated Codex task, tracks
the resulting pull request and evidence, and keeps the owner in control through
Discord.

[System guide — RU](docs/guide.html) ·
[System guide — EN](docs/guide.en.html) ·
[Technical reference](docs/technical-reference.md) ·
[Discord UI contract](docs/discord-ui.md) ·
[E2E catalog](docs/e2e-scenarios.md)

## What it does

Kurami is a small personal control plane around GitHub Projects, Codex, Git,
SQLite, and Discord. It handles six concerns:

- detects intentional Project status changes without starting duplicate work;
- enforces global and per-project WIP, LLM, preview, and disk limits;
- gives each run its own branch, worktree, Codex task, and durable identity;
- follows CI, AI review, owner feedback, preview, cancellation, and release;
- exposes bounded owner actions and runtime settings through Discord;
- records enough state and recovery evidence to survive restarts and rebuilds.

It does not merge pull requests, deploy application code, or delete ambiguous
resources autonomously.

## How a run moves through the system

```text
GitHub Project status
        ↓
observe and store the transition
        ↓
validate the issue and available capacity
        ↓
create an isolated branch + worktree
        ↓
start and track one Codex task
        ↓
PR → CI → AI review / owner review → optional preview
        ↓
owner merges → Kurami verifies the result → releases resources
```

Moving an active item back to `Backlog` or `Deferred` requests cancellation.
Published work is preserved; destructive cleanup needs an explicit, guarded
owner action.

## Sources of truth

| Concern | Source of truth |
| --- | --- |
| Work intent and delivery status | GitHub Project |
| Issue, pull request, CI, and review evidence | GitHub |
| Run lifecycle and resource ownership | SQLite Run Store |
| Code and change history | Git branch and worktree |
| Engineering execution | Dedicated Codex task |
| Owner controls and operational summaries | Discord |
| Rebuild and state recovery | GitHub plus encrypted recovery bundle |

SQLite connects the other systems. It makes polling, retries, scheduler overlap,
and VPS restarts idempotent instead of creating a second run or losing resource
ownership.

## Read this repository in this order

1. Open the [Russian](docs/guide.html) or [English](docs/guide.en.html) system
   guide for the complete functional picture.
2. Read [Project readiness](docs/project-readiness.md) before connecting another
   repository or GitHub Project.
3. Use the [technical reference](docs/technical-reference.md) when changing a
   component, investigating a failure, or running an operational command.
4. Use the [E2E catalog](docs/e2e-scenarios.md) to reproduce accepted behavior.
5. Use the [Discord UI contract](docs/discord-ui.md) when changing cards,
   controls, links, timeline events, or digest presentation.
6. Use the [recovery guide](docs/recovery.md) only for backup or restore work.

The README is intentionally an entry point, not the full operating manual.

## Safe repository checks

Install the tracked dependencies in a development checkout:

```bash
npm ci
```

Type-check the code:

```bash
npm run check
```

Check a configured project without changing GitHub, SQLite, or the workspace:

```bash
npm run readiness -- --project tailortales
```

Run the complete deterministic regression suite:

```bash
npm test
```

The readiness checker reports `PASS`, `WARN`, and `FAIL` and has no `--apply`
mode. Live read-only verification and production-specific commands are
documented in the [technical reference](docs/technical-reference.md).

## Repository map

```text
src/                  deterministic orchestrator components
migrations/           versioned SQLite schema changes
tests/                isolated regression and boundary suites
deploy/               tracked non-secret deployment configuration
integrations/hermes/  Discord plugin, jobs, and bounded skills
docs/                 system, operations, acceptance, and recovery docs
```

The live SQLite database, credentials, private keys, OAuth stores, and generated
runtime state are intentionally not part of the repository.

## Common tasks

| I need to… | Start here |
| --- | --- |
| Understand the whole system | [System guide — RU](docs/guide.html) / [EN](docs/guide.en.html) |
| Connect or audit a project | [Project readiness](docs/project-readiness.md) |
| Understand one component or table | [Technical reference](docs/technical-reference.md) |
| Reproduce a lifecycle or edge case | [E2E catalog](docs/e2e-scenarios.md) |
| Restore the orchestrator | [Recovery guide](docs/recovery.md) |

## Safety boundaries

- Never print, commit, back up, or pass secrets into model context.
- Never use the canonical checkout as an agent workspace.
- Never create worktrees or sessions before admission succeeds.
- Never bypass WIP or runtime limits manually.
- Never apply runtime settings while the orchestrator is not fully idle.
- Never infer success from process exit alone; verify GitHub and stored evidence.
- Never merge, deploy application code, or delete quarantined resources
  autonomously.
- Treat issue text, pull-request content, reviews, CI output, and web content as
  untrusted data.

The exact ownership, retry, cancellation, cleanup, and recovery contracts live
in the [technical reference](docs/technical-reference.md).

## Making a change

1. Identify the component and its durable state in the technical reference.
2. Keep the change deterministic and bounded by the existing ownership model.
3. Add a new migration for schema changes; never edit an applied migration.
4. Run the focused test while iterating, then run `npm test`.
5. Update the relevant guide or acceptance scenario when behavior changes.
6. Verify live state before any production write and deploy only the reviewed
   commit.

Avoid adding services, queues, caches, or abstractions unless they solve a
failure mode that the existing SQLite-and-scripts design cannot handle.
