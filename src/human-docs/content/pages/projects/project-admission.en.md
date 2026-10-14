---
title: Admission
nav: Admission
summary: Which checks a card move passes before it becomes a run, how limits are counted and what the resource guard does.
section: projects
group: internals
order: 20
next: controller
---

Admission is the check that decides whether a card move to In progress becomes a run. It only records a decision in the database: admission touches neither Git, tmux nor Codex. The same script also handles the other moves — to Human Review, Done, Backlog and Deferred; their effects are described in [Run lifecycle](@run-lifecycle).

:::glance
- What it does: takes events from the queue and, for each, creates a run, creates a rejection or ignores the event
- Triggered by: the one-minute cycle, under the shared lock
- Runs where: one SQLite transaction for the whole batch of events
- State: `runs` and `run_resources` (the plan for branch and working copy), `run_state_history`
- Limits: global WIP 2, project WIP 2, six working copies, disk below 85%
- What you see: the run card in Discord, or a rejection record with a reason
:::

```diagram
kind: sequence
title: How admission decides
desc: Admission first asks the resource guard to inspect directories, tmux sessions and disk and to update quarantines. Then it reads events from the Run Store, applies the checks in order and records a run in admission_pending or a rejection.
actor consumer "Admission"
actor guard "Resource guard"
actor fs "Disk and tmux" external
actor db "Run Store"
msg consumer -> guard "inspect resources"
msg guard -> fs "directories, sessions, disk"
msg guard -> db "quarantine"
msg guard -> consumer "blocked?"
msg consumer -> db "reads events"
self consumer "checks in order"
msg consumer -> db "run or rejection"
```

## Checks in order

Before dispatching a board transition, the consumer checks the issue labels recorded in the event. With `no-auto`, it marks the event ignored and dispatches no lifecycle action. There is no run, rejection or resource plan for an independent task.

Admission applies six checks in a fixed order. Checks 1–3 ignore the event with a recorded reason and create no run. Checks 4 and 5 create a `rejected` run so the reason stays visible.

| # | Check | If it fails |
|---|---|---|
| 1 | It is an issue, not a draft or PR, from the project's repository | The event is ignored |
| 2 | The issue is open and has a non-empty description | The event is ignored |
| 3 | The card has no live run yet | The event is ignored: "Live run already exists" |
| 4 | WIP limits are not exhausted | Run `rejected`: `WIP limit reached: global X/Y, project A/B` |
| 5 | The resource guard does not block admission | Run `rejected`: `Resource guard blocked admission: …` |
| 6 | Everything passed | Run `admission_pending` with planned resources |

A live run is any run except `rejected`, `cancelled` and `archived`. That is why a card moved from Human Review back to In progress creates no new run: the old one is still paused for review. Admission judges by what the event recorded: whether the issue is open, whether it has a description, which labels it has. It does not re-read GitHub. How a rejection looks in Discord and what to do about it is in [Board statuses](@board-statuses).

## How WIP is counted

WIP is the number of runs that currently occupy a slot, and admission counts them by state. Counted are `admission_pending`, `starting`, `running`, `remote_owned`, `stopping` and `needs_attention`. A run paused for review (`parked_review`) is **not counted**: it waits for you and must not block new work. It stays live, though, so a second run for the same issue cannot be created.

There are two limits: global (`max_active_global`, default 2) and per project (`max_active_per_project`, default 2). You change both in [settings](@settings), only while idle. WIP counts runs, not physical resources: those are limited separately, by the Codex limit (one by default) and the resource guard.

## Resource guard

The resource guard is an inspection of the server before every admission. It exists because an unaccounted directory or tmux session may be your work. Kurami deletes none of it: it blocks admission and calls you.

The guard compares three things. Directories under a project's worktree root against those recorded in `run_resources`. Recorded working copies against the disk, looking for missing ones. `cx-…` tmux sessions against those owned by runs. Admission is blocked when disk usage is 85% or more, when there are six working copies (four per project), when there is any discrepancy or when any quarantine is active.

```diagram
kind: graph
title: Quarantine lifecycle
desc: A discrepancy is first observed and gets the state observed. If it lasts longer than thirty minutes it becomes quarantined. When the discrepancy disappears the quarantine becomes resolved. After seven days a quarantine needs your review.
node observed "observed" "first seen" state at 0,0
node quarantined "quarantined" "over 30 minutes" wait at 1,0
node resolved "resolved" "gone" end at 2,0
node review "review_due" "after 7 days" note at 1,1
edge observed -> quarantined "30 minutes"
edge quarantined -> resolved "gone"
edge observed -> resolved "gone" dashed
edge quarantined -- review
```

Each step writes an event to `resource_guard_events`, and the notifier groups them into messages in the alerts channel: six events at a time, no mentions, no repeats after a restart. There is no cleanup button. Only you can deal with the resource; when the discrepancy disappears, the quarantine closes.

## Run names

Admission invents the run's names in advance so resources can be checked before they exist. The run id is `r_` plus the first twenty characters of the sha256 of the event id; one event creates at most one run. The branch name is the project prefix, the issue number and up to six words of the title, when it looks like `[Feature]: Add dark mode toggle`. Words are folded to Latin letters, "a", "the", "to", "for", "of" and "and" are dropped, and the length is at most 48 characters. If such a branch or directory already existed, `_retry-2`, `_retry-3` is appended. The working copy lives at `<project root>/<branch>/<repository name>`.

The `human-control` label on the issue gives `interaction_policy = human_control`, otherwise `autonomous`. The `preview-required` label turns on `preview_required`. `execution_mode` comes from `orchestrator.yaml`: `live` or `dry_run`. In dry-run, admission creates a run but no working copy ever appears.

::::example Two moves in a row
:::steps
- **Admission** — issue TT-42 "[Feature]: Add dark mode toggle": open, described, no live run, WIP 0 of 2, disk 41%. It creates `r_26d6bafe366257202f23` in `admission_pending` with a plan: branch `TT-42_add-dark-mode-toggle`, directory `<worktree_root>/TT-42_add-dark-mode-toggle/TailorTales`.
- **Admission** — three hours later you move TT-43 while TT-40 and PF-12 are running. Global WIP is 2 of 2.
- **Admission** — creates a run in `rejected` with the reason `WIP limit reached: global 2/2, project 1/2`. It has no resources.
- **You** — finish TT-40, move TT-43 to Backlog and back to In progress. That is a new event and a new run linked to the rejected one.
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| Admission fails with an error (bad config, database busy for over five seconds) | The transaction rolls back, events stay queued. The script exits with code 1, and the controller does not run in that minute either | Read `project-event-consumer-errors.log` and fix the settings |
| Resource limits are lower than run limits | Admission refuses to work: working copies must be at least the global WIP | Fix `orchestrator.yaml` |
| Every run is rejected with `Resource guard blocked admission` | Any discrepancy blocks admission in all projects until it disappears | Find the directory or tmux session named in the reason and handle it by hand |
| Rejection because of WIP | Run `rejected`, no resources, no retries | Free a slot and move the card again |
| Disk above 85% | New runs are rejected, existing ones continue | Free disk space |

:::guarantees
- Admission creates nothing in Git, tmux or Codex: it records a decision in the database.
- One card never has two live runs: a unique index enforces it, not only a check.
- A rejection is neither queued nor retried by itself.
- The resource guard only observes and reports: it never deletes or repairs a resource.
:::

:::code-map
- `src/orchestrator/projects/process-project-events.ts` — the checks, WIP, names, run creation
- `src/orchestrator/resources/guard.ts` — resource inspection, blocking and quarantine
- `src/orchestrator/resources/discord.ts` — quarantine alert batches
- `src/orchestrator/settings/runtime-settings.ts` — effective WIP limits including revisions
- `deploy/config/orchestrator.yaml` — limits and disk thresholds
- `migrations/028_resource_guardrails.sql` — the quarantine table
:::
