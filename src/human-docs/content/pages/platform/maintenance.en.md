---
title: Monthly maintenance
nav: Maintenance
summary: On the first of the month Kurami deletes old logs and unneeded Docker cache, and leaves alone anything that might hold your work.
section: platform
group: guide
order: 60
next: hub
---

Once a month, on the first at 04:15 UTC, Kurami frees disk space. Logs and the Docker build cache grow on their own, and without cleaning the disk eventually reaches the threshold at which admission of new runs is blocked. Maintenance removes only what can be recovered or recreated, and posts a summary to the maintenance channel.

## What is removed

| What | Rule | Why |
|---|---|---|
| `*.log`, `*.jsonl`, `*.txt` files in `$KURAMI_HOME/logs` | older than 90 days (setting from 30 to 365) | logs grow without bound and old ones are rarely needed |
| Unused Docker images | used by no container and created more than 720 hours (30 days) ago | an image is rebuilt at the next preview |
| Docker builder cache | everything above a ceiling of 8 GiB (setting from 1 to 256) | the cache speeds up builds but must not fill the disk |

The cache ceiling is the `limits.builder_cache_max_used_gib` key in `orchestrator.yaml`; the log retention is the `KURAMI_LOG_RETENTION_DAYS` variable. The job deletes only regular files with those extensions: links and directories are not touched.

## What always stays

Docker containers, volumes and networks, the working copies (worktrees) of runs and the preview runtimes are not touched by maintenance at any threshold. A running or disputed preview is not cache but someone's work, and only the owner can decide its fate through the run controls. If the disk is still short, freeing it is up to you, and the [health check](@health) tells you sooner.

## What you see

The maintenance channel receives "🧹 Kurami monthly maintenance completed".

| Line | Meaning |
|---|---|
| Removed logs | how many log files were deleted and how much space they took |
| Unused images reclaimed | how much space the deleted images returned |
| Builder cache reclaimed | how much space the builder cache pruning returned |
| Builder cache ceiling | the cache ceiling in GiB |
| Preserved | a reminder: containers, volumes, networks, working copies and preview runtimes are untouched |
| Completed | completion time |

Before cleaning, the job checks that Docker runs in rootless mode and stops with an error in any other mode: the prune commands must not reach a system-wide daemon. To see the plan without deleting anything, run `monthly-maintenance.ts` without the `--apply` flag: it prints the file list and changes nothing.

:::cards
- [Backups and recovery](@recovery) — the neighbouring scheduled job
- [Server health](@health) — warnings about a filling disk
- [Scheduling](@scheduling) — every job by time
:::

## Monthly resource audit

The separate `kurami-monthly-resource-audit` job runs on the first day of each month at 06:30 UTC. It inventories disk and RAM, temporary files, Git checkouts, agent versions, preview processes and rootless Docker resources. A new Hermes session analyzes the inventory with the current model and SOUL. The agent has no tools; it cannot delete files, stop processes or invoke cleanup.

You receive a short report in the maintenance Discord channel and a persistent **Resource audit** notice on Hub. Open the report to see directory sizes, RAM consumers, cleanup candidates and access limits. **Mark as reviewed** clears only that report’s notice. It does not authorize cleanup, and an older acknowledgement cannot hide a newer audit.

Cleanup requires your separate explicit approval and a fresh usage, mount, Git and ownership check. Databases, Docker volumes, session history, active tasks and protected checkouts are preserved. Missing process references do not prove that data is disposable; filesystem and Docker sizes can overlap. System Docker data may remain inaccessible. Audit reports are retained without automatic deletion.

This audit does not change the existing automatic maintenance policy above. Install or synchronize its schedule after releasing the code with `python bin/sync-resource-audit-cron.py --apply`, from the application repository in the installed Hermes Python environment. Without `--apply`, the command only checks the planned job and delivery.
