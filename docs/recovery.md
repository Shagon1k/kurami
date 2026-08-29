# Disaster recovery

This repository stores Kurami's versioned system control-plane code, including
the Project Orchestrator and its non-secret deployment assets. It is not a
complete machine image.

## Recovery sources

- GitHub: private `Shagon1k/kurami` repository.
- Runtime backup: the newest verified directory under
  `/home/shagon1k/_hermes/_kurami/backups/`.
- Minimal DR: the newest encrypted `kurami-recovery-*.tar.zst.age` object in
  the private off-site bucket, plus its `.sha256` sidecar.
- Recovery identity: the operator's offline `age` private key. It must never be
  stored on the VPS or in the bucket.

The repository contains TypeScript source, migrations, tests, deployment
configuration, the Caddy unit, Hermes wrappers, the Discord control plugin, and
the run-control skill. It does not contain credentials, SQLite state, logs,
runtime binaries, Docker data, Codex sessions, the Hermes cron registry,
Cloudflare dashboard configuration, canonical project clones, or worktrees.

## Fixed deployment paths

```text
Linux user:       shagon1k
Orchestrator:     /home/shagon1k/_hermes/_kurami
Application:      /home/shagon1k/_hermes/_kurami/app
Hermes home:      /home/shagon1k/_hermes/_core
Project root:     /home/shagon1k/_projects
```

Restore to these paths unless all configuration and service files are reviewed
and changed together.

## Minimal encrypted recovery bundle

The ordinary backup intentionally excludes credentials. When Minimal DR is
enabled, the same three-day backup job additionally creates one encrypted
bundle containing only:

- the newest verified SQLite/config snapshot and both manifests;
- Hermes `.env`;
- GitHub and TailorTales preview env files;
- the Hermes `cron/jobs.json` registry.

Application code remains in the private GitHub repository. Logs, Docker data,
Codex sessions, canonical clones, worktrees, temporary files, and runtime
binaries are not copied. Local encrypted retention is three bundles; the
off-site bucket retains the newest three current bundle/checksum pairs.
Versioning provides a short recovery window for pruned current objects; an S3
Lifecycle rule permanently removes noncurrent versions after 30 days.

Minimal DR is disabled unless the private file
`/home/shagon1k/_hermes/_kurami/secrets/recovery.env` exists with mode
`0600` and contains the `age` **public** recipient plus the dedicated
least-privilege S3 writer credentials:

```text
KURAMI_RECOVERY_RECIPIENT=age1...
KURAMI_S3_BUCKET=your-account-regional-recovery-bucket
KURAMI_S3_REGION=eu-west-1
KURAMI_S3_PREFIX=recovery/
KURAMI_S3_RETENTION=3
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

The corresponding private identity stays off the VPS. The S3 writer can only
list `recovery/` and get, put, or delete current objects under that prefix. It
must not have `s3:DeleteObjectVersion`, bucket administration, or access to any
other AWS resource. AWS credentials are not copied into the encrypted bundle;
during disaster recovery the operator signs in to AWS and issues a fresh
read credential.

Bundle creation fails
closed if a required source is missing, symlinked, group/world-readable, does
not match the state-backup manifest, or fails SQLite integrity verification.
Plaintext staging is created under the system temporary directory and removed
after encryption, including on failure.

Encrypted bundles are first written to
`/home/shagon1k/_hermes/_kurami/recovery/`. The existing backup wrapper
then uploads the latest bundle and checksum with system `curl` using AWS SigV4,
reads back the remote size and checksum, and prunes current S3 objects to three
pairs. Credentials are supplied to `curl` through stdin configuration and do
not appear in its process arguments. A local encrypted bundle alone is not
considered disaster recovery.

On an isolated restore host, install `age`, clone GitHub, download the newest
bundle plus sidecar, verify the sidecar, and run:

```bash
export KURAMI_HOME=/home/shagon1k/_hermes/_kurami
export HERMES_HOME=/home/shagon1k/_hermes/_core
export KURAMI_AGE_BIN=/usr/local/bin/age
export PATH="$KURAMI_HOME/runtime/node/bin:$PATH"

sha256sum --check kurami-recovery-*.tar.zst.age.sha256
node "$KURAMI_HOME/app/src/system/recovery/recovery-bundle.ts" verify \
  --bundle /path/to/kurami-recovery-YYYYMMDDTHHMMSSZ.tar.zst.age \
  --identity /offline/path/to/kurami-recovery.agekey
```

The verifier decrypts only inside an isolated temporary directory, rejects
unsafe archive entries, checks every file against the encrypted manifest, runs
SQLite `quick_check`, and removes the plaintext drill directory. Actual
restoration remains an explicit operator action following the order below.

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
/home/shagon1k/_hermes/_kurami/secrets/github.env
/home/shagon1k/_hermes/_kurami/secrets/tailortales-preview.env
/home/shagon1k/_hermes/_kurami/connectors/external/composio-session/.env
/home/shagon1k/_hermes/_kurami/connectors/external/composio-read-session/.env
/home/shagon1k/_hermes/_kurami/connectors/external/composio-automation-session/.env
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
| `kurami-ahurynovich-cv-poller` | `* * * * *` | local |
| `kurami-projects-digest` | `45 6 * * *` | digest Discord channel |
| `kurami-state-backup` | `15 3 */3 * *` | maintenance Discord channel |
| `kurami-system-health` | `*/20 * * * *` | local; edits health card and sends alerts |
| `kurami-network-speed` | `7 */6 * * *` | local; updates bounded speed state |
| `kurami-monthly-maintenance` | `15 4 1 * *` | maintenance Discord channel |

The pollers remain separate because project events belong to different Discord
channels. Backup, maintenance, system health, and network trends are Kurami-wide jobs.
Project pollers and their cleanup remain part of the Project Orchestrator.

## Validation

From the application directory:

```bash
export KURAMI_HOME=/home/shagon1k/_hermes/_kurami
export HERMES_HOME=/home/shagon1k/_hermes/_core
export PATH="$KURAMI_HOME/runtime/node/bin:$PATH"

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
npm run test:recovery
npm run test:s3-recovery
npm run test:runtime-health
npm run test:maintenance

npm run db:init
node src/orchestrator/health/runtime.ts
node src/orchestrator/projects/previews/ingress.ts reconcile --apply
node src/orchestrator/controls/discord.ts --apply
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
no unexplained preview leases or Compose projects, synchronized ingress, seven
active cron jobs, and no secrets in Git.

## Safety

- Keep pollers paused until validation completes.
- Release worktrees only through recorded merge evidence and the normal release
  handler.
- Never reconstruct a preview route without a matching Run Store lease.
- Do not copy old cron IDs, tmux PIDs, Docker IDs, or transient preview ports.
- Keep the newest verified backup until the replacement host completes a live
  run and cleanup cycle.
