---
title: From board to event
nav: From board to event
summary: How polling turns a card move into one reliable event, and why a GitHub failure or a restart neither duplicates nor starts anything extra.
section: projects
group: internals
order: 10
next: project-admission
---

Board polling is a script that reads the GitHub Project once a minute, compares each card's column with the previous snapshot and records every column change as an event in a queue.

:::glance
- What it does: reads the board, keeps a card snapshot, records column transitions as events
- Triggered by: Hermes cron, once a minute, separately for each project
- Runs where: a short script in the one-minute cycle; a file lock per project
- State: `project_items`, `project_events`, `project_poll_state` in the Run Store
- GitHub access: read-only, through the GitHub CLI (`gh`) with the owner's token
- What you see: nothing directly; the consequence is a run in Discord or "Waiting for GitHub"
:::

```diagram
kind: graph
title: Board polling: from GitHub to the event queue
desc: Polling reads the board in pages of one hundred cards. Inside one transaction it compares each column with the stored snapshot, records an event on a change, then updates the snapshot and the poll health mark. Admission later takes events from the queue.
node board "GitHub Project" "cards and columns" external at 0,0
node poller "Polling" "gh api graphql" at 1,0
node items "project_items" "card snapshot" store at 1,1
node events "project_events" "transition queue" store at 2,1
node state "project_poll_state" "poll health" store at 0,1
node admission "Admission" "takes events" at 2,2
node lock "Lock" "one poll per project" note at 2,0
edge board -> poller "reads"
edge poller -> items "updates"
edge poller -> events "on column change"
edge poller -> state "success or failure"
edge events -> admission
edge lock -- poller
```

## The first poll is a baseline

Polling keeps a snapshot of every card: its column, its issue and the time it was last seen. While a project has no row in `project_poll_state`, polling is in *baseline* mode: it records all cards but creates no events. That is why an issue already in In progress when you connected the project starts nothing. Otherwise connecting a project would launch uncontrolled Codex runs all at once.

From the second poll on, the mode differs. Polling marks all the project's cards as absent, then walks through the fetched ones. If a card is known and its column differs from the stored one, polling records an event. A card absent from the snapshot gives no event: a new issue created straight in In progress does not start. Only a move can start work. What each move does is in [Board statuses](@board-statuses).

## The event and its id

The event id is computed from its content, so the same change cannot enter the queue twice. It is a sha256 of five values: the project, the card id, the time the card was last seen, the previous column and the new column. Inserting the same id again is ignored. If the process dies before the transaction commits, the next poll sees the same change and computes the same id.

The event carries the data admission will judge later: whether the issue is open, whether it has a non-empty description and which labels it has. Admission does not re-read GitHub. The decision is therefore made on the state the issue had at the moment of the move.

## One transaction per project

The snapshot, the events and the health mark are written in one SQLite transaction. Polling does not leave the database half updated: all or nothing. After a success, `project_poll_state` gets the snapshot time, the card count, the duration and the remaining GitHub quota. After a failure it gets `last_attempt_state = failed` and the error text.

The board is read by a GraphQL query, one hundred cards per page. It reads the column and, for an issue, its state, title, address, description, labels and repository. Projects belong to a user, not an organization: the query goes through `user(login: …)`.

## The one-minute cycle and locks

Polling is the second stage in `run-project-poller.sh`. Three projects start at the same moment, and each has its own lock `project-poller-<project>.lock`: if the previous poll is still running, the new one exits silently. Polls of different projects run in parallel. Admission and the controller come later under one shared lock; see [Controller](@controller).

If polling found transitions, it prints their text and the script refreshes Projects Digest. If polling failed, the script writes the error to a log and continues the cycle: existing runs must be served while GitHub is unavailable.

::::example Issue TT-42 moves to In progress
:::steps
- **Kurami** — at 10:01:04 polling reads the tailortales board. The project already has a `project_poll_state`, so the mode is poll.
- **Polling** — card `PVTI_lAHOABC123` was Backlog and is now In progress. It computes `event_id = c482c789e9b7…` and writes the event with the description flag, labels and issue state of that moment.
- **Polling** — updates `project_items.status` and `project_poll_state.last_captured_at`, commits and prints `tailortales #42: Backlog → In progress`.
- **Admission** — in the same minute takes the event from the queue and creates run `r_26d6bafe366257202f23`.
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| GitHub is down, the token expired or the quota is exhausted | Polling exits with an error and records `last_attempt_state = failed`. If the snapshot is older than two minutes, no new working copies or Codex sessions start and the card shows "Waiting for GitHub". Existing runs keep being served | Check the `gh` token; after a successful poll everything resumes by itself |
| The polling process is killed mid-write | The transaction rolls back. The next poll finds the same transition and writes the same event | Nothing |
| Two polls of one project overlap | The second sees the lock and exits without acting | Nothing |
| A card was moved there and back between two polls | Kurami does not see the intermediate columns: it compares only with the previous snapshot | Nothing |
| A card was created straight in In progress | No event; the issue enters the snapshot | Move it to Backlog and back to In progress |

The controller checks snapshot freshness: only two steps, creating the working copy and starting Codex, need a poll no older than two minutes. Everything else is served without a fresh poll.

:::guarantees
- Polling only reads GitHub and changes nothing on the board.
- A project's first poll starts nothing; only a move of a known card starts a run.
- One column change yields at most one event, even after a crash and a repeated poll.
- New working copies and Codex sessions start only on a board snapshot no older than two minutes.
:::

:::code-map
- `run-project-poller.sh` — the one-minute cycle and the project lock
- `src/orchestrator/projects/poll-projects.ts` — board query, snapshot, events, poll health
- `src/orchestrator/runtime/run-predicates.ts` — the two-minute freshness check
- `migrations/001_initial_run_store.sql` — the `project_events` table
- `migrations/002_project_snapshots.sql` — the `project_items` and `project_poll_state` tables
- `deploy/config/projects.yaml` — which boards to read
:::
