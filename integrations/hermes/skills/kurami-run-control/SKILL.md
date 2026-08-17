---
name: kurami-run-control
description: Inspect, redisplay, or request an allowlisted Kurami Dev Orchestrator action. Use when Alex sends a textual Discord or Telegram fallback command for a Kurami engineering run, including Status, Take control, Continue in Codex, Start preview, Stop preview, Cancel run, Discard local work, Close draft PR and discard, Open in Codex, or Show controls/actions again.
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
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator
NODE=/home/shagon1k/_hermes/_orchestrator/runtime/node/bin/node
CONTROL=/home/shagon1k/_hermes/_orchestrator/app/src/run-controls.ts
DISCORD_NOTIFIER=/home/shagon1k/_hermes/_orchestrator/app/src/notify-discord-controls.ts
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

Set `ORCHESTRATOR_HOME` only to the fixed value above for every command.

## Inspect or mutate

Accept the current text-button form `<Action> · <run_id>` and the legacy form
`Run <run_id> · <Action>`.

Map exact actions and aliases as follows:

- `Status`: run `$NODE $CONTROL status --run-id <run_id>`.
- `Take control` or `Continue in Codex`: run `$NODE $CONTROL request --run-id <run_id> --action take_control --via <transport> --apply`.
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
handoff, preview startup, preview shutdown, or cancellation completed until a
later durable status proves it.

A Take control request may remain pending while the active Codex turn reaches a
safe handoff boundary. Report this as expected waiting, not failure. Completion
requires `state=remote_owned`, `owner_state=remote`, and a valid
`codex_thread_id`; only then provide the Codex launcher URL.

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
