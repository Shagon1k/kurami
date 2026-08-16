# Disaster recovery

This repository stores the Kurami Dev Orchestrator implementation and its
non-secret deployment assets. It is not a complete machine image.

## Recovery sources

- GitHub: private `Shagon1k/kurami-orchestrator` repository.
- Runtime backup: the newest verified directory under
  `/home/shagon1k/_hermes/_orchestrator/backups/`.
- Secrets: the operator-managed secret store or an offline copy. Secrets are
  intentionally excluded from Git and orchestrator backups.

The repository contains TypeScript source, migrations, tests, deployment
configuration, the Caddy unit, Hermes wrappers, the Discord control plugin, and
the run-control skill. It does not contain credentials, SQLite state, logs,
runtime binaries, Docker data, Codex sessions, the Hermes cron registry,
Cloudflare dashboard configuration, canonical project clones, or worktrees.

## Fixed deployment paths

```text
Linux user:       shagon1k
Orchestrator:     /home/shagon1k/_hermes/_orchestrator
Application:      /home/shagon1k/_hermes/_orchestrator/app
Hermes home:      /home/shagon1k/_hermes/_core
Project root:     /home/shagon1k/_projects
```

Restore to these paths unless all configuration and service files are reviewed
and changed together.

## Restore order

1. Install Git, GitHub CLI, tmux, Node.js, rootless Docker, `uidmap`,
   `dbus-user-session`, Cloudflare Tunnel, and Hermes prerequisites.
2. Clone this repository into the application path and run `npm ci` followed by
   `npm run check` with the pinned orchestrator Node runtime.
3. Copy `deploy/config/*` into the parent orchestrator `config/` directory and
   install `deploy/systemd/kurami-preview-ingress.service` as a user unit.
4. Install the tracked Hermes scripts, Discord plugin, and run-control skill
   from `integrations/hermes/` into the matching `$HERMES_HOME` directories.
5. Restore secrets with mode `0600` and owner `shagon1k:shagon1k`.
6. Restore the newest verified SQLite backup. Run `npm run db:init` instead only
   when historical run state is intentionally discarded.
7. Restore canonical project clones and verify every repository/path in
   `config/projects.yaml`.
8. Enable rootless Docker, Hermes Gateway, and preview ingress. Run
   `systemctl --user daemon-reload` before starting user units.
9. Recreate cron jobs from the inventory below. Do not reuse old job IDs.
10. Reconcile ingress and finish all validation before resuming pollers.

## Secret inventory

Restore and verify at least:

```text
/home/shagon1k/_hermes/_core/.env
/home/shagon1k/_hermes/_orchestrator/secrets/github.env
/home/shagon1k/_hermes/_orchestrator/secrets/tailortales-preview.env
```

Never print their values. Codex authentication and durable task metadata live
outside this repository; losing them does not corrupt the Run Store, but old
tasks may no longer be resumable in the desktop app.

## External control plane

Recreate or verify:

- GitHub Project fields, statuses, repositories, and permissions;
- the private Discord server, project and maintenance channels, bot
  permissions, owner allowlist, and channel IDs;
- Cloudflare Tunnel routes for `preview-1` through `preview-6`, matching
  `assets-preview-*` hosts, and `go.shagon1k.win`;
- the Caddy loopback listener on `9180` and admin endpoint on `2019`;
- Google OAuth redirect URIs for the TailorTales preview hosts;
- rootless Docker linger and user-service startup.

## Cron inventory

| Name | Schedule | Delivery |
| --- | --- | --- |
| `kurami-tailortales-poller` | `* * * * *` | local |
| `kurami-pickflick-poller` | `* * * * *` | local |
| `kurami-orchestrator-state-backup` | `15 3 */3 * *` | maintenance Discord channel |
| `kurami-orchestrator-runtime-health` | `17 * * * *` | alerts Discord channel |
| `kurami-orchestrator-health-heartbeat` | `20 */3 * * *` | health Discord channel |
| `kurami-orchestrator-monthly-maintenance` | `15 4 1 * *` | maintenance Discord channel |

The pollers remain separate because project events belong to different Discord
channels. Backup, health, and cleanup are generic orchestrator-wide jobs.

## Validation

From the application directory:

```bash
export ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator
export HERMES_HOME=/home/shagon1k/_hermes/_core
export PATH="$ORCHESTRATOR_HOME/runtime/node/bin:$PATH"

npm run check
npm run test:admission
npm run test:release
npm run test:preview-slots
npm run test:preview-ingress
npm run test:controls
npm run test:observer
npm run test:discord
KURAMI_DISCORD_PLUGIN_DIR="$HERMES_HOME/plugins/kurami-discord-controls" npm run test:discord-plugin
npm run test:backup
npm run test:runtime-health
npm run test:maintenance

npm run db:init
node src/runtime-health.ts
node src/preview-ingress.ts reconcile --apply
node src/notify-discord-controls.ts --apply
```

Verify the tracked skill is exactly what Hermes runs:

```bash
cmp integrations/hermes/skills/kurami-run-control/SKILL.md \
  "$HERMES_HOME/skills/kurami-run-control/SKILL.md"
cmp integrations/hermes/skills/kurami-run-control/agents/openai.yaml \
  "$HERMES_HOME/skills/kurami-run-control/agents/openai.yaml"
```

Then verify services and scheduler:

```bash
systemctl --user is-active docker.service
systemctl --user is-active hermes-gateway.service
systemctl --user is-active kurami-preview-ingress.service
HERMES_HOME="$HERMES_HOME" hermes cron status
docker system df
```

The healthy baseline is an integrity-clean SQLite database, rootless Docker,
no unexplained preview leases or Compose projects, synchronized ingress, six
active cron jobs, and no secrets in Git.

## Safety

- Keep pollers paused until validation completes.
- Release worktrees only through recorded merge evidence and the normal release
  handler.
- Never reconstruct a preview route without a matching Run Store lease.
- Do not copy old cron IDs, tmux PIDs, Docker IDs, or transient preview ports.
- Keep the newest verified backup until the replacement host completes a live
  run and cleanup cycle.
