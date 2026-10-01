---
title: Publication and recovery
nav: Publication and recovery
summary: How an accepted draft becomes a page, when Kurami marks channels read and what happens when the morning goes off plan.
section: digest
group: internals
order: 20
next: news-selection
---

Publication is the tail of the attempt: six states from `prepared` to `notified`, passed by one tool, `finish_daily_briefing`. If the tail breaks, the same attempt resumes from the last state it reached and collects nothing again. An edition counts as done only when it is published *and* a receipt for the Discord notification is saved. The card and its buttons are described in [The morning edition](@daily).

:::glance
- What it does: takes an accepted edition to a page, marks the Telegram channels read and announces the edition in Discord
- Started by: the agent calling `finish_daily_briefing`; a systemd guard backs it up
- Where it runs: inside the Telegram MCP process, under a lock, with a 900-second budget
- State: the attempt in `briefing_run_attempts` and stage receipts: the capture check and the notification
- Result for you: an edition `complete` or `partial` and the card "Выпуск опубликован" (edition published)
:::

```diagram
kind: graph
title: Attempt states
desc: Eleven states go strictly in order from created to notified. From any state the attempt can move to failed, and the recovery window returns it to the last completed state.
node created "created" "attempt opened" start at 0,0
node live "live-collected" "live data" state at 1,0
node captured "telegram-captured" "batch frozen" state at 2,0
node validated "capture-validated" "capture complete" state at 3,0
node editorialized "editorialized" "draft accepted" state at 3,1
node prepared "prepared" "page ready" state at 2,1
node media "media-ready" "images in place" state at 1,1
node planned "commit-planned" "plan confirmed" state at 0,1
node committed "telegram-committed" "channels read" state at 0,2
node published "published" "edition visible" state at 1,2
node notified "notified" "Discord receipt" end at 2,2
node failed "failed" "stopped" fail at 3,2
edge created -> live
edge live -> captured
edge captured -> validated
edge validated -> editorialized
edge editorialized -> prepared
edge prepared -> media
edge media -> planned
edge planned -> committed
edge committed -> published
edge published -> notified
edge editorialized <-> failed "failure / recovery" accent
```

## The tail of the attempt

The tail has eight steps, and code performs them, not the agent. The agent passes the tool only the edition id and the attempt id: it cannot supply paths, tools or boundaries. The tool runs inside the Telegram MCP process because the only Telegram session lives there, and a second client must not be created.

1. **Page.** Kurami draws the HTML and stores the edition in state `prepared`. The page is validated: no scripts or forms, a theme switch, every story present.
2. **Images.** The tool downloads images in batches of at most 12, up to three passes, and remembers the successful downloads after each batch. If an image fails to download, publication does not go ahead: an edition missing some images does not go out.
3. **Live data.** If mail, calendar or weather is older than 15 minutes, Kurami reads it again and recomputes Signals. The teasers of add-ons are attached here too: Weekly (on Sunday) and Stocks, when they are on.
4. **Validation and plan.** Kurami binds the capture check to the exact content of the edition and builds the plan: for each channel with posts, its id and upper boundary.
5. **Marking read.** The tool executes exactly that plan.
6. **Publication.** One transaction marks the edition `complete` or `partial` and makes it current.
7. **Notification.** Kurami edits the card and saves the receipt.
8. **Check.** Kurami confirms the attempt is `notified`, the edition is published and the receipt exists.

The check in step 4 is bound to content because any change to the edition — an image import, a data refresh — erases the saved capture-check receipt. An old plan cannot be used for new content: the tail validates and plans again.

## Marking read

Marking read is the only thing Kurami changes in Telegram, and it happens only after the page and images are ready. For each channel the tool closes the batch up to the upper-boundary id and no further. Posts that arrived after the capture stay unread. The tool checks the request against the saved plan and refuses a foreign or stale one.

The result per channel is `committed` or `failed`. If at least one channel could not be marked, the edition is published as `partial`: its posts stay unread in Telegram and reappear tomorrow. Results are saved, so after a failure between marking and publication the tail repeats the same call instead of building a new one.

## Windows and the guard

The morning has two windows of one job: the primary window at 09:00 local time and the recovery window at 10:00. The Hermes job fires at 06:00, 07:00 and 08:00 UTC, so it hits 09:00 and 10:00 in both summer and winter time. The agent does not check the clock: the only judge is the `start-attempt` command.

| Local hour | No attempt yet | Attempt unfinished | Attempt finished |
|---|---|---|---|
| 09 | Creates the attempt, runs | Does not run: "attempt already exists" | Does not run |
| 10 | Creates an attempt marked as recovery, runs | If recovery has not started yet, reopens it at the last completed state and runs | Does not run |
| any other | Does not run: `outside_local_09_window` | Does not run | Does not run |

The guard is a separate systemd check that does not run a model. While the agent works it checks progress every 5 minutes from 09:05 to 09:45 and from 10:05 to 10:40, but acts only if the job has already returned. The real deadlines are 09:50 and 10:50.

| Situation | What the guard does |
|---|---|
| Edition published, no notification | Sends the notification itself and records `notified` |
| Attempt unfinished before 10:45 | If the agent has returned, records `failed: agent_returned_incomplete`; the card is red, the attempt can be resumed |
| 09:50 with no finished attempt | The card shows `primary_window_incomplete`, the attempt stays alive |
| From 10:45 (deadline 10:50) the attempt is unfinished | Records the final `failed: recovery_window_incomplete` |
| No attempt at all | Creates one itself so the card and the record have something to show |

```diagram
kind: timeline
title: The morning in local time (summer example)
desc: The Hermes job fires at 09:00 and 10:00. The guard checks every five minutes and has deadlines at 09:50 and 10:50. The poller refreshes live blocks every hour at :37.
lane cron "Hermes job"
lane guard "Guard"
lane poller "Poller"
at cron 09:00 "primary window" accent
at cron 10:00 "recovery window" accent
span guard 09:05-09:45 "checks every 5 min"
at guard 09:50 "deadline 1" accent
span guard 10:05-10:40 "checks"
at guard 10:50 "deadline 2" accent
every poller 60m "live blocks" from 08:37
range 08:30-12:00
```

## Recovery

Recovery returns the attempt to the last state that has a completed receipt and continues from there. At 10:00 the `start-attempt` command finds the unfinished attempt and reopens it: it clears the error and sets `recovery_started_at`. The frozen batch, the attempt files and the accepted draft stay as they were. The Discord card stays the same one and turns from red into "Выпуск восстановлен автоматически" (edition recovered automatically).

The operator has two manual commands. `resume-completion` returns a failed attempt to one of the states from `editorialized` to `published`; errors before the draft was accepted are not fixed this way. `revise-published` corrects the texts of an already published edition but does not allow changing batch boundaries, exclusions or the set of stories.

::::example The tail of the attempt for 2026-10-01
:::steps
- **Agent** — at 09:13 calls `finish_daily_briefing`. The tool takes the lock and draws the edition page — state `prepared`.
- **Tool** — downloads 58 images in five batches: 12, 12, 12, 12 and 10. State `media-ready`.
- **Tool** — live data from 09:00:20 is older than 15 minutes, so it reads it again.
- **Tool** — builds the plan for 11 channels, for example `space-news` with boundary 48211, and marks all 11 read.
- **Runtime** — publishes the edition: it becomes `complete` and current on the home page. Then the runtime edits the card, and the attempt gets `notified`.
- **Agent** — the final check passes and it answers `[SILENT]`. At 09:50 the guard sees `notified` and does nothing.
:::
::::

::::example A morning with a rejected draft
:::steps
- **Runtime** — at 09:05 `rank-preview` rejects the draft: a headline copies its source. The agent returns without publishing.
- **Guard** — at 09:10 sees the job has ended while the attempt is at `capture-validated`, and records `agent_returned_incomplete`. The card is red.
- **Runtime** — at 10:00 `start-attempt` reopens the attempt at state `capture-validated`.
- **Agent** — uses the same frozen batch, fixes the draft and calls `finish_daily_briefing`. The card: "Выпуск восстановлен автоматически".
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| An image failed after three passes | `failed: completion_media_incomplete`, downloaded files are kept; the retry reuses them | Nothing, or `resume-completion` |
| The tail ran out of its 900 seconds | Records the stage and `failed: completion_<stage>_failed` if the edition is not yet published | `resume-completion`, then the same call |
| A second `finish_daily_briefing` call | Answers `completion_already_running` | Nothing |
| Some channels could not be marked read | Publishes `partial`; those posts are unread again tomorrow | Nothing |
| A failure between marking and publication | Repeats the same marking from the saved plan, then publishes | Nothing |
| Edition published, Discord unavailable | The attempt stays `published`; the guard retries the notification | Nothing |
| The recovery window has passed | `failed: recovery_window_incomplete`, the home page keeps the previous edition | You decide about manual recovery |

:::guarantees
- Channels are marked read only after validation and only by the saved plan, never past the capture boundary.
- An edition is visible at `/daily/<date>` only after `finalize`: there is no half-published page.
- Success is a published edition plus a notification receipt, not a tool answer and not a cron status.
- Discord gets one card per date: recovery edits it and does not create a second one.
- The guard runs no model and does not interrupt a running job before the 09:50 and 10:50 deadlines.
- A manual fix of a published edition does not change the set of stories and does not touch Telegram or Gmail.
:::

:::code-map
- `src/briefing/run-attempt.ts` — states, `start-attempt`, the reopening at 10:00
- `integrations/hermes/connectors/briefing_completion.py` — the tail step by step: `render-preview`, `refresh-before-publish`, `telegram-commit-plan`, `finalize`, `notify-release`; progress files `completion-*.json`
- `integrations/hermes/connectors/telegram_stdio_wrapper.py` — `finish_daily_briefing`, `mark_read_through_batch`, the `completion.lock` lock
- `src/briefing/telegram-commit-store.ts` — capture validation and the marking plan (`planDigest`)
- `src/briefing/finalization-store.ts` — publication in one transaction
- `src/briefing/release-notifier.ts` — the Discord card and the receipt
- `src/briefing/run-guard.ts` — the guard and its deadlines
- `src/briefing/completion.ts` — `assert-complete`, `resume-completion`
:::
