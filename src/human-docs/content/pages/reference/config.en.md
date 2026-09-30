---
title: Configuration
summary: Which settings live where, what they mean, and which ones you can change with a button and which only with a deploy.
section: reference
group: reference
order: 50
---

Kurami's settings live in three places. **Configuration files** are in the repository under `deploy/config/` and are copied to `$KURAMI_HOME/config/` on the server: they change only with a deploy. **Owner settings** are the limits you change in `/kurami settings`: they are stored in the database as revisions on top of the file values. **Environment variables** set paths, ports and secrets and stay out of the repository.

## What you can change with a button

`/kurami settings` changes only these values. Project Orchestrator limits change only while it is idle: no running runs, previews, queues or technical tasks. The health check interval can change at any time. Every change is recorded as a revision with its author and an integrity check, and **Undo last** rolls it back.

| Setting | Allowed | Default | What it limits |
|---|---|---|---|
| Concurrent model sessions | 1–3 | 1 | Codex and AI review processes running at once |
| Global WIP | 1–6 | 2 | runs in active states across all projects |
| WIP per project | 1–3 | 2 | the same for one project |
| AI issue assessments per day | 0–40 | 12 | Priority and Effort proposals in Projects Digest |
| Preview slots | 1–6 | 6 | previews running at once |
| Concurrent preview builds | 1–2 | 2 | builds running in parallel |
| Preview lifetime, h | 6–72 | 24 | when a preview stops by itself |
| Health check interval, min | 5, 10, 12, 15, 20, 30, 60 | 20 | how often the health card updates |

Checks prevent contradictory values: no more model sessions than tmux sessions; global WIP no higher than the working-copy limit; project WIP no higher than global WIP. The default for the health interval lives in code, not in `orchestrator.yaml`.

## orchestrator.yaml

| Key | Value | Meaning |
|---|---|---|
| `mode` | `live` | `dry_run` only records decisions; `live` allows actions |
| `limits.max_tmux_sessions_global` | 3 | hard cap on managed tmux sessions |
| `limits.max_managed_worktrees_global` / `_per_project` | 6 / 4 | how many working copies may exist |
| `limits.disk_warning_percent` / `disk_admission_block_percent` / `disk_emergency_percent` | 75 / 85 / 92 | warning, no admission of new work, emergency |
| `limits.orphan_grace_minutes` | 30 | how long to wait before an unknown working copy is quarantined |
| `limits.quarantine_review_after_days` | 7 | when to remind you about a quarantined resource |
| `limits.main_writer_timeout_minutes` / `technical_worker_timeout_minutes` | 240 / 90 | time budget of the main Codex session and of a technical task |
| `limits.preview_expiry_warning_hours` / `preview_extension_hours` | 2 / 24 | when **Extend 24h** appears and how much it adds |
| `limits.min_preview_available_memory_mib` / `min_preview_available_disk_gib` | 4096 / 20 | free memory and disk needed to build a preview |
| `limits.builder_cache_max_used_gib` | 8 | Docker build cache ceiling for the monthly cleanup |
| `limits.max_delivery_attempts` | 3 | attempts to deliver an alert to Discord |
| `server_health.cpu_warning_percent` / `cpu_critical_percent` | 85 / 95 | CPU thresholds |
| `server_health.memory_warning_percent` / `memory_critical_percent` | 80 / 90 | memory thresholds |
| `server_health.warning_consecutive_checks` / `critical_consecutive_checks` | 3 / 2 | consecutive checks needed for an alert |
| `server_health.alert_reminder_minutes` | 120 | how often to remind about an open alert |
| `discord.*_channel_id` | — | channels for cards, alerts and maintenance reports |

## projects.yaml

One entry per project.

| Key | Meaning |
|---|---|
| `owner`, `project_number`, `repository`, `status_field` | which GitHub Project board and which repository; user-owned boards are supported |
| `statuses.{backlog,active,review,done,deferred}` | the names of the five board columns |
| `human_control_label` | the label that starts a run under human control |
| `workspace.canonical_repository` / `worktree_root` / `base_branch` / `branch_prefix` | the reference clone, where working copies go, the main branch and a prefix such as `TT` |
| `discord.{guild_id,channel_id}` | the project's channel for run cards |
| `ci.required_checks`, `ci.missing_grace_minutes` | which CI checks are required and how long to wait for a missing one |
| `triage.*` | whether the project takes part in Projects Digest, and the Priority and Effort field names |
| `preview.*` | how to build a preview: Docker Compose or a static folder, and the `preview-required` label |

Before a project is connected, its entry is checked with `npm run readiness -- --project <key> --live`; see [Connecting a project](@project-setup).

## briefing.yaml

| Key | Meaning |
|---|---|
| `edition.timezone` | the edition's time zone: the 09:00 and 10:00 windows are counted from it |
| `edition.daily_retention_days` | how many days a Daily is kept; the code requires exactly 7 |
| `safety.production_mutations_enabled` | allows real publishing, marking channels read and notices |
| `safety.require_bounded_telegram_commit` | must be `true`: channels are marked read only up to what was published |
| `notification.destination` | the Discord channel for the edition notice |
| `sources.mail`, `sources.calendar`, `sources.weather`, `sources.news` | sources: the mail query, calendars, the weather location and the Telegram channel list |
| `signals.*` | thresholds and enabled rules for signals |
| `weekly`, `cinema`, `stocks`, `stocksDiscovery`, `investmentReview` | add-on settings |

News topics and their checks live separately in `deploy/config/briefing-topics.yaml`. Some `briefing.yaml` keys, such as schedules and notice flags, are not read by the code today: the real schedules are set in Hermes and systemd; see [Jobs and schedule](@jobs).

## Environment variables

| Variable | What it sets |
|---|---|
| `KURAMI_HOME`, `HERMES_HOME` | the Kurami and Hermes root folders |
| `BRIEFING_PORT`, `DOCS_PORT`, `HUB_PORT` | the sites' ports on the local address |
| `KURAMI_BACKUP_RETENTION` | how many snapshots to keep, 14 by default |
| `KURAMI_BACKUP_MAX_AGE_HOURS` | after how many hours a backup counts as stale, 84 by default |
| `KURAMI_RECOVERY_RETENTION`, `KURAMI_S3_RETENTION` | how many recovery archives to keep locally and off-site, 3 each |
| `KURAMI_LOG_RETENTION_DAYS` | after how many days logs are removed during maintenance, 90 by default |

Secrets — GitHub and Discord tokens, connector and storage keys — live in `$KURAMI_HOME/secrets/` and connector folders with `0600` permissions and are not committed to the repository.
