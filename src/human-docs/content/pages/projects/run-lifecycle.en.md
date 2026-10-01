---
title: Run lifecycle
nav: Lifecycle
summary: All run states, who moves a run from one to another and why, and the three fields that together describe where a run is.
section: projects
group: internals
order: 40
next: codex-sessions
---

A run is one row in the `runs` table: one attempt to do one issue. Where that attempt stands is described by three fields: `state`, `owner_state` and `stop_reason`.

:::glance
- What it is: the run's state machine in the Run Store, ten states actually in use
- Changed by: admission, the controller and its child scripts, each in its own transaction
- Recorded in: `runs.state`; every change is a row in `run_state_history` with a reason
- Terminal states: `rejected`, `cancelled`, `archived`
- In parallel: `owner_state` (who holds Codex) and `stop_reason` (why we stop)
- What you see: the run card's stage in Discord
:::

```diagram
kind: graph
title: Run states
desc: A run starts in admission_pending or directly in rejected. It then goes through starting into running, and on to either parked_review, the review pause, or remote_owned when you take the session. Failures lead to needs_attention. Completion and cancellation go through stopping into archived or cancelled.
node adm "admission_pending" "admitted" state at 0,0
node starting "starting" "copy being created" state at 1,0
node running "running" "Codex working" state at 2,0
node remote "remote_owned" "with you in Codex" state at 3,0
node rej "rejected" "admission refused" fail at 0,1
node attn "needs_attention" "needs a decision" wait at 1,1
node parked "parked_review" "review pause" state at 2,1
node note "from any live state" note at 3,2
node stopping "stopping" "completion or cancel" state at 2,2
node archived "archived" "merge proven" end at 1,3
node cancelled "cancelled" "cancelled" end at 3,3
edge adm -> starting "copy"
edge adm -> rej "limits"
edge starting -> running "Codex"
edge running -> parked "turn done"
edge running -> remote "handoff"
edge parked -> remote "Continue"
edge remote -> running "autonomous" dashed
edge running -> attn "failure" accent
edge attn -> parked "recovery" dashed
edge parked -> stopping "Done, Cancel"
edge note -- stopping
edge stopping -> archived "merged"
edge stopping -> cancelled "cancel"
edge stopping -> attn "blocked" accent
```

CI repair and review fix use exact app-server thread and turn receipts plus acknowledged process exit. Primary writers, successors and sessions started before this release keep TUI completion observation, runtime limits and Remote handoff. AI review retains its read-only protocol path. Git, PR and CI results remain separate from task completion; see [Codex session](@codex-sessions).

## Three fields

`state` says what stage the run is at. `owner_state` says who holds the Codex task now: `none` is nobody, `cli` is a managed Kurami tmux session, `remote` is you in the Codex app. `stop_reason` is the stop intent: empty, `cancelled` (cancellation) or `completed` (Done). Cancellation beats everything: a run with `stop_reason = cancelled` cannot be revived by a move to Human Review or Done, nor by the Take control button. That is why the stop reason is stored apart from the state: after a failure the controller reads it and continues the cancellation.

Two more fields help read a run: `execution_mode` (`live` or `dry_run`) and `interaction_policy` (`autonomous` or `human_control`).

## States

| State | Meaning | Entered from and how |
|---|---|---|
| `admission_pending` | The run is admitted, resources are only planned | Admission: the event passed the checks |
| `rejected` | Admission refused because of WIP or the resource guard. Terminal, no resources | Admission |
| `starting` | The working copy is being created or is ready, Codex not started yet | Working-copy creation |
| `running` | Codex works in tmux, owner `cli` | Session start; Continue autonomously from `remote_owned` |
| `parked_review` | Review pause: the card is in Human Review or Codex finished an autonomous turn | Session release; card move to Human Review |
| `remote_owned` | You took the Codex task, owner `remote` | Handoff; Continue in Codex |
| `needs_attention` | Automation stopped and waits for a decision | Copy failure, timeout, Codex permission prompt, blocked release |
| `stopping` | Completion or cancellation in progress: close the session, remove the preview, release the copy | Move to Done, Backlog or Deferred; Cancel run |
| `archived` | Completed, merge proven, resources released. Terminal | Release |
| `cancelled` | Cancelled, resources released. Terminal | Release, or confirmed discard of preserved work |

The states `handoff_pending`, `waiting_human` and `failed` are allowed by the database schema, but the code does not write them. "Preparing human control" on the card is a card stage, not a run state. How stages look in Discord is in [Controls in Discord](@owner-controls).

## Who moves a run and when

| Transition | Who and on what condition | Reason in history |
|---|---|---|
| → `admission_pending` | Admission: all checks passed | `activation_event_admitted` |
| → `rejected` | Admission: WIP or resource guard | `wip_limit_rejected`, `resource_guard_rejected` |
| → `starting` | Working-copy creation: start | `worktree_provisioning_started` |
| → `needs_attention` | Working-copy creation: git error | `worktree_provisioning_failed` |
| `starting` → `running` | Codex start | `codex_initial_turn_started` |
| `running` → `parked_review` | Session release: turn finished | `codex_cli_park_completed` / `codex_protocol_park_completed` |
| `running` → `remote_owned` | Handoff | `codex_cli_handoff_completed` |
| `parked_review` → `remote_owned` | Continue in Codex, no session | `remote_claim_completed` |
| `remote_owned` → `running` | Continue autonomously: a fresh Codex task | `autonomous_successor_claimed` |
| any live → `parked_review` | Admission: card moved to Human Review | `owner_moved_item_to_human_review` |
| `running` → `needs_attention` | Codex permission prompt two minutes in a row | `codex_waiting_on_approval` |
| any → `needs_attention` | Time limit exceeded: 240 minutes main worker, 90 minutes technical task | `…_runtime_budget_exceeded` |
| any live → `stopping` | Move to Done (`stop_reason = completed`) | `owner_moved_item_to_done` |
| any live → `stopping` | Move to Backlog or Deferred, or Cancel run (`stop_reason = cancelled`) | `owner_moved_item_out_of_active` |
| `stopping` → `archived` | Release: merge proven | `merged_worktree_release_completed` |
| `stopping` → `cancelled` | Release: clean cancellation | `clean_worktree_release_completed` |
| `stopping` → `needs_attention` | Release blocked: unmerged work or a dirty copy | `worktree_release_blocked` |
| `needs_attention` → `cancelled` | Confirmed discard of preserved work | `cancelled_local_work_discarded` |

A run with no physical resources (`dry_run` mode, or resources only planned) skips `stopping` on Done or cancel and becomes `archived` or `cancelled` at once. `needs_attention` is left in different ways: after a review fix the run returns to `parked_review`, once a permission prompt is gone to `running`, on cancellation to `cancelled`.

## Resource state

A run's resources (`run_resources.resource_state`) follow their own machine alongside the run.

```diagram
kind: graph
title: Run resource state
desc: Resources are first planned, then created and become provisioned. On completion they are released through releasing into released. An error during creation or release leaves the resources in partial.
node planned "planned" "names recorded" state at 0,0
node provisioning "provisioning" "being created" state at 1,0
node provisioned "provisioned" "copy ready" state at 2,0
node releasing "releasing" "being removed" state at 3,0
node released "released" "freed" end at 3,1
node partial "partial" "partly created" fail at 1,1
edge planned -> provisioning "creation"
edge provisioning -> provisioned "done"
edge provisioning -> partial "error" accent
edge provisioned -> releasing "release"
edge releasing -> released "done"
edge releasing -> partial "error" accent
```

Automation repairs nothing from `partial`: the run stays in `needs_attention`. Cancel run moves it to `stopping`, and release accepts resources in `partial` and removes whatever was created.

::::example The path of run TT-42
:::steps
- **Admission** — creates `r_26d6bafe366257202f23`: `admission_pending`, resources `planned`.
- **Controller** — `worktree_provisioning_started`: `starting`, `provisioning`; then resources `provisioned`.
- **Controller** — `codex_initial_turn_started`: `running`, owner `cli`.
- **Controller** — `codex_cli_park_completed`: `parked_review`, owner `none`.
- **You** — at 11:20 you move the card to Done: `stopping`, `stop_reason = completed`.
- **Controller** — `merged_worktree_release_completed`: `archived`, resources `released`. If the merge has not happened yet, the run stays in `stopping` and release answers "waiting for merge" every minute.
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| A failure in the middle of creating the copy | The run goes to `needs_attention`, resources `partial`. A hard kill right between the claim and the write leaves `starting` with resources `provisioning`: the controller rules do not pick such a run up | Press Cancel run if the card is already in `needs_attention`; otherwise sort it out by hand |
| Done before the merge | The run moves to `needs_attention` (`completion_waiting_for_merge`); work is preserved and the merge is checked every minute | Merge the PR or press **Cancel run** |
| Cancellation with unmerged work | `needs_attention` with `stop_reason = cancelled`, work preserved | Discard local work or Close draft PR & discard with confirmation, or merge |
| State changed during a step | The step refuses, the controller plans again | Nothing |

:::guarantees
- Every state change is recorded in `run_state_history` with a reason: history is append-only.
- A run with a cancellation intent cannot be revived by a card move or a button.
- A run reaches `archived` only when the merge is proven.
- One card never has two live runs at once.
:::

:::code-map
- `migrations/001_initial_run_store.sql` — the allowed states and the "one live run" index
- `src/orchestrator/projects/process-project-events.ts` — admission, Human Review, Done, cancel on event
- `src/orchestrator/runtime/automatic-plan.ts` — the next-step rules
- `src/orchestrator/runtime/controller-execution.ts` — internal transitions: `claim_remote`, `request_stop`
- `src/orchestrator/projects/worktrees/provision.ts` — `starting` and `partial`
- `src/orchestrator/projects/worktrees/release.ts` — `archived`, `cancelled`, release blocking
- `src/orchestrator/projects/sessions/runtime-budget.ts` — time limits
:::
