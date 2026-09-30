---
title: Hub
nav: Hub
summary: A private page with the live state of projects, Git and Codex usage: what each block shows, where the numbers come from and how it is protected.
section: platform
group: guide
order: 70
next: access
---

Hub is one "how is the whole system doing" page. It only reads: it opens the Project Orchestrator database and the local repositories for reading, does not call GitHub and starts nothing. The `kurami-hub` service listens only on `127.0.0.1:8800`, and Cloudflare Access guards the way in ([External access](@access)). The page is installed as an app (PWA) but does not cache data: offline it shows only a "No connection" placeholder.

## What is on the page

| Block | What it shows | From |
|---|---|---|
| **В работе** (Working) | runs in the states `starting`, `running`, `handoff_pending`, `remote_owned` | the `runs` table |
| **Human Review** | board cards in the review column | the last successful board poll |
| **Нужен владелец** (Owner needed) | runs in the states `waiting_human` and `needs_attention` | the `runs` table |
| **Коммиты · 30 дн.** (Commits, 30 days) | commits on the base branches of all repositories | local `git log` |
| **Codex** | tokens for 7 and 30 days, cache, output, limits, the five most used models | local Codex logs |
| **Проекты** (Projects) | a row per project: cards in progress and Review, commits for 7 and 30 days, poll freshness | database, Git |
| **Коммиты по неделям** (Commits by week) | 12 weeks in UTC, summed over repositories | local `git log` |

Kurami in the project table is not an orchestrator project but a fourth repository: it only has commits. The table column "В работе" counts board cards in the In progress column, while the tile "В работе" on top counts runs. These are two different numbers.

## Where the numbers come from

Hub reads four sources, all local:

- `$KURAMI_HOME/config/projects.yaml` — the project list and column names;
- `$KURAMI_HOME/state/orchestrator.db` — opened read-only, with a one-second timeout;
- `git log` in each canonical repository on the base branch (for Kurami, the `main` branch), over 91 days, with a 4-second timeout;
- Codex's `state_5.sqlite` and the session files it points to. Hub reads them whole once and afterwards reads only the new bytes.

From the Codex logs it takes each session's cumulative token counter and the difference between neighbouring events; with no counter it uses the per-response records. Cache is part of the input tokens, output includes reasoning tokens. A limit bar shows the latest value from the local log and disappears after its reset time. The exact current limit is on the Codex usage dashboard.

## Freshness and gaps

Board numbers come from the last successful poll. Hub marks a project "Project · актуально" (fresh) if the attempt succeeded and the snapshot is under 15 minutes old, and "Project · устарело" (stale) otherwise. The server caches a snapshot for 45 seconds, and the browser requests a new fragment every minute while the tab is open and the focus is not inside a block.

When a source is missing, Hub writes "—", "Git · нет данных" (no data) or "Частичные логи" (partial logs) and does not substitute zero: zero would say there is no work, while "—" says we do not know. If a refresh fails, the browser keeps the previous values and writes "Нет связи · последние данные" (No connection · last data).

| What you see | What it means |
|---|---|
| "Project · устарело" | the last board poll failed or is older than 15 minutes — look at the cards in Discord |
| "Git · нет данных" | the repository is not found or the command did not answer in 4 seconds |
| "Частичные логи" | some Codex session files are unavailable, tokens may be higher |
| "Нет связи · последние данные" | the browser got no update, the values on the page are old |
| the page does not open | the `kurami-hub` service is not running or Access does not let you in |

## What Hub does not do

Hub does not calculate money cost or the number of closed PRs. It does not serve Codex logs or prompts and does not show local paths: the page only receives numbers and names. Inside, Hub has no login: anyone who reaches the port sees everything, which is why the port is open to `127.0.0.1` only. How the service is locked down is in [Directories, processes and deploys](@runtime-layout).

:::code-map
- `src/hub/server.ts` — the HTTP server: routes, headers, the 45-second snapshot cache
- `src/hub/snapshot.ts` — data collection: database, Git, freshness
- `src/hub/codex.ts` — reading local Codex logs
- `src/hub/render.ts` — page markup from the UI library
- `deploy/systemd/kurami-hub.service` — the read-only service
- `docs/hub.md` — how to read the numbers
:::
