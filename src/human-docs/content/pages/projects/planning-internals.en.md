---
title: How Projects Digest picks the next issue
nav: Task selection
summary: The board snapshot, the reasons an issue is not ready, the selection formula with no AI, and the path of metadata proposals from Codex to a GitHub write.
section: projects
group: internals
order: 100
next: run-store
---

Projects Digest is a pipeline that turns a GitHub Project board into one card with a suggestion for "what to take next". An ordinary formula over saved facts makes the choice, and the AI only proposes values for empty fields and writes nothing itself.

:::glance
- What it does: collects board facts, picks an issue by formula, shows a card and runs batches of Priority and Effort proposals
- Who triggers it: the daily Hermes job at 06:45 UTC, and the one-minute poll when the board changed
- Rhythm: facts and card — daily and on events; an AI batch — at most once a day per project
- State: `project_triage_state`, `project_triage_rankings`, `project_metadata_proposal_batches`
- Where it runs: the Projects Digest script; the AI is a separate read-only Codex process
- What you see: the project card in the Digest channel with the batch buttons
:::

```diagram
kind: graph
title: The Projects Digest pipeline
desc: The fact collector reads the GitHub Project and saves a snapshot. The ranker picks an issue and writes a ranking. The Digest card shows the choice. Once a day the planner creates a batch, the worker asks Codex for values, you decide, and the sync writes what was accepted to GitHub.
node board "GitHub Project" "fields and statuses" external at 0,0
node snapshot "Fact collector" "board snapshot" at 1,0
node state "project_triage_state" "facts and hash" store at 2,0
node planner "Planner" "once a day" at 3,0
node card "Digest card" "Discord" external at 1,1
node rank "Ranker" "formula v2" at 2,1
node worker "Worker" "Codex, read-only" at 3,1
node gh "GitHub Project" "field writes" external at 0,2
node sync "Sync" "every minute" at 1,2
node you "You" "decide" owner at 2,2
node batch "Proposal batch" "planned → ready" store at 3,2
edge board -> snapshot "GraphQL"
edge snapshot -> state "if hash is new"
edge state -> rank
edge rank -> card "choice"
edge state -> planner "candidates"
edge planner -> worker "batch"
edge worker -> batch "proposals"
edge batch -> you "on the card" dashed
edge you -> sync "Accept batch"
edge sync -> gh "write" accent
```

## The fact snapshot

A snapshot is a saved copy of what the board says about every issue of the project, together with the verdict "is it ready to start". The collector reads the GitHub Project page by page. For each issue it takes the status, Priority, Effort, labels, whether there is a description, and the blocking and blocked issues. Then it computes a hash of the facts without timestamps. If the hash is the same, only `last_checked_at` is updated. If it is new, a row with the next `change_sequence` is appended to `project_triage_snapshots`. So ranking and the AI run only when the facts really changed.

An issue enters the choice only when it has no reason for refusal. The reasons are stored as a list, so you can see why an issue is not ready.

| Reason | Meaning |
|---|---|
| `not_issue`, `repository_mismatch` | the board item is not an issue of this repository |
| `issue_not_open` | the issue is closed |
| `not_backlog` | the issue is not in the Backlog column |
| `needs_clarification` | there is no description |
| `blocked_by_open_issue` | an open issue blocks it |
| `active_run_exists` | a run is already going on it |
| `unsupported_runtime` | the project has no working copy or base branch in its configuration |

## Ranking

The ranker gives every ready issue a number and takes the largest. The `deterministic-v2` formula adds three terms: the priority tier, the smallness of the estimate and the age. Priority weighs an order of magnitude more than the rest, so the priority you set always decides first.

| Term | Values |
|---|---|
| Priority | P0 — 5000, P1 — 4000, P2 — 3000, P3 — 2000, P4 — 1000; the words critical and urgent — 5000, high — 4000, medium — 3000, low — 2000; empty — 0 |
| Effort | XS — 40, S — 32, M — 22, L — 10, XL — 0; a number n gives 40 − 5·min(n, 8) |
| Age | whole days since creation, at most 30 |

On an equal sum the higher priority wins, then the smaller estimate, the older age, the lower issue number. Dependencies add no points: an open blocker only makes the issue not ready. The line "Owner priority P1 · Effort M · Waiting 9 days · Ready to start" on the card is built from the same numbers, so the explanation cannot differ from the choice. The result is written to `project_triage_rankings`; `suggested_since` is kept while the same issue stays selected.

## The Digest card

A project card is one message that Kurami edits in place. The card program computes a digest from the ranking, the counts, the date of the last check, the snapshot number and the state of the proposal batch. If it matches the saved one, nothing happens. So "Checked" moves at most once a day, and between checks the card does not flicker. How the card looks and which buttons it has is in [Projects Digest](@project-digest); the button names are in the [reference](@commands).

There are two entries. The daily run without arguments collects facts, ranks, starts the AI planner and draws the cards. The event run for one project does the same but skips the planner. The one-minute poll calls it when the board changed or a metadata write finished. So an event on the board refreshes the card within a minute and does not start the AI.

## The proposal batch

A batch is a frozen list of Backlog issues that have an empty Priority or Effort. The planner selects the candidates. A project's first batch is called `bootstrap` and takes all unassessed issues. Later `changed` batches take only issues whose title, status, fields, labels or description changed. Candidates are sorted in ranking order and cut by `ai_triage_daily` — 12 by default, from 0 to 40 (changed in [Settings](@settings)).

One batch per project per UTC day is allowed: `project_metadata_daily_admissions` records the date. One batch per project is active at a time. If an issue from the active batch changed, a new batch supersedes the old one (`superseded`). A batch left in `running` from an earlier day counts as dead and is replaced. The planner does not start if the managed AI load has already reached `max_llm_running_global`.

## How the AI assesses issues

The worker puts a narrow question to Codex and trusts neither the question nor the answer. It first reads every issue through `gh api` and aborts the batch if the title, description or labels changed after the snapshot. Then it starts a separate read-only Codex process, with no network, tools or permission requests. The issue text is passed as untrusted data in a safe wrapper, not as instructions. A batch is cut into parts of up to 12 issues.

The answer is validated strictly. Only fields from the empty list are allowed, Priority P1–P3, Effort XS–XL, confidence `high` or `medium`, up to four short pieces of evidence; an answer with secret-like text is rejected. P0 is impossible at the database level too. Codex may fix a format error exactly once, and a second error moves the batch to `failed`. The final text "N proposals for M issues" is written by code, not by the model.

## Decision and guarded write

A batch goes through a short chain of states, and a GitHub write is possible only at the end.

```diagram
kind: graph
title: Proposal batch states
desc: A batch is created in planned, the worker moves it to running and then to ready. You can discuss it, accept it or skip it. An accepted batch is synced and ends as applied or partially_applied. A stale batch becomes superseded, a broken one failed.
direction: right
node planned "planned" "list frozen" state at 0,0
node running "running" "Codex assessing" state at 1,0
node ready "ready" "waits for you" wait at 2,0
node accepted "accepted" "write queued" state at 2,1
node applied "applied" "written" end at 1,2
node partial "partially_applied" "some preserved" end at 2,2
node skipped "skipped" "skipped" end at 0,1
node failed "failed / superseded" "assessment dropped" fail at 0,2
edge planned -> running "worker"
edge running -> ready "proposals"
edge ready -> accepted "Accept batch"
edge ready -> skipped "Skip batch"
edge accepted -> applied "all written"
edge accepted -> partial "conflicts" accent
edge running -> failed "error" accent
```

**Accept batch** only marks the proposals accepted. The sync does the write on every one-minute pass. For each field it reads the current value in the GitHub Project again and decides by the rules below.

| Current value in GitHub | Decision |
|---|---|
| equals the proposal | counted as applied, no write needed |
| empty | the proposed value is written |
| equals a value Kurami wrote earlier | the proposed value is written |
| anything else | conflict: the owner's value stays |
| P0 proposed | refused |

The written value is remembered in `project_metadata_field_ownership`, so later Kurami tells its own value from yours. A transient GitHub error defers the batch and gives one more automatic attempt. After two failures the card shows **Retry sync**.

::::example A proposal batch for PickFlick
Six Backlog issues lack a Priority or Effort, `ai_triage_daily = 12`. The data is invented.
:::steps
- **Digest** — at 06:45 UTC it takes a snapshot: `change_sequence` 17, and picks PF-31 ("Owner priority P1 · Effort M · Waiting 9 days").
- **Planner** — there was no batch yet, so it creates `bootstrap` batch #1 of six issues and records the admission for this date.
- **Worker** — reads the six issues, asks Codex to assess and gets seven proposals. The batch becomes `ready` and the card says "Ready · 7 pending".
- **You** — at 09:10 you open Review proposals, exclude the P1 proposal for PF-52 and press Accept remaining. Six proposals are accepted, the batch is `accepted`.
- **Sync** — at 09:11 five fields are empty and get written. On PF-44 you set Effort L yourself yesterday: the value is not empty and was not written by Kurami, so the proposal gets `conflicted`.
- **Digest** — updates the card: "Partially applied · 5 applied", "1 owner values preserved".
:::
::::

```diagram
kind: timeline
title: An example day with a batch
desc: At 06:45 the daily run takes a snapshot and creates a batch. By 07:20 the batch is ready. At 09:10 you accept it, and at 09:11 the sync writes the values to GitHub.
lane digest "Digest"
lane you "You"
lane sync "Sync"
range 06:00-10:00
at digest 06:45 "Snapshot and batch" accent
at digest 07:20 "Batch ready"
at you 09:10 "Accept"
at sync 09:11 "Write"
```

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| GitHub is unavailable while collecting facts | the script exits with an error, the previous card stays | nothing: the next run retries |
| Codex returned an invalid answer twice | the batch is `failed` | wait for the next day |
| An issue changed after the snapshot | the batch is `superseded`, a new one will be created | nothing |
| The worker died and the batch hangs in `running` | the next day the batch is closed and replaced | nothing |
| No free AI capacity | the planner skips the day for the project | nothing |
| You changed the field | the proposal gets `conflicted`, your value stays | nothing |
| GitHub returned an error on write | one automatic retry, then Needs attention | press Retry sync |
| The discussion thread cannot be archived | Accept and Skip refuse | close the thread and press again |

:::guarantees
- The AI works read-only: no network, tools, permissions or GitHub writes.
- The formula, not the model, chooses the suggested issue.
- Kurami never proposes P0 and never infers dependencies.
- Accept writes nothing to GitHub: the write goes separately, by the rules in the table.
- A value you set yourself is never overwritten.
- A project gets at most one batch a day and one active batch.
:::

:::code-map
- `run-projects-digest.sh` — the pipeline: facts, ranking, planner, card
- `src/orchestrator/projects/triage/snapshot.ts` — the board snapshot and reasons for not ready
- `src/orchestrator/projects/triage/rank.ts` — the selection formula
- `src/orchestrator/projects/digest/discord.ts` — the Digest card and its buttons
- `src/orchestrator/projects/metadata/proposals/scheduler.ts` — the daily admission of batches
- `src/orchestrator/projects/metadata/proposals/worker.ts` — Codex assessment and answer validation
- `src/orchestrator/projects/metadata/controls.ts` — the owner's decisions
- `src/orchestrator/projects/metadata/sync.ts` — the guarded write to GitHub
:::
