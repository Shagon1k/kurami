---
title: Working copy and Codex session
nav: Codex session
summary: How Kurami prepares a separate branch, starts Codex in it under supervision, and recognises that a turn has finished.
section: projects
group: internals
order: 50
next: engineering-evidence
---

Kurami runs CI repair and review-fix tasks through app-server and records exact thread and turn identities in the Run Store.

:::glance
- Protocol scope: CI repair and review fix; AI review retains its read-only protocol
- Trigger: the controller starts one managed task in its assigned working copy
- Runtime: a private stdio app-server worker; tmux supervises the process
- State: task identity, thread id, turn id, completion status and process stop receipt
- Result: a completed turn can be parked; PR, Git and CI evidence remain separate
- TUI path: primary writers, successors, human-control and legacy sessions keep completion observation and Remote controls
:::

```diagram
kind: graph
title: Exact execution identity
desc: The controller claims a task and launches a worker. The worker starts one thread and one turn through app-server. Exact completion events and process stop receipts go to the Run Store. The controller checks these receipts before parking; PR and CI evidence are checked separately.
node ctl "Controller" "claim and park" at 0,0
node worker "Managed worker" "tmux supervisor" at 1,0
node server "app-server" "private stdio" at 2,0
node store "Run Store" "task, thread, turn, status" store at 1,1
node worktree "Working copy" "one writer" store at 2,1
node evidence "Git / PR / CI" "independent outcome" external at 0,1
edge ctl -> worker "launch"
edge worker -> server "thread/start, turn/start"
edge server -> worktree "sandboxed tools"
edge worker -> store "exact receipts"
edge ctl -> store "read"
edge ctl -> evidence "verify"
```

Primary autonomous writers and successors continue to launch through the existing TUI. Human-control and Remote handoff stay on that path. The migration creates no inferred protocol identities for older sessions.

## Working copy and credentials

Kurami creates a separate linked working copy and branch for each admitted run. Before dispatch, it checks the configured root, repository, branch and recorded base commit. The launcher also checks that the working copy belongs to the exact canonical clone and has its own Git directory.

The worker uses `workspace-write`, with write access to the copy, its isolated Git directory and the common Git directory. Network access stays enabled for the existing engineering workflow. The canonical source directory is not added as a writable root. The Run Store and prompt directory are outside the model's writable roots.

The launcher reads the existing writer credential from `secrets/github.env`, which must have private permissions. The prompt file has mode 600 and is deleted after reading. The technical worker receives the writer's `GH_TOKEN`; unrelated secrets and reviewer GitHub App credentials are removed. Credentials, prompts and command payloads are not stored in protocol receipts. Structured AI review keeps its separate read-only app-server path and exact output schema.

## Simplicity and authorized scope

The initial task, CI repair and review fix share one short simplicity reminder. It directs Codex to the repository's `Simplicity and scope` guidance and the simplest clear authorized implementation. Speculative abstractions, defensive branches and recovery mechanisms are discouraged; required safety and verification remain intact.

Repository `AGENTS.md` governs work in that repository, including manual coding. Kurami's own instructions govern Kurami, not managed application repositories. The reminder does not grant new authority: human-control still stops before edits, and repair tasks retain their exact-SHA and evidence boundaries. Existing sessions are not rewritten by a prompt-source change.

## Starting and completing a task

A task claim records the run, task kind, context id and exact supervisor name. A unique active-task constraint prevents two protocol writers for one run. CI repair and review fix also retain their exact source SHA and original evidence snapshot.

The worker records the thread returned by `thread/start`, then records the turn returned by `turn/start`. These replies bind the task directly; protocol tasks do not search for the newest conversation in the working directory. The technical task's thread is also recorded in its repair attempt or review-fix round. The previous main thread stays in `previous_codex_thread_id` until the existing cleanup restores it.

Only `turn/completed` for that exact thread and turn can record terminal status. `completed`, `failed` and `interrupted` are distinct. The first terminal receipt wins; duplicate or conflicting replays do not change it. Events for another thread, an older turn or a released task have no authority.

After completion the worker closes app-server and waits for process exit before recording `stopped_at`. The controller parks only a completed turn with no failure code and an acknowledged stop. It then removes the exact supervisor mapping and records `parked_review`, owner `none`. Terminal text has no authority for protocol tasks. TUI sessions still use guarded completion observation, including `Worked for 50s • 09:50` followed by the idle prompt. Busy and approval prompts prevent completion.

A completed turn does not prove that code was committed, pushed, reviewed or accepted by CI. The existing Git and PR checks verify delivery, and CI verifies the exact resulting SHA. Review fixes with undelivered local changes remain preserved for attention. Technical cleanup and review-thread resolution keep their existing evidence checks.

## Restart, cancellation and limits

For a completion-validated TUI park, Kurami snapshots the exact managed pane's process tree before tmux exits. Surviving captured processes receive SIGTERM, with PID and process start-time checks before signalling. Ownership is released only after those processes stop. A private receipt binds cleanup retries to the same run, session, thread and host boot. This is not a working-directory or process-name kill: unrelated workers and Remote handoff retain their existing behavior. Historical orphans without captured ancestry are not automatically terminated.

Projects shows a safe startup-refusal note when the latest review-fix request failed for the displayed PR and commit. The note does not erase ready AI-review evidence or change action eligibility. A newer request or a different PR/head suppresses the old refusal; raw subprocess diagnostics, paths and credentials are never rendered.

Controller restarts read the persisted task and completion receipt. If a worker disappears before acknowledging process exit, the controller reads only that exact saved thread and turn from stored protocol history. It does not resume the thread or submit another turn. Even recovered completion does not establish process shutdown: ownership stays fenced in `needs_attention` until the uncertain process state is resolved.

A lost `turn/start` response is an ambiguous dispatch. Kurami records the uncertainty and stops the private process; it does not retry the request. This prevents a restart from silently creating a second turn.

For protocol tasks, Cancel run and runtime limits request interruption through `turn/interrupt`, then wait for the exact terminal event and process exit. A missing stop acknowledgement preserves writer ownership. The default time limits remain 240 minutes for the main writer and 90 minutes for technical workers. A structured usage or billing block has its own failure code; it is not reported as a runtime timeout.

Unexpected approval, permission, user-input or unknown server requests fail closed. Command and file approvals are declined, permission grants are empty, and unsupported requests receive an error. The task stops and needs attention; no permission expansion is accepted automatically.

## Ownership and Remote

The owner field keeps the same meanings: `cli` is Kurami's managed writer, `none` has no writer, and `remote` belongs to you in Codex Remote. Continue autonomously from a Remote-owned run still requires your explicit confirmation that the previous task is finished. It creates a fresh task and leaves the Remote thread as history.

Take control remains in the controls for both a live handoff and a later session claim. Primary autonomous writers, fresh successors and human-control sessions retain the existing TUI handoff and Remote flow. Legacy sessions keep their completion path and limits. For an app-server-created thread, both live handoff and a later Remote claim report `protocol_remote_handoff_unverified`. The installed daemon and remote-control commands do not establish a verified transfer from a private stdio worker to the paired mobile host. That integration must be verified before Kurami can record Remote ownership for such a thread.

::::example One completed technical turn, no new PR head yet
Run `r_example42` starts a CI repair task `ct_example42`, thread `thread_example42` and turn `turn_example42`. Its exact completion event reports `completed`; process exit is acknowledged. The next controller cycle parks the run. The PR still has its source SHA, so CI success is not claimed. The repair attempt waits for independent evidence.
::::

## A preserved legacy CI timeout

An incident-specific recovery command covers the old CI repair that completed with `Worked for 50s • 09:50` but later timed out. It requires the allowlisted run and original request, task identities, transcript hash, clean linked worktree, unchanged source/PR SHA, fresh failed CI and no live writer or conflicting control. Other attention reasons are refused.

The operator previews with the command below, then repeats it with `--apply` only after approval. Pause concurrent launch activity first. Recovery parks the run and preserves both threads and the original attempt; its billing blocker remains recorded as `legacy_ci_repair_completed_billing_block`. Automatic cleanup remains fenced, and recovery starts no writer or repair retry. Existing explicit cleanup remains a separate owner action before Remote takeover.

```sh
node src/orchestrator/projects/sessions/recover-legacy-ci-timeout.ts --run-id r_367ac0dcb458a2f56692
```

The command uses your configured `KURAMI_HOME`. The exact evidence and preconditions are in [the operator recovery procedure](repo:docs/codex-protocol-lifecycle.md).

## A completed CI repair without a new head

For the allowlisted completed protocol incident, an operator can return the run from `ci_repair_no_new_head` to owner-free `parked_review`. Preview with `recover-ci-no-new-head.ts --run-id r_367ac0dcb458a2f56692`; apply requires explicit `--apply` and owner authorization. Quiesce concurrent launchers first.

The command checks the released task, archived technical thread, restored predecessor, exhausted two-attempt budget, clean worktree, live GitHub PR and remote SHA, fresh failed CI, and current ready AI findings. It preserves attempts, failed CI, reviews and events, and appends recovery evidence. You can then use existing AI Review findings and **Fix review**. Recovery launches no writer or CI job. The billing block remains unresolved; other incidents require their own recovery decision.

See [the operator procedure](repo:docs/codex-protocol-lifecycle.md) for the exact command and guards.

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| Task fails or is interrupted | preserves the copy and records a distinct protocol failure | inspect the cause and decide whether to cancel |
| Permission request arrives | grants nothing, stops the worker, reports attention | inspect the requested operation |
| Billing or usage block | records `external_billing_block` | resolve the account limit before starting further work |
| Worker dies or start reply is lost | reads exact history; does not dispatch again | resolve the uncertain process boundary |
| Process stop is not acknowledged | preserves the writer fence | check the private worker before releasing resources |
| Take control targets a protocol thread | reports the explicit Remote integration blocker | keep the copy and use the documented recovery boundary |
| A legacy TUI session has no protocol identity | keeps guarded TUI completion, runtime and handoff | use the existing controls |
| Turn completes without a delivered PR or new CI result | waits for independent evidence | inspect the branch and PR |

:::guarantees
- One managed writer can own a run at a time.
- Kurami never resumes or sends input to a Remote-owned thread.
- Terminal text cannot complete a protocol task; legacy TUI completion remains available.
- Missing identities, permission requests and unacknowledged stops fail closed.
- Cancellation and failure preserve the branch, working copy and protocol identities.
:::

:::code-map
- `src/orchestrator/projects/sessions/session-start.ts` — writer and technical-task admission
- `src/orchestrator/projects/sessions/autonomous-successor.ts` — fresh successor after the explicit Remote boundary
- `bin/launch-codex-session.sh` — credential and worktree checks
- `src/orchestrator/integrations/codex/managed-worker.ts` — protocol execution, interruption and shutdown
- `src/orchestrator/integrations/codex/task-store.ts` — exact identities and deduplicated receipts
- `src/orchestrator/projects/sessions/protocol-session.ts` — release, recovery and Remote blocker
- `src/orchestrator/integrations/codex/app-server.ts` — JSON-RPC transport and structured AI review
- `src/orchestrator/runtime/controller.ts` — completion planning
:::
