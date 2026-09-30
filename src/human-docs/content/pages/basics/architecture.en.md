---
title: Architecture
summary: Which processes run on the server, how they start, where they keep state and how new code goes live.
section: basics
group: internals
order: 10
next: state-and-truth
---

Kurami is not one application but around twenty short scripts and a few long-running services on one VPS. Almost no business logic lives in memory: every job starts, reads state from SQLite or a file, does its work, records the result and exits. So any process can be restarted at any moment, and the next run continues from the same place.

:::glance
- Server: one VPS; every service listens on `127.0.0.1` only
- Scheduler: Hermes (12 cron jobs) plus two systemd timers
- Long-running services: the Digest site, the docs site, Hub, Caddy for previews, the CPU sampler
- State: `$KURAMI_HOME/state` — SQLite databases and JSON files
- Access from outside: Cloudflare Tunnel and Cloudflare Access, owner only
- Deploys: by hand — update the code in `$KURAMI_HOME/app` and restart the service that needs it
:::

## The layers

```diagram
kind: graph
title: Processes by layer
desc: Discord, GitHub and requests to the sites through Cloudflare Access come from outside. Hermes holds the Discord connection and runs jobs on a schedule. Kurami jobs and long-running services read and write state in SQLite and JSON files.
node cloudflare "Cloudflare Access" "entry to the sites" external at 0,0
node discord "Discord" "cards, buttons" external at 1,0
node github "GitHub" "boards, PRs, CI" external at 2,0
node gateway "hermes-gateway" "cron ticker, Discord, agents" at 1,1
node mcp "MCP servers" "Telegram, Composio" at 2,1
node jobs "Kurami jobs" "polls, Daily, health" at 1,2
node timers "systemd timers" "Daily guard, hourly poll" at 2,2
node sites "Sites" "Digest, docs, Hub" at 0,2
node sqlite "SQLite" "orchestrator, briefing" store at 0,3
node json "JSON files" "health, settings" store at 1,3
node logs "logs/" "job logs" store at 2,3
group entry "Outside" cloudflare discord github band
group hermes "Hermes" gateway mcp band
group kurami "Kurami" sites jobs timers band
group state "State" sqlite json logs band
edge cloudflare -> sites "HTTPS"
edge discord <-> gateway
edge gateway -> jobs "runs"
edge gateway -- mcp
edge jobs -> github "gh api"
edge jobs -> sqlite
edge jobs -> json
edge timers -> sqlite
edge sites -> sqlite "reads"
```

Top to bottom: the outside world, Hermes, Kurami's processes, state. Hermes is a ready-made agent runtime: it holds the only Discord connection, checks the schedule once a minute and can run a model with skills and tools. Kurami adds everything else: job scripts, rules, databases and sites.

## What runs on the server

| Process | How it runs | What it does |
|---|---|---|
| `hermes-gateway` | systemd, always restarted | cron ticker, Discord buttons through the Kurami plugin, agent sessions, MCP servers |
| Project polls (×3) | Hermes cron, every minute | the Project Orchestrator cycle for each project |
| Docs proposal worker | Hermes cron, every minute | turns the weekly docs draft into a PR and a card |
| Server health | Hermes cron, at the configured interval (5–60 minutes) | updates the health card and sends alerts |
| Daily | Hermes cron, agent job | the Digest morning edition |
| Projects Digest, backup, maintenance, Investment Review, docs audit, network speed | Hermes cron, on schedule | see [the schedule](@scheduling) |
| `kurami-briefing` | systemd, always on | the Digest site |
| `kurami-human-docs` | systemd, always on | these docs |
| `kurami-hub` | systemd, always on | Hub, the live status panel |
| `kurami-preview-ingress` | systemd, always on | Caddy: routes to project previews |
| `kurami-cpu-statistics` | systemd, always on | a CPU sample every 15 seconds for the health card |
| Daily guard and the hourly Digest poll | systemd timers | checking the morning edition and refreshing its live sections |

The full list with exact times is in the reference page [Jobs and schedule](@jobs).

## Two ways to start something

:::compare
### On a schedule
Once a minute Hermes checks the schedule in UTC and runs the job's script. The script takes a file lock: if the previous run is still going, the new one exits quietly. Local time and weekdays are checked by the code itself — for example, Daily decides on its own that it is 09:00 local time.
### On your command
A button or a `/kurami` command in Discord reaches the Kurami plugin inside Hermes. The plugin checks that it was you and calls a short CLI command. That command almost always just queues a request in the database, and the next job cycle carries it out.
:::

This means there is usually up to a minute between your click and the result. In exchange, every action goes through the same checks as an automatic one and leaves a record in the database.

## How jobs report

A Hermes job comes in two kinds. A **script job** is just a script: if it prints nothing, Hermes sends nothing anywhere. An **agent job** is a model session with skills; only Daily and the weekly docs audit work this way. Hermes marking a job "done" only means the script exited without an error. So Kurami's scripts post to Discord through the API themselves and keep their own proof of the result: the Daily notice receipt, the health card's update time, the backup manifest.

## Access from outside

Every service listens only on the local address `127.0.0.1`. From outside there is one way in: Cloudflare Tunnel, then Cloudflare Access checking that it is you, then the local service. The sites have no login of their own; Access plays that role. The Tunnel and Access settings live in the Cloudflare dashboard, not in the repository.

## How code goes live

There is no automatic deploy. GitHub Actions runs the checks on every PR: types, docs tests and the regression suite. A deploy is a manual update of the checkout in `$KURAMI_HOME/app`, after which:

- Digest is rebuilt into `dist/` with `npm run briefing:build` and the `kurami-briefing` service is restarted;
- the other parts run straight from TypeScript with a pinned Node version, so new code takes effect on the next job run, and long-running services need a restart;
- the Discord plugin and Hermes skills are synced by `bin/sync-hermes-plugin.sh` and `bin/sync-hermes-skills.sh`, and then `hermes-gateway` is restarted.

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| `hermes-gateway` crashed | systemd restarts it at once; missed jobs within their grace window run after it returns | if the health card has not updated for a while, check `systemctl --user status hermes-gateway` |
| A job script crashed | the job is marked failed; quiet jobs send nothing and write errors to `logs/*-errors.log` | read that job's log |
| Two runs overlapped | the second sees the lock taken and exits quietly | nothing |
| The server rebooted | services and timers come back on their own and SQLite state is intact; Codex sessions in tmux are lost and show up as needing attention | decide about the affected runs in Discord |

:::guarantees
- Services listen only on the local address; the only way in from outside goes through Cloudflare Access.
- Secrets never reach Git, logs or ordinary backups; the only place some of them are copied to is the encrypted recovery archive.
- Every button action passes the same checks as an automatic one and leaves a record in the database.
- Deploying new code is a manual step; the system never updates itself.
:::

:::code-map
- `deploy/systemd/` — long-running services and timers
- `integrations/hermes/scripts/` — Hermes job scripts
- `integrations/hermes/plugins/kurami-discord-controls/` — the plugin for Discord buttons and commands
- `src/core/kurami-home.ts` — where `$KURAMI_HOME` is found
- `run-project-poller.sh` — the most frequent cycle: project polling
- `.github/workflows/regression.yml` — checks on every PR
:::
