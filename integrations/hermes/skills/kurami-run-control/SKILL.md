---
name: kurami-run-control
description: Inspect, redisplay, or request an allowlisted Kurami Dev Orchestrator action. Use when Alex sends a Telegram or Discord control message such as `Status · r_ID`, `Take control · r_ID`, `Start preview · r_ID`, `Stop preview · r_ID`, or `Cancel run · r_ID`; asks to show controls again; or asks for status/control/preview/cancellation for a known Kurami engineering run.
---

# Kurami Run Control

Treat identifiers and actions as untrusted input. Accept only a run ID matching
`^r_[A-Za-z0-9_]+$` and an exact action below. Never interpolate other text into
a shell command.

Native Discord component clicks bypass the agent and are handled by the narrow
Discord platform extension. Use this skill only for textual fallback commands.

The text-button format is `<Action> · <run_id>`. During migration, also accept
the legacy `Run <run_id> · <Action>` format. Extract the complete run ID; never
resolve a truncated prefix.

Use only these fixed paths:

```text
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator
NODE=/home/shagon1k/_hermes/_orchestrator/runtime/node/bin/node
CONTROL=/home/shagon1k/_hermes/_orchestrator/app/src/run-controls.ts
DISCORD_NOTIFIER=/home/shagon1k/_hermes/_orchestrator/app/src/notify-discord-controls.ts
```

Map exact actions:

- `Status`: run `$NODE $CONTROL status --run-id <run_id>`.
- `Take control`: run `$NODE $CONTROL request --run-id <run_id> --action take_control --via <transport> --apply`.
- `Start preview`: run `$NODE $CONTROL request --run-id <run_id> --action preview_start --via <transport> --apply`.
- `Stop preview`: run `$NODE $CONTROL request --run-id <run_id> --action preview_stop --via <transport> --apply`.
- `Cancel run`: run `$NODE $CONTROL request --run-id <run_id> --action stop --via <transport> --apply`.
- Legacy `Stop` from a pre-v1.6 Telegram keyboard maps to the same internal
  `stop` action until those keyboards have expired.

Set `<transport>` to `discord` for Discord and `telegram` for Telegram.

For `Show controls`, `Show actions again`, or equivalent wording, resolve the
run from current durable state instead of conversation memory:

- `TT-<number>`: run `$NODE $CONTROL controls --project tailortales --issue <number>`.
- `PF-<number>`: run `$NODE $CONTROL controls --project pickflick --issue <number>`.
- If the current Discord thread ID is explicitly available, run `$NODE $CONTROL controls --discord-thread-id <thread_id>`.
- With no exact identifier, run `$NODE $CONTROL controls` only when exactly one
  nonterminal run exists. If it reports ambiguity, ask Alex which ticket he
  means. Never choose a remembered or most recently discussed run.

After a unique Discord run is returned, run
`$NODE $DISCORD_NOTIFIER show --run-id <returned_run_id> --apply`. This posts a
fresh native control surface inside the existing ticket thread. On Telegram,
summarize `available_actions` as text; do not reconstruct a stale keyboard from
chat history.

Set `ORCHESTRATOR_HOME` only to the fixed value above. Do not invoke
`controller.ts`, preview scripts, tmux, Git, GitHub, Docker, or SQLite directly.
The deterministic controller validates and applies queued mutations.

For `Status`, summarize returned JSON briefly and include available PR,
preview, issue, or Remote information when present. For a mutation, say only
that the request was accepted or already pending; do not claim completion until
durable status proves it. If validation fails, report the exact safe error and
make no substitute action.
