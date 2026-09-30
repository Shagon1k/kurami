---
title: Controller
nav: Controller
summary: How once a minute the controller picks one next step for each run, performs it, and why overlapping cycles or a crash break nothing.
section: projects
group: internals
order: 30
next: run-lifecycle
---

The controller is a script that once a minute reads all runs from the Run Store and picks exactly one next step for each: create a working copy, start Codex, release the session, move the card to Human Review, clean up resources.

:::glance
- What it does: plans and performs the next step of every run and every owner command
- Triggered by: `run-project-poller.sh`, once a minute, under the shared lock
- Runs where: a short process; the steps themselves are child scripts
- State: only the Run Store; nothing is kept in memory between cycles
- Limit: by default one Codex or AI review at a time (the Concurrent LLM setting)
- What you see: the run card's stage changing in Discord
:::

```diagram
kind: graph
title: The one-minute cycle under the shared lock
desc: Each project polls its own board. The script run that obtained the shared lock then performs admission, time budgets, the controller and the Discord refresh for all projects in turn.
node poll "Board polling" "one per project" at 0,0
node lock "Shared lock" "one run takes it" decision at 1,0
node admission "Admission" "events to runs" at 0,1
node budget "Time budgets" "session timeouts" at 1,1
node controller "Controller" "step per run" at 2,1
node discord "Discord" "cards and threads" external at 3,1
node runs "Run Store" "runs, requests" store at 1,2
node child "Child scripts" "copy, Codex, release" at 2,2
edge poll -> lock
edge lock -> admission "obtained"
edge admission -> budget
edge budget -> controller
edge controller -> discord
edge controller <-> runs
edge controller -> child "calls"
```

## The controller cycle

The controller works in a fixed order so each step sees the result of the previous one. First it recomputes the bookkeeping records: CI repair attempts, review-fix rounds, AI reviews, one-time notifications and progress cards. Then it counts how many LLM processes already run. After that it builds the plan: one step per run and one step per owner command. Then it executes the plan in turn and recomputes the bookkeeping after each step. At the end it refreshes notifications and cards once more.

The plan is built once, at the start. That is why the working copy and the Codex start happen in different minutes: the run becomes `starting` only after the plan is made. This is the price of simplicity: a cycle does not build a chain of steps blindly, and every step rests on fresh state.

The controller changes anything only with `mode: live` in `orchestrator.yaml`. In `dry_run` it refuses `--apply`, and without `--apply` it just prints the plan, so you can see what it would do.

## Next-step rules

The next step is chosen by a set of rules: the first matching one wins. The rules only read one row of a summary query that already gathers facts about the run, CI, preview and review, and change nothing. Here they are, grouped by meaning.

| Run condition | Step | What happens |
|---|---|---|
| The preview expired | `preview_expire` | The preview is removed |
| The owner reviewed the preview of the exact commit and Done was already requested | `preview_requirement_complete` | The run moves on to completion |
| Paused for review, PR and CI known, card still in In progress | `project_review` | The card moves to Human Review |
| A review-fix round reached `resolving` | `review_fix_resolve` | GitHub threads are replied to and resolved |
| A technical Codex task is left over | `repair_cleanup`, `review_fix_cleanup` | The main thread is restored |
| Cancelled, resources released | `project_backlog` | The card moves to Backlog |
| A cancellation intent exists | `cancel_cli`, `resume_stop` | The cancellation becomes action |
| `admission_pending` and the board snapshot is fresh | `provision` | Branch and working copy are created |
| `starting`, copy ready and snapshot fresh | `start` | Codex starts in tmux |
| Work is running, no Codex thread yet | `sync` | The thread id is recorded |
| Codex finished its turn, run is autonomous | `park` | The session closes, the run is paused for review |
| A run with the `human-control` label, thread known | `handoff` | The run is handed to you |
| `stopping`, no tmux and no preview | `release` | Copy and branch are removed when safe |

"Snapshot fresh" means the last poll succeeded and is no older than two minutes. Only `provision` and `start` wait for it: new work must not begin on a stale board, while serving existing runs continues.

The controller recognises a finished turn from the text in the Codex terminal; the signs are described in [Working copy and Codex session](@codex-sessions).

## Owner commands

A Discord button executes nothing itself: it puts a request into a queue. The controller picks it up in the next cycle and turns it into a step. How the request reaches the queue is in [Discord: cards and commands](@discord-control-plane); the buttons themselves are in [Controls in Discord](@owner-controls).

```diagram
kind: sequence
title: The path of an owner command
desc: You press a button. The Discord plugin passes the command to a script, which checks it is allowed and puts a row in the queue. In the next cycle the controller picks a step, calls a child script and records the result, and the notifier updates the card.
actor you "You" owner
actor plugin "Discord plugin"
actor queue "Command queue"
actor controller "Controller"
actor child "Child script"
msg you -> plugin "presses button"
msg plugin -> queue "request"
self queue "check and record"
note queue "card changes at once"
phase "Next minute"
msg controller -> queue "takes command"
msg controller -> child "step"
msg child -> queue "result" dashed
```

Checks run twice. The command script refuses at once with a human sentence, for example "Takeover is unavailable after cancellation was requested". The controller checks again at execution time and records a refusal reason, for example `run_not_takeover_eligible`. The Cancel run command beats the others: it moves the run to `stopping` and rejects all other commands of that run.

## Child scripts and re-checking

The controller itself does almost nothing: it calls narrow scripts. Each script re-reads the run in its own transaction and refuses if the state has already changed ("Run changed before …"). That is the protection against races. Two overlapping cycles cannot create two working copies: the second script sees that the run is no longer `admission_pending`.

Before starting Codex the controller compares the number of running Codex and AI reviews with the limit (`max_llm_running_global`). If the limit is taken, the steps `start`, `successor_start`, `repair_start`, `review_start` and `review_fix_start` are deferred to the next minute. The run waits in `starting` with its copy ready.

If a child script fails, the step is deferred and repeated in the next cycle. The command stays in the queue, except review, fix and recovery starts: their commands are marked `failed`, because a repeat could restart work that has already begun.

::::example Run TT-42 in one hour
:::steps
- **Controller** — at 10:01 the rule `provision` creates the branch and copy: `admission_pending` → `starting`.
- **Controller** — at 10:02 the rule `start` launches Codex in tmux `cx-tt-42-26d6ba`: `running`, owner `cli`.
- **Controller** — at 10:03 the `sync` step records the Codex thread id.
- **Controller** — at 10:44 the terminal shows "Worked for 41m 12s", the `park` step closes the session: `parked_review`.
- **Controller** — at 10:45 `project_review` moves the card to Human Review.
- **Controller** — at 11:21, after your Done and the merge, `release` removes the copy and branch: `archived`.
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| Two script runs overlap | The lock lets one through; the other skips admission and the controller | Nothing |
| Admission or the time budget fails | The script exits with code 1 — the controller does not run in that minute for any project | Read `project-event-consumer-errors.log` and `runtime-budget-errors.log` |
| A child script refuses ("Run changed before …") | The step is deferred, the plan is rebuilt next minute | Nothing |
| The Codex limit is taken | The run waits in `starting`, the step is deferred | Wait or raise the limit in [settings](@settings) |
| The server was rebooted | State is intact in the database; the tmux sessions are gone | Watch the card: the session error shows there |
| The controller runs in `dry_run` | It refuses to change anything | Switch to `mode: live` deliberately |

:::guarantees
- The controller picks at most one step per run per cycle.
- Every step re-checks the state in its own transaction and refuses if it changed.
- No more Codex and AI reviews run than `max_llm_running_global` allows.
- New working copies and Codex sessions start only on a fresh board snapshot.
- An owner command goes through the queue and is checked twice; Cancel run beats the rest.
:::

:::code-map
- `src/orchestrator/runtime/controller.ts` — the cycle: plan, LLM limit, execution
- `src/orchestrator/runtime/automatic-plan.ts` — the next-step rules for a run
- `src/orchestrator/runtime/request-plan.ts` — which owner commands are allowed and refusal reasons
- `src/orchestrator/runtime/run-read-model.ts` — the query that gathers facts about a run
- `src/orchestrator/runtime/controller-execution.ts` — the mapping from step to child script
- `src/orchestrator/runtime/controller-cycle.ts` — the order of bookkeeping recomputations
- `src/orchestrator/runtime/codex-terminal.ts` — signs of a finished turn
- `run-project-poller.sh` — stage order and locks
:::
