---
title: Directories, processes and deploys
nav: Directories and deploys
summary: Where code, state and secrets live on the server, how services are restricted, which Node is pinned and what to do after changing each part.
section: platform
group: internals
order: 20
next: health-internals
---

All of Kurami lives in one directory, `$KURAMI_HOME`, and everything that belongs to Hermes lies next to it in `$HERMES_HOME`. One reference point exists so that you do not have to guess which copy of code and state is the real one: the directory must be a real directory, not a link, and it is determined in one place in the code.

:::glance
- Root: `$KURAMI_HOME`; if the variable is unset, the parent of the `app/` directory is used
- Code: `app/` — an ordinary checkout of `main`; `app/dist/` — the built Digest
- State: `state/` — databases, JSON files, locks; secrets — `secrets/` with mode 0600
- Processes: app services, ingress, the CPU sampler and two Digest timers under `systemd --user`
- Runtime: a pinned Node 24, Caddy, age, LibreSpeed in `runtime/`
- Deploy: owner-confirmed unified release through Hub or the deploy CLI
:::

## Directories

```diagram
kind: graph
title: What lies in $KURAMI_HOME
desc: The root holds the app code, pinned runtime programs, configuration, mutable state, secrets, backups, recovery archives, logs and connectors. Of these only state, backups, recovery and logs grow while the system runs.
node app "app" "code and dist" at 0,0
node runtime "runtime" "Node, Caddy, age" at 1,0
node config "config" "copy of deploy/config" at 2,0
node state "state" "databases, JSON, locks" store at 0,1
node secrets "secrets" "mode 0600" at 1,1
node connectors "connectors" "Composio, Telegram" at 2,1
node backups "backups" "14 snapshots" store at 0,2
node recovery "recovery" "3 archives" store at 1,2
node logs "logs" "job logs" store at 2,2
group home "$KURAMI_HOME" app runtime config state secrets connectors backups recovery logs
```

| Directory | Contents | Written by |
|---|---|---|
| `app/` | the repository; `dist/` is the result of `npm run briefing:build` | owner-confirmed deployment controller |
| `runtime/` | Node v24, Caddy, age, `tools/librespeed-cli`, uv | you, at install |
| `config/` | copies of `orchestrator.yaml`, `projects.yaml`, `Caddyfile`, `briefing.yaml` | you, from `deploy/config/` |
| `state/` | see the table below | jobs and services |
| `secrets/` | GitHub tokens, `recovery.env`; no document reads the values | you |
| `connectors/` | the `.env` of the three Composio sessions and Telegram MCP data | connector scripts |
| `backups/` | `backup-<UTC>/`: database snapshots, settings files, a manifest | the backup job |
| `recovery/` | `kurami-recovery-<UTC>.tar.zst.age` and `.sha256` | the backup job |
| `logs/` | `*.log` and `*.jsonl` per subsystem | scripts; deleted after 90 days |

## What is in `state/`

The JSON files are small and written atomically (a temporary file, then a rename) with mode 0600.

Compose previews keep private runtime files under `state/previews/<run_id>/`. In `runtime.env`, `PREVIEW_FRONTEND_PORT` and `FRONTEND_PORT` hold the same allocated frontend port; `PREVIEW_BACKEND_PORT` and `BACKEND_PORT` hold the backend port. The source Compose snapshot stays beside this file for cleanup; the adapter change applies when a new runtime is generated.

| File or directory | What it holds | Written by | Read by |
|---|---|---|---|
| `orchestrator.db` | the Run Store | Project Orchestrator | health, Hub (read-only), backup |
| `system-health.db` | the health cycle: measurements, streaks, pending alert messages | the health collector | health delivery, Hub (read-only), backup |
| `hub/control-audit.jsonl` | one short record per Hub control action | Hub | you, for review |
| `briefing/` | the Digest database, pages, media | Digest | the Digest site |
| `human-docs/` | `release/`, `rollback-<sha>/`, `proposals.db`, drafts | the docs worker | the docs server |
| `caddy/routes.caddy` | preview routes | route builder | Caddy |
| `cpu-statistics.json` | up to 1440 CPU samples | the sampler | the health check |
| `network-speed.json` | the latest speed sample | the speed job | the health check |
| `runtime-health-*.json`, `system-health-*.json`, `health-settings.json` | projections of the health cycle, the card id, the check interval | the health collector and delivery; the interval by `/kurami settings` or Hub | the health check and the plugin (details in [How monitoring works](@health-internals)) |
| `*.lock` | job locks | wrappers via `flock` | themselves |

A lock is an empty file: a script takes it with `flock` without waiting and, if it is taken, quietly exits. That is how overlapping runs stay out of each other's way. The shared lock `project-event-consumer.lock` is held for the whole "events, controller, notifications" pass, while the poll and Projects Digest locks are their own.

## systemd services

All services run as your user (`systemd --user`) and get the same set of restrictions, differing only in where they may write.

| Service | Port | May write to | Note |
|---|---|---|---|
| `kurami-briefing` | 8787 | `state/briefing` | `node --jitless`, the built `dist/`, `MemoryDenyWriteExecute` |
| `kurami-human-docs` | 8799 | nowhere | starts only if `release/build.json` exists |
| `kurami-hub` | 8800 | `state`, `connectors`, the Codex directory and the Hermes home | starts only if `orchestrator.db` exists; the write paths serve the Hub controls |
| `kurami-projects` | 8777 | `state` | guarded project controls and read models |
| `kurami-web` | 8888 | nowhere in the tracked unit | signed Access gateway to all four apps |
| `kurami-preview-ingress` | 9180 | `state/caddy` | validates its configuration before starting |
| `kurami-cpu-statistics` | — | `state` | Unix sockets only, no network |

The restrictions are common: `ProtectSystem=strict` (the filesystem is read-only), `ProtectHome=read-only`, `NoNewPrivileges`, `PrivateTmp`, no new namespaces, `UMask=0077`. A service that writes nothing, such as the documentation server, gets no `ReadWritePaths` at all. Hub has a short list, because its controls update Kurami state, connector runtime files, the Codex configuration and the Hermes configuration; applying a changed unit and restarting Hub is a release step.

## The pinned Node and two ways to run

`runtime/node` holds one pinned version of Node 24. Digest is compiled into `dist/` and run with `--jitless`: its service forbids executable memory, and without JIT Node would otherwise not start. Because of this the global `fetch` does not work there, and Digest reaches the network through `node:http`. Everything else — health, backup, Hub, documentation — runs straight from TypeScript: Node 24 can execute `.ts` without a build.

## What to do after a change

The normal release path is [Hub → Server → Release](@hub) or the same deployment CLI, not a pull followed by ad-hoc restarts. It refuses dirty live work and a revision outside main, and requires a passed full regression receipt for the exact tree; otherwise it tests in a separate worktree first. The controller performs only required steps and records their outcomes. Rollback attempts to return code and services to the previous revision; it is not a database restore or proof of reversal of external actions. The table below explains dependencies for operator diagnosis.


```diagram
kind: sequence
title: Owner-controlled unified release
desc: The owner confirms a target revision. Deploy verifies exact-tree full regression evidence before changing the live checkout, then runs required migrations, builds, docs promotion, Hermes sync and service restarts. Drift is checked last; a failed release attempts rollback and records its outcome.
actor owner "Owner" owner
actor deploy "Deploy"
actor tests "Regression"
actor runtime "Runtime"
msg owner -> deploy "confirm main revision"
msg deploy -> tests "verify receipt or run all suites"
msg tests -> deploy "passed exact tree"
msg deploy -> runtime "checkout, migrations and builds"
msg deploy -> runtime "docs, sync and restarts"
self deploy "check drift; record outcome"
note deploy "failure: attempt rollback"
```

| What changed | Command | Takes effect |
|---|---|---|
| Digest (`src/briefing`, `src/core`) | `npm run briefing:build`, `systemctl --user restart kurami-briefing` | after the restart; the guard, the poll and Investment Review use the same `dist/` |
| A Hermes job script, the Discord plugin or skills | copied by hand or by the sync scripts, see [Kurami and Hermes](@hermes-integration) | scripts at the next run, skills in the next agent session, the plugin after a `hermes-gateway` restart |
| Code the jobs call (health, backup, controller) | update the checkout | at the next run |
| Hub, documentation, the CPU sampler | update the checkout and `systemctl --user restart <service>` | after the restart |
| The documentation site | a `docs-release` build and promotion into `release/` (usually through a proposal card) | after restarting `kurami-human-docs` |
| The UI library | `npm run ui:export` | refreshes the skill bundle |

GitHub Actions runs types, the documentation-impact declaration check and the full test suite on every PR, but deploys nothing.

::::example A Digest change (invented data)
:::steps
- **Owner** — merges a reviewed card change at commit `7f3a9c2`.
- **Owner** — confirms Release main in Hub.
- **Deploy** — checks full regression evidence for that exact tree, running missing tests before changing live code.
- **Deploy** — builds Digest, promotes the required docs artifact, synchronizes affected Hermes copies and restarts affected services.
- **Deploy** — checks release drift and records the outcome; a merged PR alone is not this receipt.
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| You forgot `briefing:build` | the service keeps running on the old `dist/` | build and restart |
| You updated the checkout but did not restart the service | the permanent service runs old code in memory, jobs already run new code | restart the service |
| No `release/build.json` | `kurami-human-docs` does not start | promote a documentation release |
| No `orchestrator.db` | `kurami-hub` does not start | `npm run db:init` or restore from a backup |
| `$KURAMI_HOME` renamed or replaced by a link | paths in scripts are not found | restore the real directory |

:::guarantees
- `$KURAMI_HOME` has one definition, and it cannot be replaced by a link.
- Services write only where their unit allows: documentation nowhere, Hub only to the paths its controls need.
- All state files are closed with mode 0600, JSON is written atomically.
- Application code does not update itself: a deploy is a manual action.
:::

:::code-map
- `src/system/deploy/deploy.ts` — unified release, regression gate and rollback outcome
- `src/system/test-receipts.ts` — exact-tree full regression evidence
- `src/core/kurami-home.ts` — the definition of `$KURAMI_HOME`
- `tsconfig.briefing-runtime.json` — what goes into `dist/`
- `deploy/systemd/` — all services and timers
- `deploy/config/` — the configuration copied into `config/`
- `integrations/hermes/scripts/` — job scripts and their locks
- `run-project-poller.sh` — an example of poll locks and the shared consumer
- `.github/workflows/regression.yml` — checks on every PR
:::


## CI policy promotion

When workflow job names change, update both the tracked project template and the live projects.yaml registry. Verify exact required check names on the current PR SHA through the normal observer and card refresh. For PickFlick PRs, UI smoke and Delivery gate replace the removed combined UI check; non-PR UI contract and visual jobs are validated by Delivery gate. A policy update does not clear existing repair failure history or waive failed security checks.

## Managed workspace defaults

Managed primary writers and protocol workers receive `pnpm_config_store_dir` pointing to `node_modules/.pnpm-store` inside their working copy. Package-store SQLite files stay within existing writable roots; the launcher does not open the shared home store or relax sandbox permissions. For personal GitHub Projects, worker prompts prefer direct `gh api graphql` reads using already-permitted access when the installed `gh project` commands require unavailable scopes. This guidance does not grant additional token scopes or prove that a stopped project run has resumed.

## Technical Codex worker lifecycle

CI repair and review fix use a private Codex app-server worker. The launcher retains tmux as a process supervisor, but completion comes from the exact persisted thread and turn event, not terminal screen text. The primary writer and Remote handoff retain their existing TUI route. Stop, timeout and initialization failures preserve task identity and require acknowledged process exit before ownership is released.
