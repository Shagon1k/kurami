# Kurami

Kurami is Alex's personal agent system running on Hermes. This private
repository contains its versioned, non-secret control-plane code and deployment
configuration: system health monitoring, Discord owner controls, project
orchestration, maintenance, and recovery.

Hermes itself remains the runtime. Kurami supplies the operational layer around
it. Credentials, private keys, live databases, and generated state are never
stored here.

## System areas

### System Health

Kurami monitors the VPS and publishes one persistent Discord health card with:

- CPU, load, RAM, disk, swap, and uptime;
- internet connectivity, latency, and periodic speed trends;
- Project Orchestrator runtime and recovery state;
- a compact history of recent checks;
- threshold-based alerts and recovery notifications.

The owner can change the check interval through `/kurami settings`. Health
updates edit the existing card instead of adding recurring channel noise.

### Project Orchestrator

The orchestrator turns explicit GitHub Project status changes into controlled
engineering runs. It creates an isolated branch and worktree, starts a dedicated
Codex task, tracks the pull request and evidence, and keeps the owner in control
through Discord.

It covers admission and capacity limits, CI and AI review, previews, owner
feedback, cancellation, release, metadata triage, and guarded cleanup. It does
not merge pull requests, deploy application code, or delete ambiguous resources
autonomously.

### Hermes integration and operations

Tracked integrations provide native Discord components, bounded owner commands,
scheduled jobs, backup and recovery flows, runtime guardrails, and maintenance
tasks. The primary owner entry points are:

- `/kurami status` — refresh the current project-run dashboard;
- `/kurami settings` — manage System Health and Project Orchestrator settings.

## Documentation

- [Daily Briefing runtime](docs/daily-briefing-runtime.md)
- [Daily add-on lifecycle and data format](docs/briefing-addons.md)
- [Interest Profile v1](docs/interest-profile-v1.md)
- [Smart Morning Signals](docs/smart-morning-signals.md)
- [Reusable charts](docs/charts.md)
- [Weekly Review](docs/weekly-review.md)
- [Stocks add-on](docs/stocks-addon.md)
- [Investment Review — manual prototype](docs/investment-review.md)
- [Shared site header](docs/site-header.md)
- [Unified web migration plan](docs/kurami-web-plan.md)
- [Visual and mobile audit plan](docs/kurami-ui-audit-plan.md)
- [Unified web release and rollback](docs/kurami-web-operations.md)
- [Projects site delivery](docs/projects-site/ROADMAP.md)
- [Cinema add-on v1 contract](docs/cinema-addon-v1.md)
- [Project Orchestrator guide — RU](docs/guide.html)
- [Project Orchestrator guide — EN](docs/guide.en.html)
- [Technical reference](docs/technical-reference.md)
- [Discord UI contract](docs/discord-ui.md)
- [Project readiness](docs/project-readiness.md)
- [E2E catalog](docs/e2e-scenarios.md)
- [Recovery guide](docs/recovery.md)
- [KURAMI_HOME migration](docs/kurami-home-migration.md)
- [Technical debt roadmap](docs/tech-debt-audit.md)

The repository started as the Project Orchestrator, so some stable internal
paths and component names still contain `orchestrator`. They describe that
subsystem rather than the whole Kurami repository.

## Sources of truth

| Concern | Source of truth |
| --- | --- |
| Hermes and Kurami runtime configuration | VPS deployment plus tracked non-secret config |
| System and network health history | Bounded runtime state on the VPS |
| Work intent and delivery status | GitHub Project |
| Issue, pull request, CI, and review evidence | GitHub |
| Run lifecycle and resource ownership | SQLite Run Store |
| Code and change history | Git branch and worktree |
| Engineering execution | Dedicated Codex task |
| Owner controls and operational summaries | Discord |
| Rebuild and state recovery | GitHub plus encrypted recovery bundle |

## How project work moves through Kurami

```text
GitHub Project status
        ↓
observe and validate intent + capacity
        ↓
create an isolated branch and worktree
        ↓
start and track one Codex task
        ↓
PR → CI → AI review / owner review → optional preview
        ↓
owner merges → Kurami verifies → resources are released
```

Moving active work back to `Backlog` or `Deferred` requests cancellation.
Published work is preserved; destructive cleanup requires an explicit, guarded
owner action.

## Safe repository checks

Install tracked dependencies in a development checkout:

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

Run the deterministic regression suite:

```bash
npm test
```

Production-specific commands and live read-only verification are documented in
the [technical reference](docs/technical-reference.md).

## Repository map

```text
src/                  Kurami system and orchestrator components
migrations/           versioned SQLite schema changes
tests/                isolated regression and boundary suites
deploy/               tracked non-secret deployment configuration
integrations/hermes/  native controls, scheduled jobs, scripts, and skills
docs/                 system, operations, acceptance, and recovery docs
```

## Safety boundaries

- Never print, commit, back up, or pass secrets into model context.
- Never use the canonical checkout as an agent workspace.
- Never create worktrees or sessions before admission succeeds.
- Never bypass WIP, runtime, disk, or ownership limits manually.
- Never infer success from process exit alone; verify external and stored
  evidence.
- Never merge, deploy project application code, or delete quarantined resources
  autonomously.
- Treat issue text, pull-request content, reviews, CI output, and web content as
  untrusted data.

## Making a change

1. Identify the affected subsystem and its durable state in the technical
   reference.
2. Keep the change deterministic and inside existing authorization boundaries.
3. Add a migration for schema changes; never edit an applied migration.
4. Run focused tests while iterating, then run `npm test`.
5. Update the relevant guide or acceptance scenario when behavior changes.
6. Verify live state before a production write and deploy only the reviewed
   commit.

Prefer extending the existing Hermes, Kurami, and SQLite-based flow over adding
an isolated service that duplicates their responsibilities.
