---
name: kurami-status
description: Answer Alex's questions about the current state of Kurami from fresh read-only data. Use when he asks in Discord or Telegram what is blocked or waiting for him, what is in progress or in review, how much Codex limit is left and whether it lasts until the reset, how the server is doing, or what is in today's calendar ("что заблокировано?", "сколько лимита?", "что сегодня в календаре?", "как сервер?"). Never use it to change anything.
---

# Kurami Status

Answer from fresh data, not from memory: run the fixed read-only command, then
reply in Alex's language, briefly and in plain words. The command writes nothing
and starts nothing.

```text
KURAMI_HOME=/home/shagon1k/_hermes/_kurami
NODE=/home/shagon1k/_hermes/_kurami/runtime/node/bin/node
STATUS=/home/shagon1k/_hermes/_kurami/app/src/system/ask/kurami-status.ts
```

Run `$NODE $STATUS <topic>` with `KURAMI_HOME` set to the value above and exactly
one topic from this list, chosen from the question:

| Question about | Topic |
|---|---|
| what is blocked, waiting for him, failing, in progress or in review | `tasks` |
| Codex limit, how much is left, whether it lasts until the reset | `limits` |
| the server: CPU, memory, disk, problems | `health` |
| today's meetings and events | `calendar` |
| "how are things", or more than one of the above | `overview` |

Never pass anything else on the command line, and never build a command from
the message text.

## Reading the answer

- `tasks.waitingForOwner` are tasks that wait for Alex's reply; `tasks.failing`
  have a failed run, CI or review that nobody is fixing. Name each by its task
  (`PickFlick #35`) and include the pull request link when there is one.
- `limits.windows[].runsOutBeforeResetAt` is set only when, at the current pace,
  the limit runs out before `resetsAt`; say when. Otherwise say it lasts until
  the reset. `windowMinutes` 300 is the 5-hour window, 10080 the weekly one.
- `health.issues` empty and `ok: true` means the server is fine. Mention CPU,
  memory or disk only when asked or when an issue names them.
- `calendar` comes from today's Daily edition; times are UTC, convert them to
  Europe/Vilnius. When `state` is `stale`, say the calendar was last refreshed
  at `fetchedAt`.
- `available: false` means that source could not be read now. Say so instead of
  guessing.

## Limits

Read only. If Alex asks to act on what he hears (start a fix, run a review, stop
something), hand over to `kurami-run-control`. Do not quote mail, tokens, paths
or other private data beyond what the answer needs.
