---
title: Where state lives
nav: State and statuses
summary: Every question about Kurami has one place with the right answer. Here are those places, how to read statuses, and why a Discord card only shows state and never holds it.
section: basics
group: internals
order: 30
next: how-to-read
---

Every question about Kurami has one place where the right answer lives — its *source of truth*. Discord cards, site pages and messages only show a copy of that answer. When a card and the database disagree, the database wins: the next cycle redraws the card from it.

:::glance
- Intent: the GitHub Project board — which issues you want in progress
- Runs: `state/orchestrator.db` — the Project Orchestrator Run Store
- Editions: `state/briefing/briefing.db` and the pages in `state/briefing/pages/`
- Docs: `state/human-docs/proposals.db` and the published release
- Health: the cycle in `state/system-health.db`; settings: revisions in the Run Store and `state/health-settings.json`
- Display: Discord, the sites and Hub — redrawn from the stores; Hub's few controls change state only through the canonical tools
:::

## Map of the stores

```diagram
kind: graph
title: Who writes to which store
desc: Each product writes only to its own store. Project Orchestrator writes to orchestrator.db, Digest to briefing.db and the edition pages, the platform to the health database, JSON files and the backup folder. Discord and the sites read and display; Hub also reads, and its few controls write only through the canonical tools.
node projects "Project Orchestrator" at 0,0
node digest "Digest" at 1,0
node platform "Platform" at 2,0
node runstore "orchestrator.db" "runs, events, previews" store at 0,1
node briefing "briefing.db" "editions, attempts, add-ons" store at 1,1
node files "system-health.db" "health cycle, settings" store at 2,1
node backups "backups/" "copies of the databases" store at 2,2
node discord "Discord" "cards" external at 0,2
node sites "Sites" "Digest, Hub, docs" external at 1,2
edge projects -> runstore
edge digest -> briefing
edge platform -> files
edge platform -> backups "every 3 days"
edge runstore -> discord "redraw" dashed
edge briefing -> sites "pages" dashed
edge runstore -> backups dashed
```

## Which question, which place

| Question | Where the right answer is | What to look at |
|---|---|---|
| Which issues do I want in progress? | the GitHub Project board | the issue columns |
| Is work on an issue going on? | `orchestrator.db`, table `runs` | the `state` field and the `run_state_history` log |
| Did CI pass for this PR? | `orchestrator.db`, `run_ci_snapshots` | the result for the exact SHA of the latest commit |
| Did today's edition go out? | `briefing.db`, the edition attempt | the attempt stage and the notice receipt |
| Is the server healthy? | the cycle in `state/system-health.db`, shown on the health card and in Hub | the last check time and active problems |
| Is there a fresh backup? | `$KURAMI_HOME/backups/` | the newest `backup-*` folder and its `manifest.json` |
| Which docs are published? | `state/human-docs/release/build.json` | `docsSha` — the commit the site was built from |

The exact database tables, each with a description, are in the reference page [Data stores](@data-stores).

## Discord is a display, not a source

Every Discord card is built from a database. Once a minute the Project Orchestrator controller compares what a run card should show with what it shows, and edits it only when something changed. The health card is rewritten on every check. If you delete the message, the next cycle creates a new one and remembers its ID. So you can trust a card as an indicator, but decisions about state are made from the database.

## How to read statuses

A status in Kurami always refers to one result, not to the whole system. One failed section of an edition does not mean all of Digest is broken.

| Word | Meaning |
|---|---|
| **Current** | the latest accepted value for the time and source shown |
| **Stale** | a fresh check failed or is overdue; the last trustworthy value is shown |
| **Partial** | useful parts passed their checks and the gaps are shown explicitly |
| **Failed** | no new result was accepted; the previous successful result may stay in place |
| **Waiting for you** | the next step cannot be taken automatically and needs your decision |
| **Accepted** | this product's own checks passed; it is not permission to merge or deploy |

Kurami shows a missing value as "—", never as zero. Zero is a measured zero; a dash means "unknown".

## "Job succeeded" is not a result yet

Hermes marks a job successful when its script exits without an error. That does not mean the work is done: the script may have exited honestly after seeing there was nothing to do or that it was too early. So each process keeps its own proof of result — the Daily notice receipt, the health card's update time, the backup manifest, the docs `build.json`. Look at those, not at the scheduler's mark.

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| A Discord card is stale or deleted | the next cycle redraws it or creates it again | nothing; if it stays stale for long, check Hermes health |
| A source check failed | shows the last trustworthy value marked "stale" | nothing unless it repeats; then read the log |
| `orchestrator.db` is lost | restore from the latest verified backup | follow the order in [recovery](@recovery) |
| `briefing.db` is lost | restore it from the latest backup that contains it; older backups made before this was added do not, and the history starts again | check that your newest backup lists `briefing.db` ([recovery](@recovery)) |

:::guarantees
- Every question has one place with the right answer; displays are redrawn from it.
- An unknown value is shown as "—" and never passed off as zero.
- A failure of one result never poses as a failure of the whole system and never erases the previous successful result.
:::

:::code-map
- `migrations/` — the `orchestrator.db` schema
- `migrations/briefing/` — the `briefing.db` schema
- `src/orchestrator/runtime/run-read-model.ts` — how the controller reads a run's state
- `src/orchestrator/controls/discord.ts` — redrawing run cards
- `src/system/recovery/backup-state.ts` — what goes into a backup
:::
