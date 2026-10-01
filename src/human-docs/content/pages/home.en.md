---
title: Kurami
summary: A private agent system on its own server. It builds the morning news edition, runs engineering work on projects and looks after the server, and leaves the decisions to you.
---

Kurami is a set of processes on one VPS that run on a schedule and on your commands in Discord. Most of the work is ordinary deterministic code: it polls sources, checks data and records state in SQLite. A model steps in only where nothing else will do: writing the text of an edition or the code for an issue. Everything that cannot be undone — merging, deploying, deleting work — stays with you.

```diagram
kind: graph
title: Kurami as a whole
desc: You talk to Kurami through Discord. On the server, Hermes runs scheduled jobs and keeps the Discord connection, and Kurami has three parts — Digest, Project Orchestrator and the platform. Outside are the news and mail sources, GitHub and Codex.
node you "You" "Discord, GitHub, sites" owner at 1,0
node discord "Discord" "cards and buttons" external at 0,1
node hermes "Hermes" "schedule, agents" at 1,1
node web "Sites" "Digest, Hub, docs" external at 2,1
node digest "Digest" "morning edition" at 0,2
node projects "Project Orchestrator" "engineering work" at 1,2
node platform "Platform" "health, backups" at 2,2
node sources "Telegram, Gmail, calendar" "Digest sources" external at 0,3
node github "GitHub and Codex" "boards, PRs, CI" external at 1,3
group kurami "Kurami on the server" hermes digest projects platform
edge you -> discord "commands"
edge you -> web "you read"
edge discord <-> hermes
edge hermes -> digest
edge hermes -> projects
edge hermes -> platform
edge sources -> digest
edge projects <-> github
```

## How to read these docs

The docs are built in layers. The further you read, the deeper you go, but the overall picture forms on the first pages.

| Layer | Reading time | What it gives you |
|---|---|---|
| This page | a minute | what Kurami is and what it is made of |
| **Start here** in each section | 5 minutes | how the product works as a whole, in one diagram and one example |
| **Guide** | 3–5 minutes each | what you see, what to press and what to do when something is wrong |
| **How it works** | 10–15 minutes each | the mechanism from inside: states, stores, failures and recovery |
| **Reference** | as needed | exact tables, built straight from the code |

:::cards
- [Kurami in five minutes](@what-is-kurami) — three products, one server, and where you fit in
- [Digest](@digest) — the morning edition and reviews: how they are built
- [Project Orchestrator](@project-orchestrator) — issues from a GitHub board, done by Codex
- [Platform](@platform) — Hermes, the schedule, server health, backups
- [Architecture](@architecture) — processes, stores and how code reaches the server
- [Glossary](@glossary) — every Kurami term in one place
:::
