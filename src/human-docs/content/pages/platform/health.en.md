---
title: Server health
nav: Health
summary: One Discord card shows how the server is doing, and separate messages call you only when something lasts longer than a random spike.
section: platform
group: guide
order: 30
next: scheduling
---

Every few minutes Kurami checks the server and the Project Orchestrator. The result is always visible in one card, "🩺 Kurami System Health", in the health channel. Kurami does not post a new message for each check: it edits this card in place. A separate message reaches the alerts channel only when a problem is confirmed, changes, drags on or disappears. The same numbers are on the System Health area of [Hub](@hub): one check feeds both.

::shot{file="shot-health-card.png" size="card" alt="The System Health card in Discord: System and Project Orchestrator blocks and a list of recent checks" caption="The title and border colour give the overall result; at the bottom are the last update time and a picker for one of the recent checks."}

## What the card shows

The first line is the verdict: "🟢 All monitored checks are healthy" or "🟠 One or more checks need attention". The border is green, yellow, or red when a critical problem exists. Two blocks follow.

| Line | What it means |
|---|---|
| CPU | load over a 5-second sample, next to the rolling average, the peak and the load average |
| RAM | memory used out of the total, in GiB |
| Network | `online`, `degraded` or `offline` from three external HTTPS probes; speed is refreshed by a separate job |
| Disk | percent used and free GiB |
| Swap, Uptime | swap usage and how long the server has been up |
| State DB | result of `PRAGMA quick_check` on the Run Store database |
| Docker | how many containers are up and how many are unhealthy |
| Previews, Worktrees | active previews and managed working copies out of the limit |
| Quarantine | how many resources sit in quarantine after a disputed deletion |
| Backup | age of the latest backup and its limit |

When something is wrong, an "Issues" block appears: up to eight rows, the rest folded into "MORE n additional checks". The footer carries the last update time in local time.

## Messages in the alerts channel

Kurami sends four kinds of messages, and each means one thing.

| Message | When it arrives |
|---|---|
| 🚨 Kurami System Health Alert | at least one critical problem is confirmed |
| ⚠️ Kurami System Health Warning | only warnings are confirmed |
| ⏰ Kurami System Health Reminder | the set of problems has not changed for 120 minutes |
| ✅ Kurami System Recovered | the first check without any confirmed problem |

A message lists the active checks, "Top consumers at alert time" — the hungriest processes and containers — and the same System and Orchestrator blocks as the card. A problem is not confirmed at once: CPU, RAM and network need several checks in a row, so a short spike shows on the card but does not wake you.

## Thresholds

| Check | Warning | Critical | Checks in a row |
|---|---|---|---|
| CPU | from 85% | from 95% | 3 / 2 |
| RAM | from 80% | from 90% | 3 / 2 |
| Network | 1–2 of 3 probes answer | none answers | 3 / 2 |
| Disk | from 75% | from 85% blocks admission of new runs | 1 |
| Backup | — | older than 84 hours or missing | 1 |
| OOM killer, SQLite, Docker, previews | — | any violation | 1 |

The pair "3 / 2" is how many checks in a row a warning and a critical problem need. The thresholds and check counts live in `orchestrator.yaml` (sections `server_health` and `limits`); the backup age limit is the `KURAMI_BACKUP_MAX_AGE_HOURS` variable. See [Configuration](@config).

## The last ten checks

Under the card sits a picker, "Inspect one of the last 10 runs…". Each option is one check: time and verdict, for example `30.09.26 10:30 · attention`, plus a short line `CPU x% · RAM y% · Disk z%`. Pick one and Discord shows only you a "Health snapshot" block with the full numbers of that check. It helps you see when a problem started. Kurami keeps ten entries and drops the oldest.

## How often to check

You change the check interval in `/kurami settings`, section **System Health**, or in Hub under Controls → Settings; both use the same command. The allowed values are 5, 10, 12, 15, 20, 30 and 60 minutes; the built-in default is 20. Kurami rewrites the job's schedule in Hermes and posts a line to the maintenance channel. The form is described on [Settings](@settings).

If the "Updated" time in the card footer has stopped moving, the check itself is not running, and no alert says so: the thing that would report the failure is the thing that broke. Hub shows the same sign: after twice the interval plus five minutes (at least 15) it marks System Health "stale" and lists it among its alerts. Look at the state of Hermes; details are in [How monitoring works](@health-internals).

::shot{file="shot-health-alert.png" size="card" alt="A System Health Alert message in the Discord alerts channel with the active checks and the hungriest processes" caption="The alert names the confirmed problems and shows who holds CPU and memory at that moment."}

:::cards
- [How monitoring works](@health-internals) — collectors, streaks and the "send or not" decision
- [Backups and recovery](@recovery) — where the Backup line comes from
- [Scheduling](@scheduling) — every job and its time
:::
