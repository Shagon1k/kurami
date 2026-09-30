---
title: Kurami in five minutes
nav: What Kurami is
summary: Three products on one server, a shared scheduler and one rule: code does everything that can be checked, a model does only what nothing else can, and irreversible decisions stay with you.
section: basics
group: start
order: 10
next: who-does-what
---

:::glance
- What it is: a private agent system on one VPS, built on top of Hermes
- Products: Digest (the morning edition and reviews), Project Orchestrator (engineering work), the platform (health, backups, sites)
- How it runs: on Hermes and systemd schedules, and on your buttons and commands in Discord
- Where state lives: SQLite databases and JSON files under `$KURAMI_HOME/state`
- Where you see it: Discord cards, the Digest and Hub sites, these docs
- Yours to decide: merging PRs, deploying, deleting preserved work, changing settings
:::

Kurami solves three problems. **Digest** builds an edition every morning: news from Telegram channels, unread mail, the calendar and the weather, plus the weekly and cinema reviews at the weekend. **Project Orchestrator** turns issues on a GitHub board into work for Codex: its own branch, a PR, CI, a review. **The platform** keeps all of it running: it watches the server, makes backups, cleans up once a month and publishes the sites.

The three parts share no state. Each has its own database, its own rules and its own answer to "is it done". What they share is the server, the Hermes scheduler, Discord as the control panel and one interface library for the sites.

## One picture

```diagram
kind: graph
title: Three products on a shared base
desc: Hermes runs the jobs of the three products on a schedule and passes them your commands from Discord. Each product keeps its state in its own database. Only two places call a model — Digest for the edition text and Project Orchestrator for Codex work.
node you "You" owner at 1,0
node hermes "Hermes" "cron, Discord, agents" at 1,1
node digest "Digest" "code + one agent step" at 0,2
node projects "Project Orchestrator" "code + Codex" at 1,2
node platform "Platform" "code only" at 2,2
node briefing "briefing.db" "editions" store at 0,3
node runstore "orchestrator.db" "runs" store at 1,3
node files "state/*.json" "health, backups" store at 2,3
edge you <-> hermes "Discord"
edge hermes -> digest
edge hermes -> projects
edge hermes -> platform
edge digest -> briefing
edge projects -> runstore
edge platform -> files
```

## An ordinary day

:::steps
- **Night** — every three days Kurami makes a verified copy of the Project Orchestrator database and configuration, and, when configured, an encrypted archive off the server.
- **Every minute** — the GitHub boards are polled: if you moved an issue, Kurami notices and starts work.
- **Every few minutes** — a server health check, at the interval you choose in settings. The Discord card updates, and an alert arrives only when a problem persists for several checks in a row.
- **09:00 local time** — Digest builds the edition. The agent writes the text, code checks and publishes it, and a notice appears in Discord. If there is no edition by 10:00, a recovery run starts.
- **Every hour** — mail, calendar and weather refresh in the published edition. The news stays the same.
- **Whenever it suits you** — you read the PRs Codex prepared and decide what to merge.
:::

## The main rule: an agent only where it is needed

:::compare
### Code
Polling sources, checks, limits, states, publishing, notices, backups, cleanup. All deterministic, repeatable and recorded in a database.
### Agent
Two places: the text of the morning edition (one editorial decision) and Codex's engineering work in a separate working copy. Code always checks what the agent produced.
### You
Merging and deploying, deleting preserved work, changing limits and settings, publishing documentation edits.
:::

This is why Kurami does almost nothing silently. If something cannot be checked or safely repeated, the process stops and shows its state in Discord, and you decide what happens next.

## Where to go next

:::cards
- [Who does what](@who-does-what) — you, Hermes, Kurami code, agents, GitHub and Discord
- [Architecture](@architecture) — the processes on the server and how they connect
- [Where state lives](@state-and-truth) — which database answers which question
- [How to read these docs](@how-to-read) — layers, diagram notation and status words
- [Digest](@digest) — the morning edition from inside
- [Project Orchestrator](@project-orchestrator) — issues from the board that Codex does
:::

:::code-map
- `src/briefing/` — Digest: collecting, checking and publishing editions
- `src/orchestrator/` — Project Orchestrator: boards, runs, Codex, previews
- `src/system/` — server health, backups, maintenance
- `integrations/hermes/` — the Discord plugin, skills and job scripts for Hermes
- `deploy/` — configuration and systemd units
:::
