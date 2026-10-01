---
title: How monitoring works
nav: Monitoring
summary: How Kurami collects numbers about the server, turns them into problems with streaks, and decides which Discord message to send, or whether to send one at all.
section: platform
group: internals
order: 30
next: backup-internals
---

Monitoring is a pair of short scripts: the first collects the server's state every few minutes and records one cycle, the second turns the recorded cycle into Discord messages. Hub reads the same recorded cycle. What the card and messages look like is on [Server health](@health).

:::glance
- What it does: collects metrics, keeps a streak for each problem, records one cycle and delivers the alert, reminder or recovery message from it
- Triggered by: the Hermes job `kurami-system-health`, at the configured interval (built-in default 20 minutes), which you change in `/kurami settings` or in Hub
- Runs where: the wrapper `kurami-runtime-health.sh` runs two steps, collect and then deliver, with no agent and no LLM; delivery writes to Discord directly
- State: the private SQLite database `$KURAMI_HOME/state/system-health.db` (cycle, pending messages, leases) plus compatibility JSON files
- What you see: one card edited in place, separate messages in the alerts channel and the System Health area in [Hub](@hub)
:::

```diagram
kind: graph
title: One check cycle
desc: Hermes starts the wrapper, which first collects and then delivers. Collectors read the server, the database, Docker and backups, plus two files written by background jobs. The decision step compares the problems with the streaks from the previous cycle and commits the new cycle and any message to send into system-health.db. The delivery step reads the pending messages from that database, writes to the alerts channel and edits the health card. Hub reads the same database.
node cpustat "cpu-statistics.json" "CPU sampler, every 15 s" store at 0,0
node speed "network-speed.json" "network speed" store at 0,1
node script "Check wrapper" "on the Hermes schedule" at 1,0
node collect "1 · Collect" "server, database, Docker, backup" at 1,1
node decide "Decision" "streaks and fingerprint" at 1,2
node db "system-health.db" "cycle, pending, leases" store at 0,2
node deliver "2 · Deliver" "up to 20 messages" at 1,3
node alerts "Alerts channel" "a new message" external at 2,2
node card "Health card" "edited in place" external at 2,3
node hub "Hub" "reads the cycle" external at 0,3
edge script -> collect "starts"
edge cpustat -> collect "CPU series" muted
edge speed -> collect "snapshot" muted
edge collect -> decide "problems"
edge decide -> db "commit cycle and message"
edge script -> deliver "then starts" muted
edge db -> deliver "pending"
edge deliver -> alerts "send"
edge deliver -> card "edit"
edge db -> hub "read" muted
```

## Collectors

The collector reads everything itself in one pass and changes nothing on the server. It measures the server directly: CPU load from `/proc/stat` with two readings 5 seconds apart, memory from `/proc/meminfo`, the count of processes killed by the kernel from `/proc/vmstat`, plus the load average and uptime. Network is checked with three HTTPS requests to Cloudflare, Google and GitHub.

It opens the Run Store database read-only and runs `PRAGMA quick_check`. Then it asks Docker how many containers run and which are unhealthy, lists the hungriest processes with `ps`, and cross-checks the previews: every lease needs a Docker project and a directory, and every directory needs a lease. Finally it reads the age of the newest backup and the state of the resource guard: disk space, the number of working copies, quarantine.

Two files are prepared for the script by others: `cpu-statistics.json` is written by a background CPU sampler (a sample every 15 seconds, at most 1440 points in the file), and `network-speed.json` by a separate speed-test job. From them the card takes the 8-minute rolling average, the peak and the speed. Alerts do not use the average: it would smooth away a sustained overload, so only the 5-second reading decides.

Collection has no Discord dependency: it reads no Discord configuration or credentials, so a Discord outage cannot stop measuring. A *lease* in the database lets only one collector run at a time; it expires after five minutes, so a crashed collector does not block the next one.

## Problems, keys and streaks

Every violation becomes a *problem* with three fields: a key, a severity and the number of consecutive checks needed to confirm it. The key keeps a problem "the same one" from check to check. CPU, RAM and network have fixed keys: `server:cpu`, `server:memory`, `server:network`. For everything else the key is built from the message text with the numbers replaced by `#`: "backup is 90 hours old" and "backup is 91 hours old" give one key.

| Problem | Severity | Checks in a row |
|---|---|---|
| CPU, RAM, network: thresholds as on [Server health](@health) | warning / critical | 3 / 2 |
| OOM killer killed a process since the last check | critical | 1 |
| `quick_check` not `ok`, Docker not rootless, unhealthy containers | critical | 1 |
| Backup older than 84 hours (limit configurable from 24 to 168) or missing | critical | 1 |
| Inconsistent previews: an orphan, a failed lease, a stray directory | critical | 1 |
| Disk from 85%, working-copy limit, quarantine | critical | 1 |
| Disk from 75%, overdue quarantine review | warning | 1 |

A streak grows while a problem's severity stays the same. If RAM moves from warning to critical, the streak restarts at one: the critical problem must be confirmed by its own checks. A problem that drops out leaves the streaks at once. So a single CPU spike to 97% stays a line on the card and does not become an alert.

## The decision: send or not

A pure function makes the decision during collection. It receives the previous state (the stored cycle, or the old JSON files on the very first run), the current problems and the time, and returns one of four answers. First it updates the streaks. A problem becomes *active* once its streak reaches the required length and stays active while it remains in the list. Then the function compares the *fingerprint* — the sorted list of "key:severity" pairs of the active problems — with the previous one.

```diagram
kind: graph
title: Which message to send
desc: After the streaks are updated, the function compares the fingerprint of the active problems with the previous one. Changed and some active — an alert. Changed and none left — a recovery. Unchanged, some active and 120 minutes passed — a reminder. Otherwise no message.
node streak "Streaks updated" "from the new list" at 0,0
node fp "Fingerprint changed?" "key:severity" decision at 1,0
node now "Any active?" "after this check" decision at 0,1
node due "120 minutes passed?" "and some active" decision at 2,1
node alert "Alert" "alert" at 0,2
node recovery "Recovery" "recovery" at 1,2
node reminder "Reminder" "reminder" at 2,2
edge streak -> fp
edge fp -> now "yes"
edge fp -> due "no"
edge now -> alert "yes"
edge now -> recovery "no"
edge due -> reminder "yes"
```

The recovery arrives at the *first* clean check, with no delay. This is deliberate: an alert must not outlive its problem, and a fresh spike still has to pass through a streak. The "Alert" step also carries warnings: the title depends on whether any active problem is critical. The answer is not sent at this point: it is recorded as a pending message in the same database transaction as the new cycle.

## State and compatibility files

The source of truth is one SQLite database. Collection writes the new cycle and its pending message in a single transaction, so the two never disagree.

| Where | What it holds | Who reads it |
|---|---|---|
| `system-health.db`, table `health_cycle` | the latest measurements, the last ten checks and the streaks, with the time of the last message | the next collection, delivery, Hub |
| `system-health.db`, table `health_notifications` | messages waiting to be sent, each with a nonce | delivery |
| `system-health.db`, table `health_leases` | who collects or delivers now, and until when | collection, delivery |
| `system-health-discord.json` | channel and message id of the card | delivery, to edit the same message |
| `health-settings.json` | interval, revision, who changed it and when | the settings form, Hub, the interval command |
| `runtime-health-alert.json`, `runtime-health-counters.json`, `system-health-history.json`, `system-health-snapshot.json` | projections of the cycle for older readers; the counters file also keeps the OOM count for the next check | compatibility; Hub falls back to the snapshot before the first cycle |

Files are written atomically: a temporary file first, then a rename. A missing projection does not matter: Hub and delivery read the database.

## Delivery to Discord

The Hermes job is marked `deliver: local`, so Hermes itself publishes nothing. The wrapper runs the collector and then `system-health-discord.ts --deliver`, which sends through the Discord REST API. That way the card does not get a "Cronjob Response" header, and the card is an edit of an old message rather than a new one.

Delivery takes its own lease, reads the stored cycle without a new CPU sample and sends up to 20 pending messages, oldest first. Each message is removed from the queue only after Discord accepts it. If sending fails, the message stays with its original result and nonce, order is kept, and the next delivery retries. The nonce is a one-off tag built from the message kind, the time of the previous message and the fingerprint; Discord drops a second message with the same tag while it remembers it. A reminder is not queued twice for the same set of problems, but a transition (alert, recovery) always waits until delivered. Every request is tried up to three times, and a 429 answer is waited out for up to five seconds.

Then delivery edits the card from the stored cycle. If the card was deleted, Discord answers 404, and delivery posts a new one and remembers its id. The older modes `--run`, `--heartbeat` and `--alerts` still collect first; `--cleanup-health-channel` is explicit maintenance and collects nothing.

## What Hub shows from the cycle

Hub opens `system-health.db` read-only and shows the latest committed cycle, the same numbers as the card. Until the first cycle exists it reads the old snapshot file. If the cycle is older than twice the interval plus five minutes (at least 15), Hub marks System Health stale and puts it into its problem queue. Hub does not collect or deliver anything.

## What monitoring cannot see

Monitoring does not watch itself. If Hermes stops or the wrapper crashes, the job does not report it: its delivery is local, and there is no watchdog for the watchdog. Two signs remain: the "Updated" time on the card stops changing, and Hub marks System Health stale. Container load is not judged against thresholds either: it is shown among the "hungriest" and raises no alert.

::::example The evening memory ran out (invented data)
The interval is 10 minutes. RAM thresholds: warning 80% (3 checks), critical 90% (2 checks).

| Check | RAM | `server:memory` streak | Decision | What Discord shows |
|---|---|---|---|---|
| 10:00 | 79% | none | silence | the card is green |
| 10:10 | 83% | warning 1/3 | silence | the card is yellow, a row in Issues |
| 10:30 | 86% | warning 3/3, active | `alert` | "⚠️ Warning", "Top consumers at alert time" |
| 12:30 | 86% | active, 120 minutes passed | `reminder` | "⏰ Reminder" |
| 12:40 | 91% | critical 1/2, streak restarts; warning stays active | silence | the card |
| 12:50 | 92% | critical 2/2 | `alert`, fingerprint changed | "🚨 Alert" |
| 13:00 | 71% | problem gone, none active | `recovery` | "✅ Recovered", the card is green |

Between 10:10 and 10:30 the card is already "yellow", but nobody calls you: the first two warnings are not yet confirmed. If Discord is down at 10:30, the alert waits in `system-health.db` with its nonce, and the 10:40 delivery sends it; the 10:40 collection does not queue a second one.
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| Discord is unreachable | delivery tries three times and fails; the message stays pending with its nonce, collection keeps working | nothing: the next delivery retries, up to 20 messages |
| The card is deleted | gets 404, posts a new one and remembers its id | nothing; stray messages in the channel are cleaned by the `--cleanup-health-channel` flag |
| Hermes is stopped | no checks run; there is no alert | notice the frozen "Updated" or the stale mark in Hub and check `hermes-gateway` |
| A collector is already running | the second one stops with "already running"; the lease frees itself after five minutes | nothing |
| An interval change is rejected | Hermes did not accept the schedule, the form reports an error, the interval stays | retry or check the job identifier |
| The job is recreated after a disaster | it gets a new identifier, while the settings form looks for the old one | set `KURAMI_HEALTH_JOB_ID` |

:::guarantees
- Monitoring only observes: it does not repair, delete previews or stop runs.
- A short spike does not become an alert: a streak in a row is required.
- Collection never depends on Discord, and delivery never samples or advances streaks.
- A failed message stays pending in order, and a retry carries the same nonce; delivery is at-least-once, bounded by how long Discord remembers a nonce.
- Each problem is reported once per change, not on every check.
:::

:::code-map
- `src/system/health/health-cycle.ts` — collection, the cycle store, leases and the delivery queue
- `src/system/health/system-health-discord.ts` — the `--deliver` entry point: messages and the card
- `src/system/health/health-read-model.ts` — what Hub reads from the cycle
- `src/orchestrator/health/runtime.ts` — collectors and the list of problems
- `src/system/health/server-health.ts` — thresholds, streaks, decision, keys
- `src/system/health/cpu-statistics-sampler.ts` — the background CPU sampler
- `src/system/network/network-health.ts` — three probes and network speed
- `src/system/health/health-settings.ts` — changing the check interval
- `integrations/hermes/scripts/kurami-runtime-health.sh` — the Hermes job wrapper
:::
