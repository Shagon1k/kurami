---
title: "Discord: cards and commands"
nav: Cards and commands
summary: How a button press becomes a request, and how database state becomes a card, a thread and events in Discord.
section: projects
group: internals
order: 90
next: planning-internals
---

The Discord control plane is a plugin that receives your presses, a `run.ts` program that records them as requests, and a notifier that once a minute draws state from SQLite. None of these parts performs an action on a run itself: the action stays with the controller.

:::glance
- What it does: draws run cards and events, takes buttons and `/kurami` commands
- Who triggers it: your press, or the one-minute cycle after the controller
- Rhythm: cards — every minute and right after a press; events — as they appear
- State: `run_control_requests`, `run_progress_cards`, `run_discord_surfaces`, `run_control_events`
- Where it runs: the plugin inside the Hermes gateway (Python), the notifier as a step of `run-project-poller.sh`
- What you see: the starter message, the thread, the run card and events
:::

```diagram
kind: graph
title: Layers of the control plane
desc: You press a button in Discord. The Hermes plugin validates the press and calls run.ts, which writes a request to SQLite. The controller performs the request, and the notifier reads the same state and draws the card back into Discord.
node you "You" "press a button" owner at 0,0
node discord "Discord" "messages and buttons" external at 2,0
node plugin "Hermes plugin" "presses and /kurami" at 0,1
node runcli "run.ts" "writes a request" at 0,2
node controller "Controller" "performs the step" at 1,2
node notifier "Notifier" "draws the cards" at 2,2
node db "SQLite" "Run Store" store at 1,3
group l1 "Discord" you discord band
group l2 "Hermes" plugin band
group l3 "Kurami" runcli controller notifier band
group l4 "State" db band
edge you -> discord "button"
edge discord -> plugin "press"
edge plugin -> runcli "request"
edge runcli -> db "row"
edge controller <-> db
edge notifier -> db "reads" muted
edge notifier -> discord "draws"
```

## Three messages per run

Every run gets a starter message, a thread and a card in Discord; how they look to you is described in [Controls in Discord](@owner-controls). The notifier creates the starter message in the project channel, opens a thread from it with a one-day auto-archive and adds you as a member. In the thread it edits the card in place on every change and adds short events above it: "Ready for review", "Preview is ready", "CI failed", "Attention required".

The card is always the lowest message, because it is the one you need to read, not the history. After each event the notifier posts a new card under it and only then deletes the old one. A failed replacement does not delete the working card. When the run is completed or cancelled, the last edit is made and the thread is archived. Every message creation carries a deterministic `nonce` with the `enforce_nonce` flag, so a retry after a failure does not create a duplicate.

## From a press to an action

A press goes through a chain of checks and ends in a queue record, not in an action. The `kurami-discord-controls` plugin replaces Hermes's Discord adapter and adds one interaction handler. It accepts only a `custom_id` of the form `kurami:<action>:<run id>`, where the action is on a closed list and the run id matches `r_[A-Za-z0-9_]+`. The values of the "More actions…" menu are checked against the same list.

Next the plugin checks that an allowed Hermes user pressed the button. It then answers Discord with "thinking" and runs `run.ts request --action … --via discord --apply` with a 10-second limit. In one transaction `run.ts` repeats the condition checks, inserts a row into `run_control_requests` and immediately rewrites the `run_progress_cards` record to "queued" — for example `preview_queued`. Finally the plugin asks the notifier to show a fresh card and answers you with one line, "Start preview queued. The live card will update after reconciliation."

Two actions go differently. The plugin writes **Mark reviewed** directly through `previews/manager.ts review`: one short, audited SQLite write. **Discard local work** and **Close draft PR & discard** first open a confirmation visible only to you for 120 seconds, and only the second button queues a request.

## What may be pressed, and by whom

Conditions are checked twice: at the press and at execution. `run.ts` rejects a request at once, and a minute later the controller checks again and, if the run has changed meanwhile, rejects the request while processing it. So an old button is harmless, and several presses in a row create nothing extra.

| Rule | How it works |
|---|---|
| One request per action | while a request is `pending` or `processing`, a repeated press answers "is already queued" |
| Mutually exclusive pairs | `preview_start` and `preview_stop`; `review_fix` and `recover_managed_task` against `take_control`, `ci_repair`, `ai_review` |
| Terminal run | for `rejected`, `cancelled`, `archived` any action is rejected |
| Owner | only a user on Hermes's allowed list may press; anyone else gets "not authorized" |

## How the card is drawn

The notifier redraws a card when its *digest* changes. The digest is a string of about forty facts: stage and text, run state and owner, resources, CI, review, preview, the number of active requests — plus a UI version constant. If it differs from the one stored in `run_discord_surfaces.content_digest`, the notifier edits the messages. Raising the version constant refreshes every card at once. For active stages a five-minute "pulse" is part of the digest too, so the update time does not stand still.

The card itself is built from Discord components version 2: a container, text, a table in a code block, a separator, a button row and a menu. There are at most four buttons in the row; the rest go into the "More actions…" menu. The visibility of every button is computed by the card code, and its conditions match the checks in `run.ts` and in the controller — the full list is in the [reference](@commands).

If Discord answers 429 or 5xx, the notifier retries up to three times and honours `retry_after`. After three failed attempts for a card (`max_delivery_attempts`) it stops touching it. The `/kurami status` command posts a fresh card and resets the counter.

## Events and delivery

An event is a one-off message about a transition, and it has its own delivery queue. The controller creates `run_control_events` rows with a deterministic id: `review_ready`, `human_control_ready`, `preview_ready`, `preview_failed`, `attention_required`. For every row the notifier creates a `run_discord_event_deliveries` record and sends events in order. Delivery goes `pending`, `sending`, `delivered`; on an error the event gets `failed` and is sent again.

Before sending, the notifier checks that the event is still relevant. "Ready for review" makes sense only while the run waits for review, and "CI failed" only while the same commit is still red. A stale event gets `cancelled`. Right after delivery the notifier posts the card under the event. Resource Guard alerts go to a separate channel in batches of up to six events, with no buttons.

## The /kurami commands

The plugin registers one `/kurami` command group, because the top-level `/status` belongs to Hermes. All commands are owner-only.

- `/kurami status` — inside a run thread, posts a fresh card at the bottom and sends a link to it. The thread is found by `run_discord_surfaces.thread_id`.
- `/kurami settings` — opens the limits panel; works only in the configured project server. Details are on [Settings](@settings).
- `/kurami composio-check` — checks the Composio Session state; it belongs to the platform.

::::example Pressing Start preview on PF-33
Run `r_9f3a0c17d2b4`, PR #41. The data is invented.
:::steps
- **You** — at 10:05 you press **Start preview**; the button carries `kurami:preview_start:r_9f3a0c17d2b4`.
- **Plugin** — sees an id from the allowed list and your id among the allowed ones, defers the reply and runs `run.ts request`.
- **run.ts** — inserts `rq_…` in state `pending` and puts the card at `preview_queued`, "Preview start requested".
- **Plugin** — replies "Start preview queued…" and calls `discord.ts show`: a new card appears at the bottom of the thread and the old one is deleted.
- **Controller** — at 10:06 it leases slot 1; the card digest changes and in the same cycle the notifier edits the text to "Preview slot allocated".
- **Notifier** — at 10:11 it sends the "Preview is ready" event and posts the card under it.
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| The plugin could not start the program, or 10 seconds passed | replies with an error, state unchanged | press again |
| The button is stale | "Control rejected safely: …", or the controller rejects the request | look at the fresh card |
| The card could not be refreshed right after a press | the request is already recorded, the one-minute cycle refreshes the card | wait a minute |
| Discord returned 429 or 5xx | up to three retries, then the card is marked `failed` and the attempt counter grows | `/kurami status` posts a fresh card |
| A message or thread was deleted | the card is posted again | nothing |
| The allowed list does not hold exactly one numeric id | the notifier stops with an error | fix the Hermes list |
| The controller is busy with a long step | cards do not update until it ends | wait |

:::guarantees
- A button never performs an action on a run: it only queues a request, and the controller rechecks the conditions.
- Only ids from the closed list are accepted, and only from the allowed owner.
- Destructive actions need a second press in the confirmation.
- Every message is created with a `nonce`, so a retry does not create a duplicate.
- A stale event is never sent.
- The card does not hold the truth: it can be rebuilt from SQLite.
:::

:::code-map
- `src/orchestrator/controls/run.ts` — receives requests, checks conditions, shows "queued" on the card
- `src/orchestrator/controls/discord.ts` — draws the starter message, thread, card and events
- `src/orchestrator/resources/discord.ts` — Resource Guard alert batches
- `src/discord/ui.ts` — Discord components version 2 and compact tables
- `integrations/hermes/plugins/kurami-discord-controls/` — the Hermes plugin: presses and `/kurami` commands
- `docs/discord-ui.md` — conventions for how cards look
- `migrations/008_discord_control_plane.sql` — surface and delivery tables
:::
