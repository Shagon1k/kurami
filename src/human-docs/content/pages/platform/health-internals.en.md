---
title: How monitoring works
nav: Monitoring
summary: How Kurami collects numbers about the server, turns them into problems with streaks, and decides which Discord message to send, or whether to send one at all.
section: platform
group: internals
order: 30
next: backup-internals
---

Monitoring is a short script that collects the server's state every few minutes, compares it with the previous check and writes to Discord only as a result of that comparison.

:::glance
- What it does: collects metrics, keeps a streak for each problem and decides whether to send an alert, a reminder or a recovery message
- Triggered by: the Hermes job `kurami-system-health`, every 20 minutes by default; you change the interval
- Runs where: the script `kurami-runtime-health.sh`, with no agent and no LLM; it writes to Discord itself, directly
- State: four JSON files in `$KURAMI_HOME/state` — streaks, the OOM counter, history, the card id
- What you see: one card edited in place and separate messages in the alerts channel
:::

```diagram
kind: graph
title: One check cycle
desc: Hermes starts the check script. Collectors read the server, the database, Docker and backups, plus two files written by background jobs. The decision step compares the problems with the streaks from earlier checks and, if needed, sends a message to the alerts channel. Then the script edits the health card and appends to the history.
node cpustat "cpu-statistics.json" "CPU sampler, every 15 s" store at 0,0
node speed "network-speed.json" "network speed" store at 0,1
node script "Check script" "on the Hermes schedule" at 1,0
node collect "Collectors" "server, database, Docker, backup" at 1,1
node decide "Decision" "streaks and fingerprint" at 1,2
node state "runtime-health-alert.json" "streaks and active" store at 0,2
node alerts "Alerts channel" "a new message" external at 2,2
node card "Health card" "edited in place" external at 2,3
node hist "system-health-history.json" "last 10 checks" store at 1,3
edge script -> collect "starts"
edge cpustat -> collect "CPU series" muted
edge speed -> collect "snapshot" muted
edge collect -> decide "problems"
edge decide <-> state "reads and writes"
edge decide -> alerts "if warranted"
edge decide -> hist "record"
edge hist -> card "result"
```

## Collectors

The script reads everything itself in one pass and changes nothing on the server. It measures the server directly: CPU load from `/proc/stat` with two readings 5 seconds apart, memory from `/proc/meminfo`, the count of processes killed by the kernel from `/proc/vmstat`, plus the load average and uptime. Network is checked with three HTTPS requests to Cloudflare, Google and GitHub.

It opens the Run Store database read-only and runs `PRAGMA quick_check`. Then it asks Docker how many containers run and which are unhealthy, lists the hungriest processes with `ps`, and cross-checks the previews: every lease needs a Docker project and a directory, and every directory needs a lease. Finally it reads the age of the newest backup and the state of the resource guard: disk space, the number of working copies, quarantine.

Two files are prepared for the script by others: `cpu-statistics.json` is written by a background CPU sampler (a sample every 15 seconds, at most 1440 points in the file), and `network-speed.json` by a separate speed-test job. From them the card takes the 8-minute rolling average, the peak and the speed. Alerts do not use the average: it would smooth away a sustained overload, so only the 5-second reading decides.

## Problems, keys and streaks

Every violation becomes a *problem* with three fields: a key, a severity and the number of consecutive checks needed to confirm it. The key keeps a problem "the same one" from check to check. CPU, RAM and network have fixed keys: `server:cpu`, `server:memory`, `server:network`. For everything else the key is built from the message text with the numbers replaced by `#`: "backup is 90 hours old" and "backup is 91 hours old" give one key.

| Problem | Severity | Checks in a row |
|---|---|---|
| CPU from 85% / from 95% | warning / critical | 3 / 2 |
| RAM from 80% / from 90% | warning / critical | 3 / 2 |
| Network: 1–2 of 3 probes answer / none | warning / critical | 3 / 2 |
| OOM killer killed a process since the last check | critical | 1 |
| `quick_check` not `ok`, Docker not rootless, unhealthy containers | critical | 1 |
| Backup older than 84 hours (limit configurable from 24 to 168) or missing | critical | 1 |
| Inconsistent previews: an orphan, a failed lease, a stray directory | critical | 1 |
| Disk from 85%, working-copy limit, quarantine | critical | 1 |
| Disk from 75%, overdue quarantine review | warning | 1 |

A streak grows while a problem's severity stays the same. If RAM moves from warning to critical, the streak restarts at one: the critical problem must be confirmed by its own checks. A problem that drops out leaves the streaks at once. So a single CPU spike to 97% stays a line on the card and does not become an alert.

## The decision: send or not

A pure function makes the decision. It receives the previous state, the current problems and the time, and returns one of four answers. First it updates the streaks. A problem becomes *active* once its streak reaches the required length and stays active while it remains in the list. Then the function compares the *fingerprint* — the sorted list of "key:severity" pairs of the active problems — with the previous one.

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

The recovery arrives at the *first* clean check, with no delay. This is deliberate: an alert must not outlive its problem, and a fresh spike still has to pass through a streak. The "Alert" step also carries warnings: the title depends on whether any active problem is critical.

## State files

| File | What it holds | Who reads it |
|---|---|---|
| `runtime-health-alert.json` | streaks by key, active problems, time of the last message | the next check |
| `runtime-health-counters.json` | the count of processes killed by the kernel | the next check: the difference gives "OOM killer terminated N processes" |
| `system-health-history.json` | the last ten checks | the "Inspect one of the last 10 runs…" picker |
| `system-health-discord.json` | channel and message id of the card | the next check, to edit the same message |
| `health-settings.json` | interval, revision, who changed it and when | the settings form and the interval command |

All files are written atomically: a temporary file first, then a rename. So a crash mid-write never leaves half a JSON.

## Delivery to Discord

The Hermes job is marked `deliver: local`, so Hermes itself publishes nothing. The script sends the messages directly through the Discord REST API. That way the card does not get a "Cronjob Response" header, and the card is an edit of an old message rather than a new one.

First the script delivers the alert and only after success records the new streak state. If sending fails, the state stays as it was and the next check reaches the same decision. So that a retry does not create a duplicate, each message carries a *nonce*, a one-off tag built from the message kind, the time of the previous message and the fingerprint. With nonce enforcement on, Discord drops a second message with the same tag. Every request is tried up to three times, and a 429 answer is waited out for up to five seconds.

After the alert the script appends an entry to the history and edits the card. If the card was deleted, Discord answers 404, and the script posts a new one and remembers its id.

## What monitoring cannot see

Monitoring does not watch itself. If Hermes stops or the script crashes, the job does not report it: its delivery is local, and there is no watchdog for the watchdog. The only sign is the "Updated" time on the card that stops changing. Container load is not judged against thresholds either: it is shown among the "hungriest" and raises no alert.

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

Between 10:10 and 10:30 the card is already "yellow", but nobody calls you: the first two warnings are not yet confirmed.
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| Discord is unreachable | the script tries three times and exits with an error; the streak state does not advance | nothing: the next check repeats the same decision |
| The card is deleted | gets 404, posts a new one and remembers its id | nothing; stray messages in the channel are cleaned by the `--cleanup-health-channel` flag |
| Hermes is stopped | no checks run; there is no alert | notice the frozen "Updated" and check `hermes-gateway` |
| An interval change is rejected | Hermes did not accept the schedule, the form reports an error, the interval stays | retry or check the job identifier |
| The job is recreated after a disaster | it gets a new identifier, while the settings form looks for the old one | set `KURAMI_HEALTH_JOB_ID` |

:::guarantees
- Monitoring only observes: it does not repair, delete previews or stop runs.
- A short spike does not become an alert: a streak in a row is required.
- A retry after a failure does not create a second message: Discord drops an identical nonce.
- Each problem is reported once per change, not on every check.
:::

:::code-map
- `src/system/health/system-health-discord.ts` — the `--run` entry point: alert delivery, history, card
- `src/orchestrator/health/runtime.ts` — collectors and the list of problems
- `src/system/health/server-health.ts` — thresholds, streaks, decision, keys
- `src/system/health/cpu-statistics-sampler.ts` — the background CPU sampler
- `src/system/network/network-health.ts` — three probes and network speed
- `src/system/health/health-settings.ts` — changing the check interval
- `integrations/hermes/scripts/kurami-runtime-health.sh` — the Hermes job wrapper
:::
