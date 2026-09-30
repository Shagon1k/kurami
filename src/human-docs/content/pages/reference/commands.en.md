---
title: Commands and buttons
summary: All `/kurami` commands, the buttons of the run card and the Digest card, request names and text commands — with when they show and what they do.
section: reference
group: reference
order: 60
---

Button and stage names are given as they appear in Discord: they are English in the code. How it works is on [Controls in Discord](@owner-controls), [Human control](@human-control), [Previews](@previews), [Projects Digest](@project-digest) and [Discord: cards and commands](@discord-control-plane).

## /kurami commands

All commands are owner-only. The top-level `/status` belongs to Hermes, so Kurami uses the `/kurami` group.

| Command | Where it works | What it does |
|---|---|---|
| `/kurami status` | inside a run thread | Posts a fresh run card at the bottom of the thread, deletes the previous one, replies with a link. Refuses outside a thread |
| `/kurami settings` | the project server | Opens the limits panel: System Health, Capacity & WIP, AI triage, Previews. Apply, Undo last and Reset defaults work only when no runs are active |
| `/kurami composio-check` | any channel | Checks the Composio Session state across three contours: Broad, Read-only, Automation |

## Run card buttons

A button carries the id `kurami:<action>:<run id>`. The card shows at most four buttons in the order of the table; the rest live in the **More actions…** menu (`kurami:run_actions:<run id>`). A press queues a request of the given kind, and the controller performs it on the nearest cycle.

| Button | When shown | Request | What the controller does |
|---|---|---|---|
| **Recover delivered fix** | run in `needs_attention`, owner `cli`, reason `review_fix_uncommitted_changes` | `recover_managed_task` | rechecks the preserved task, the pushed commit and fresh CI, finishes the fix |
| **Take control** | owner `cli`, a managed session is running, run not in `needs_attention` | `take_control` | `handoff`: asks Codex to stop, waits for a quiet pause, releases tmux; the run becomes `remote_owned` |
| **Continue in Codex** | owner `none`, state `parked_review` or `waiting_human` | `take_control` | `claim_remote`: the owner becomes `remote`, the card shows an Open in Codex link |
| **Continue autonomously** | run `remote_owned`, owner `remote` | `take_control` | `successor_start`: a fresh managed Codex task in the same working copy |
| **Start preview** | the project has previews, no lease, run in review or yours | `preview_start` | leases a slot, then builds the preview |
| **Remove preview** | a lease in any state except released | `preview_stop` | removes the route, stops the stack, frees the slot |
| **Extend 24h** | the preview runs, less than two hours left | `preview_start` | `preview_extend`: expiry plus 24 hours |
| **Mark reviewed** | the preview runs and is not marked | direct call, no queue | writes the review mark on the lease |
| **Attempt CI fix** | `parked_review`, CI `failed` or `missing`, fewer than two attempts | `ci_repair` | `repair_start`: a fresh Codex task on the exact failing commit |
| **AI Code Review** | `parked_review`, PR and commit known, this commit not reviewed yet | `ai_review` | `review_start`: an independent read-only reviewer, the review is posted on GitHub |
| **Fix Review** | the current AI review has findings | `review_fix` | `review_fix_start`: a fresh Codex task fixes the findings and resolves their threads |
| **Cancel run** | cancellation has not started | `stop` | `request_stop`: stop, release resources, the issue goes to Backlog |
| **Discard local work** | stage "Cancelled — local work preserved", no PR | confirmation, then `discard_local` | `discard_cancelled`: deletes the unpublished working copy and branch |
| **Close draft PR & discard** | the same stage, a draft PR exists | confirmation, then `discard_published` | `discard_published_cancelled`: closes the exact draft PR and deletes the branches |

Confirmation buttons are visible only to you and live for two minutes: **Discard preserved local work** (`kurami:discard_local:…`) and **Close draft PR & discard** (`kurami:discard_published:…`).

## Replies to presses

| Reply | Meaning |
|---|---|
| "<Action> queued. The live card will update after reconciliation." | the request is recorded |
| "<Action> is already queued (`pending`)." | such a request is already waiting |
| "Control rejected safely: …" | the condition is not met, nothing changed |
| "This Kurami control is not authorized for your account." | the presser is not on the allowed list |
| "Autonomous continuation queued…" | Continue autonomously is confirmed |
| "Preview reviewed. TTL and lifecycle are unchanged." | the review mark is recorded |

## Request kinds

A request row lives in `run_control_requests`. States: `pending`, `processing`, `applied`, `rejected`, `failed`. One active request per action.

| Request | Buttons that queue it | Conflicts with |
|---|---|---|
| `take_control` | Take control, Continue in Codex, Continue autonomously | `review_fix`, `recover_managed_task` |
| `preview_start` | Start preview, Extend 24h | `preview_stop` |
| `preview_stop` | Remove preview | `preview_start` |
| `stop` | Cancel run | — |
| `discard_local`, `discard_published` | the confirmation buttons | — |
| `ci_repair` | Attempt CI fix | `review_fix`, `recover_managed_task` |
| `ai_review` | AI Code Review | `review_fix`, `recover_managed_task` |
| `review_fix` | Fix Review | `take_control`, `ci_repair`, `ai_review` |
| `recover_managed_task` | Recover delivered fix | `take_control`, `ci_repair`, `ai_review` |

## Digest card buttons

| Button | When shown | Effect |
|---|---|---|
| **Accept batch** | batch `ready` or `discussing` | accepts the remaining proposals, batch `accepted`, write queued; nothing is written to GitHub |
| **Review proposals** | batch `ready` or `discussing` | opens a list for you |
| **Discuss batch** | batch `ready` or `discussing` | creates one discussion thread, batch `discussing` |
| **Skip batch** | batch `ready` or `discussing` | skips the batch, the thread is archived |
| **Review approved batch** | batch `accepted` | shows the accepted proposals |
| **Review sync result** | batch `applied`, `partially_applied` or `failed` | shows the write result |
| **Retry sync** | batch `accepted`, two write attempts failed | queues the write again |

The **Review proposals** list offers: an exclusion menu ("Exclude selected proposals from this batch"), a restore menu ("Restore excluded proposals"), **Accept remaining**, and **Previous**/**Next** for pages of 12 proposals. Excluding every proposal is refused — Skip batch exists for that.

## Thread events

| Event | When it appears |
|---|---|
| Ready for review | the run waits for review, the session is free |
| Preparation is ready for you | an issue with the `human-control` label is prepared and handed to you |
| Preview is ready | the preview passed its health checks |
| Preview failed | the preview build or check failed |
| CI failed, Required CI check is missing | the commit's CI is red or a required check is missing |
| Codex approval blocked | Codex asked for a permission Kurami does not grant |

## Text commands

The Hermes agent understands the same actions in words: Status, Take control, Continue in Codex, Continue autonomously, Attempt CI fix, AI Code Review, Fix Review, Recover delivered fix, Start preview, Stop preview, Cancel run, Discard local work, Close draft PR and discard, Open in Codex, Show controls. Name the run by its full run id, by a key such as `TT-42` or `PF-33`, or write in the run thread. The agent deletes preserved work only after an explicit second confirmation.
