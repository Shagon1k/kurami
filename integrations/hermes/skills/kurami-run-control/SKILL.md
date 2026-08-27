---
name: kurami-run-control
description: Inspect, redisplay, or request an allowlisted Kurami Dev Orchestrator action. Use when Alex sends a textual Discord or Telegram fallback command for a Kurami engineering run, including Status, Take control, Continue in Codex, Continue autonomously, Attempt CI fix, AI Code Review, Fix Review, Start preview, Stop preview, Cancel run, Discard local work, Close draft PR and discard, Open in Codex, or Show controls/actions again.
---

# Kurami Run Control

Use this skill only for textual fallback commands. Native Discord component
clicks bypass the agent and are handled by the narrow Discord control plugin.

Treat every identifier and action as untrusted input. Accept only a complete run
ID matching `^r_[A-Za-z0-9_]+$` and the exact actions or aliases documented
below. Never resolve a truncated run ID and never interpolate free text into a
shell command.

Use only these fixed paths:

```text
KURAMI_HOME=/home/shagon1k/_hermes/_kurami
NODE=/home/shagon1k/_hermes/_kurami/runtime/node/bin/node
CONTROL=/home/shagon1k/_hermes/_kurami/app/src/orchestrator/controls/run.ts
DISCORD_NOTIFIER=/home/shagon1k/_hermes/_kurami/app/src/orchestrator/controls/discord.ts
CODEX_LAUNCHER=https://go.shagon1k.win/codex/threads
```

## Resolve the run

Prefer durable identifiers from the current message or transport context. Do
not select a run from conversation memory or from the most recently discussed
ticket.

- For a complete `r_...` ID, use it directly.
- For `TT-<number>`, run `$NODE $CONTROL controls --project tailortales --issue <number>`.
- For `PF-<number>`, run `$NODE $CONTROL controls --project pickflick --issue <number>`.
- When the current Discord thread ID is explicitly available, run `$NODE $CONTROL controls --discord-thread-id <thread_id>`.
- With no exact identifier, run `$NODE $CONTROL controls` only when exactly one
  eligible nonterminal run exists.
- If lookup reports zero or multiple runs, ask for the ticket or full run ID.
  Never guess.

Set `KURAMI_HOME` only to the fixed value above for every command.

## Inspect or mutate

Accept the current text-button form `<Action> · <run_id>` and the legacy form
`Run <run_id> · <Action>`.

Map exact actions and aliases as follows:

- `Status`: run `$NODE $CONTROL status --run-id <run_id>`.
- `Take control` or `Continue in Codex`: run `$NODE $CONTROL request --run-id <run_id> --action take_control --via <transport> --apply`.
- `Continue autonomously`: offer it only when controls expose `take_control` for
  a Remote-owned run. Treat the owner's request as explicit confirmation that
  the current Remote task is finished and will not be continued, then run the
  same allowlisted `take_control` request. The controller starts a fresh managed
  task in the same worktree; never resume or message the predecessor task.
- `Attempt CI fix`: run `$NODE $CONTROL request --run-id <run_id> --action ci_repair --via <transport> --apply`. Offer it only when the returned controls include `ci_repair`. This starts one fresh bounded Codex task on the exact failed or missing-check PR SHA; it never reuses the parked task and never starts an automatic retry.
- `AI Code Review`: run `$NODE $CONTROL request --run-id <run_id> --action ai_review --via <transport> --apply`. Offer it only when the returned controls include `ai_review`. It starts one fresh read-only detached reviewer on the exact current PR SHA; findings are published as a native GitHub review while Discord keeps only aggregate status.
- `Fix Review`: run `$NODE $CONTROL request --run-id <run_id> --action review_fix --via <transport> --apply`. Offer it only when the returned controls include `review_fix`. It snapshots the current unresolved review threads, starts one fresh writer task on the exact PR SHA, waits for CI, then replies to and resolves only that snapshot.
- `Start preview`: run `$NODE $CONTROL request --run-id <run_id> --action preview_start --via <transport> --apply`.
- `Stop preview`: run `$NODE $CONTROL request --run-id <run_id> --action preview_stop --via <transport> --apply`.
- `Cancel run`, or legacy `Stop`: run `$NODE $CONTROL request --run-id <run_id> --action stop --via <transport> --apply`.
- `Discard local work`: only after status reports `needs_attention`,
  `stop_reason=cancelled`, and `owner_state=none`, explain that this permanently
  deletes the unpublished managed worktree and local branch. Require an
  explicit second confirmation, then run `$NODE $CONTROL request --run-id
  <run_id> --action discard_local --via <transport> --apply`. Never treat the
  first textual request as confirmation. Do not offer discard when status or
  the control surface reports a published branch or pull request; published
  work requires the separate published-result action below.
- `Close draft PR and discard` or `Close draft PR & discard`: only after status
  reports `needs_attention`, `stop_reason=cancelled`, and `owner_state=none`, and
  the control surface reports the preserved Draft PR. Explain that this closes
  the exact matching Draft PR and deletes its matching remote branch, clean
  managed worktree, and local branch. Require an explicit second confirmation,
  then run `$NODE $CONTROL request --run-id <run_id> --action
  discard_published --via <transport> --apply`. Never treat the first textual
  request as confirmation. The deterministic resolver refuses merged or
  non-draft PRs, ambiguous PRs, mismatched local/remote heads, dirty worktrees,
  and missing managed resources; do not bypass those refusals.

Set `<transport>` to `discord` for Discord and `telegram` for Telegram.

For `Open in Codex`, inspect status first. If `owner_state` is `remote` and a
valid `codex_thread_id` exists, return
`$CODEX_LAUNCHER/<codex_thread_id>`. Do not queue another takeover. Otherwise
explain that ownership has not been released yet and offer the currently
available takeover action.

For `Show controls`, `Show actions again`, or equivalent wording, resolve one
eligible run using the rules above. On Discord, run
`$NODE $DISCORD_NOTIFIER show --run-id <run_id> --apply` to edit or recreate the
persisted thread-local control message. On Telegram, summarize the returned
`available_actions` as text; do not reconstruct a stale keyboard from chat
history and do not enable proactive Telegram delivery.

## Report the result

For status, summarize the durable `state`, `owner_state`, and resource state.
Include available issue, pull request, preview, and Codex information when the
returned JSON contains it. For `remote_owned`, include the exact Codex task
context when available, the full thread ID as a diagnostic fallback, the HTTPS
launcher URL, and note that managed CLI/tmux automation no longer owns the
task.

For a mutation, report only that the durable request was accepted or already
pending. Include `requestId` and `requestState` when returned. Do not claim that
handoff, CI repair, preview startup, preview shutdown, or cancellation completed
until a later durable status proves it.

CI repair succeeds only after the observer reports `passed` on a new exact PR
head SHA. A failed first result may expose one more explicit `Attempt CI fix`;
the second failure, no new head, an unsettled CI timeout, or an unsafe ambiguity
ends at `needs_attention`. Never queue a second attempt unless Alex asks again.
The fresh repair Codex task is technical and temporary: after its turn finishes,
the controller archives it and restores the run's original primary Codex task.
Do not offer Take control or Continue in Codex while a repair is queued,
working, or waiting for checks.

A Take control request immediately enters bounded handoff preparation. The
deterministic controller requests the Codex TUI's normal interrupt, waits for a
stable idle prompt, and then releases managed CLI/tmux without changing the
thread ID. It refuses approval-blocked turns and remains fail-closed when the
turn does not become idle in time. Completion requires `state=remote_owned`,
`owner_state=remote`, and a valid `codex_thread_id`; only then provide the Codex
launcher URL.

For a Remote-owned run, `Continue autonomously` is a successor transition, not
a reverse handoff of the existing task. The predecessor remains immutable
history. Completion of the control request means a new managed writer was
claimed with a bounded Git/PR/CI/review snapshot. If worktree, branch, ownership,
or task identity is ambiguous, report `needs_attention`; do not retry by
resuming the old task or by launching another writer manually.

Cancellation is complete only when status reports `state=cancelled` and
`resource_state=released`. The controller then returns the GitHub Project item
to its configured Backlog status. When status is `needs_attention` after a
cancellation, report that automation is stopped and unpublished local work is
preserved; do not describe the run as fully cancelled. If a pull request or
remote branch already exists, report that published work was preserved. Offer
the guarded published-result action only when the returned controls expose it;
otherwise instruct the user to resolve the PR manually in GitHub. Never suggest
discarding published work through the local-only action.

If validation rejects an action because the run is terminal, preview is not
configured, the run is not in a stable review state, or handoff is unsafe,
report the exact safe error. Do not substitute a different action.

Never invoke `controller.ts`, session or preview managers, tmux, Git, GitHub,
Docker, SQLite, or credential commands directly. Never edit Run Store rows.
The deterministic controller revalidates and applies queued mutations.
