---
title: Platform
nav: Overview
summary: What the platform gives Kurami's three products — scheduling, health, backups, access, documentation — and what a day of it looks like.
section: platform
group: start
order: 10
next: settings
---

:::glance
- What it is: everything Digest and Project Orchestrator stand on that is not them
- Foundation: Hermes — scheduling, the Discord connection, agents and connectors; Kurami — job code, rules and state
- Where it lives: one server, the `$KURAMI_HOME` directory, `systemd --user` services
- Rhythm: Hermes checks the schedule every minute; jobs run every minute, hourly, daily and weekly
- What you see: the health card, backup and maintenance messages, Hub, this documentation
- Yours: settings, recovery, publishing documentation changes
:::

The platform is the layer under the products: it starts their jobs on time, watches that the server is alive, copies the state, and decides who can reach what from outside. The products know nothing about schedules and backups, and the platform does not know what an edition or a Codex run is. The boundary is simple: the platform answers "is it running", "is it healthy", "is it saved" and "who is allowed".

## What the platform gives the products

| Need | How the platform solves it | More |
|---|---|---|
| Run jobs on time | Hermes checks the schedule every minute, and systemd timers back up the morning edition | [Schedule](@scheduling), [Jobs](@jobs) |
| Write to and listen on Discord | Hermes holds the only connection; the Kurami plugin adds buttons and `/kurami` commands | [Kurami and Hermes](@hermes-integration) |
| Know the server is healthy | At the configured interval a check updates one card and raises an alert for a persistent problem | [Health](@health) |
| Not lose state | Every three days: a verified database copy, an encrypted archive and an off-site copy | [Backups](@recovery) |
| Change limits without a deploy | The `/kurami settings` command or Hub Controls, only while Kurami is idle | [Settings](@settings) |
| Free disk space | Once a month old logs and Docker cache go; containers and working copies stay | [Maintenance](@maintenance) |
| Reach outside services safely | Three Composio authority levels plus a separate Telegram MCP | [Connector authority](@connector-authority) |
| Show sites only to the owner | Services listen on `127.0.0.1`; Cloudflare Tunnel and Access guard the entrance | [External access](@access) |
| See everything on one page | Hub, a private web dashboard, gathers server health, project state, Git and Codex usage and offers a few confirmed owner controls | [Hub](@hub) |
| Explain the system | This site, the weekly audit and a draft of changes that you publish | [Documentation](@docs-process) |

## A day of the platform

```diagram
kind: timeline
title: One day in local time (summer example)
desc: Project polls run every minute, the health check at the set interval (ten minutes here), Digest live blocks refresh hourly. Daily starts at 09:00, the guard works from 09:05 to 10:50, and Projects Digest appears at 09:45. Backup and maintenance run in the early morning on their days.
lane product "Projects"
lane daily "Daily"
lane digest "Digest"
lane server "Server"
span product 00:00-24:00 "board poll every minute"
at product 09:45 "Projects Digest" accent
at daily 09:00 "primary window" accent
at daily 10:00 "recovery" accent
span daily 09:05-10:50 "guard"
every digest 60m "live blocks" from 00:37
at digest 08:37 "Stocks cache"
every server 10m "health" from 00:00
at server 06:15 "backup" accent
at server 07:15 "maintenance"
range 00:00-24:00
```

The picture uses summer local time, which is three hours ahead of UTC (two in winter). Hermes jobs are defined in UTC, so their "clock schedule" shifts when the clocks change, and the code checks the local time it needs. [Schedule](@scheduling) explains how.

::::example An ordinary morning (invented data)
:::steps
- **Hermes** — at 06:00 UTC, which is 09:00 local, starts the agent job Daily.
- **Digest runtime** — sees local hour 9 and allows the primary window of the edition.
- **Hermes** — at 09:45 starts Projects Digest: it collects task facts and updates the cards in Discord.
- **Systemd timer** — at 09:50 the guard sees the edition published and the notification recorded, and leaves the card alone.
- **Health check** — at 09:50 reads `/proc`, Docker and SQLite and updates the health card. All is well, no alert.
- **You** — do nothing: the morning went by without your action.
:::
::::

## Where next

The table above leads to the guides. These pages explain how the platform works inside.

:::cards
- [Kurami and Hermes](@hermes-integration) — who does what in the pair
- [Directories, processes and deploys](@runtime-layout) — where things live and how to deploy
- [How monitoring works](@health-internals) — streaks and the "send or not" decision
- [How backups work](@backup-internals) — three stages and file checks
- [Connector authority](@connector-authority) — three access levels to Gmail and Calendar
- [Where automation stops](@automation-boundaries) — where automation halts and waits for you
- [How the docs are built](@docs-system) — format, build, release and rollback
- [UI library](@ui-library) — the shared look of every site
- [Why it is so](@platform-decisions) — the decisions behind the platform
- [Jobs and schedule](@jobs) — the full list with exact times
- [Configuration](@config) — which setting lives where
:::

For the overall layers and processes see [Architecture](@architecture); for who is responsible for what, [Who does what](@who-does-what); for where to look for truth, [State and truth](@state-and-truth).

:::guarantees
- The platform observes and reports: health does not repair, maintenance does not touch containers, volumes and working copies.
- Every service listens only on `127.0.0.1`; the only way in from outside is through Cloudflare Access.
- Secrets stay out of Git, logs and the ordinary snapshot; the only copy made of them is the encrypted archive.
- Decisions that cannot be undone — merging, deploying, publishing documentation, deleting preserved work — stay with you.
:::

:::code-map
- `deploy/systemd/` — services and timers installed on the server
- `integrations/hermes/scripts/` — Hermes job scripts
- `integrations/hermes/plugins/kurami-discord-controls/` — the plugin for Discord buttons and commands
- `src/system/` — health, network, backup, recovery, maintenance
- `src/hub/` — the Hub server
- `src/core/kurami-home.ts` — the only place where `$KURAMI_HOME` is determined
:::
