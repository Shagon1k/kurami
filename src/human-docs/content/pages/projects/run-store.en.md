---
title: Run Store
nav: Run Store
summary: The single database where Kurami keeps everything about runs: the key tables, the guards at database level and where to look when something goes wrong.
section: projects
group: internals
order: 110
next: projects-decisions
---

The Run Store is one SQLite file, `$KURAMI_HOME/state/orchestrator.db`, and the only memory of the Project Orchestrator. Processes live for seconds and remember nothing between runs, so everything the system knows about a run is stored here.

:::glance
- What it is: SQLite in WAL mode, all tables `STRICT`, time in ISO-8601 UTC
- Written by: board polling, admission, the controller, child scripts, the Discord plugin, the notifiers
- Schema: 32 migrations in `migrations/`, applied by `npm run db:init`
- Key rule: all foreign keys are `ON DELETE RESTRICT`; rows are not deleted
- Truth about intent: the GitHub board; the Run Store keeps the fact and the resources
- Backup: a separate job, every three days
:::

```diagram
kind: graph
title: The main Run Store tables
desc: Board cards and events are stored separately. An event gives rise to a run, and a run has a resources row, a state change log and a queue of owner commands.
node items "project_items" "project · item_id · status · present" entity at 0,0
node events "project_events" "event_id · from · to · processing_state" entity at 1,0
node runs "runs" "run_id · state · owner_state · stop_reason" entity at 1,1
node resources "run_resources" "worktree · branch · tmux · thread" entity at 0,1
node history "run_state_history" "sequence · from · to · reason" entity at 2,1
node requests "run_control_requests" "action · request_state · idempotency_key" entity at 1,2
edge items -> events "column change"
edge events -> runs "trigger_event_id"
edge runs -> resources "run_id"
edge runs -> history "run_id"
edge runs -> requests "run_id"
```

## How storage works

Every process opens the database anew. Each step takes a row, checks its state and changes it in a `BEGIN IMMEDIATE` transaction: there is one writer and the others wait up to five seconds. That is how steps overlap safely: each has its own "state has not changed" check. History tables (`run_state_history`) are append-only, and foreign keys forbid deleting anything that is referenced. A run, an event and a command therefore keep their link. The run states are described in [Run lifecycle](@run-lifecycle).

Decisions are stored together with their reasons. An event that admission ignored stays with a `processing_note`; a rejection stays as a `runs` row in `rejected` with a `rejection_reason`. "Why did it not start" can always be read from the database.

## Guards at database level

The database itself enforces some rules. A bug in the code cannot bypass them.

| Guard | What it guarantees |
|---|---|
| `runs_one_live_item_idx`: unique `(project, item_id)` unless the state is `rejected`, `cancelled`, `archived` | One card has at most one live run |
| `runs.trigger_event_id` is unique | One event creates at most one run |
| The event id is a sha256 of the transition | One column change cannot enter the queue twice |
| `run_control_requests_one_pending_action_idx`: unique `(run_id, action)` among `pending` and `processing` | No two identical commands sit in the queue; `idempotency_key` is unique too |
| `worktree_path`, `branch_name`, `tmux_session_name` are unique in `run_resources` | No two runs share a copy, a branch or a session |
| `CHECK` on states and enumerations | An unknown value cannot be written to `state`, `owner_state` or `stop_reason` |

## Which table answers which question

| Question | Table |
|---|---|
| What is on the board now and when was a card last seen? | `project_items` |
| Did the last poll succeed? How much GitHub quota is left? | `project_poll_state` |
| What happened on the board and what did admission do with the transition? | `project_events` (`processing_state`, `processing_note`) |
| What state is the run in, who holds Codex, why was it rejected? | `runs` |
| Where are the branch, copy, tmux session and Codex thread? | `run_resources` |
| Why and when did a run change state? | `run_state_history` (`reason`, `details_json`) |
| What did you press and how did the command end? | `run_control_requests` (`result_json`) |
| What does CI say about the exact commit? | `run_ci_snapshots` |
| Which limits apply now and who changed them? | `orchestrator_setting_revisions` |
| Why is admission blocked? | `resource_quarantines`, `resource_guard_events` |
| Which preview holds a slot? | `preview_leases`, `preview_slots` |

The full list of tables with a description of one row is in the [data stores reference](@data-stores). You can look at the database read-only: `sqlite3 -readonly $KURAMI_HOME/state/orchestrator.db`. Do not edit it by hand: the run's state is aligned with Git, tmux and GitHub, and editing the database alone makes it diverge from the world.

## Migrations

The schema grows by files `migrations/NNN_name.sql`. `npm run db:init` applies new ones in order, each in its own transaction, records the name in `schema_migrations` and finally runs `PRAGMA integrity_check`. For tables with constraints a migration renames the old table to `<name>_vNN`, creates a new one and copies the data: such leftovers in the database are normal. 32 migrations are applied now, from `001_initial_run_store` to `032_review_fix_reconciliation`.

::::example What to find in the database for issue TT-43
:::steps
- **You** — ask why TT-43 did not start.
- **You** — find the issue's row in `runs`: state `rejected`, `rejection_reason = WIP limit reached: global 2/2, project 1/2`.
- **You** — in `run_state_history` see the reason `wip_limit_rejected` with the numbers in `details_json`; there are no resources in `run_resources`.
- **You** — in `project_events` see the event with `processing_note = Rejected by WIP gate`.
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| The database is busy for more than five seconds | The step fails with an error, the next minute repeats it. A failed wait and a transaction longer than a second go to `logs/sqlite-locks.jsonl` with the process and the code site | Nothing; if the errors are frequent, the log shows who holds the database |
| A process is killed mid-transaction | SQLite rolls it back, the database stays intact | Nothing |
| The database diverged from Git or tmux | The resource guard finds the discrepancy and blocks admission | Sort out the resource; do not edit the database by hand |
| Database corruption | The integrity check in the health job reports the problem | Restore from a backup: [Recovery](@recovery) |

:::guarantees
- Run Store rows are not deleted and history is append-only.
- Every step changes state in a transaction and first checks that it has not changed.
- The rules "one run per card" and "one event, one run" are held by the database, not only by code.
:::

:::code-map
- `src/orchestrator/state/init-run-store.ts` — applying migrations, WAL, integrity check
- `src/orchestrator/state/database.ts` — opening the database for writing: shared settings and lock measurement
- `migrations/001_initial_run_store.sql` — events, runs, resources, history
- `migrations/002_project_snapshots.sql` — the board snapshot and poll health
- `migrations/006_run_controls.sql` — the owner command queue
- `migrations/028_resource_guardrails.sql` — resource quarantine
- `migrations/030_runtime_settings.sql` — settings revisions
- `src/orchestrator/runtime/run-read-model.ts` — the query that gathers facts about a run
:::
