---
title: Controls in Discord
nav: Discord
summary: The run card shows only the buttons that make sense right now. A press queues a request, and the controller performs the action.
section: projects
group: guide
order: 40
next: human-control
---

For every run, Kurami keeps three kinds of messages in Discord. The project channel gets a short **starter message**, "PF-33 · issue title". Under it Kurami opens a **thread** named `[PF-33] title`. The thread holds one **run card** — the lowest bot message — and, above it, short **events**: "Ready for review", "Preview is ready", "CI failed".

The card is edited in place. After every event Kurami posts it again below the event and deletes the old one, so history reads top to bottom and the current state is always at the bottom.

::shot{file="shot-run-ready-review.png" size="card" alt="Run card PF-33 at Ready for review: CI failed, preview required, buttons Continue in Codex, Start preview, Attempt CI fix, AI Code Review and a More actions menu." caption="Up to four buttons in a row, the rest under More actions. Links to the issue and PR sit on their own line, not on buttons."}

## What the card shows

Read the card from the top. First comes the stage (**Ready for review**) and a one-line explanation. The **Control** line appears only when it matters who holds the task: `AI Agent` means managed Codex is working, `You` means the task was handed to you. Below is a compact table of CI, AI review, Preview and Policy, then details for each check and a line of links: issue, PR, preview, Codex. The footer has a short run id and the update time in local time.

The stage decides which buttons make sense. Stage and button names are given as they appear in Discord.

| Stage | What is happening | What you usually do |
|---|---|---|
| Preparing worktree, Starting Codex | Kurami prepares the working copy (worktree) and starts Codex | wait |
| Codex working | Codex is writing code | wait, or press Take control |
| Ready for review | Codex finished, the PR is open, the session is free | read the PR, optionally start checks |
| Fixing CI, Review fix queued, Fixing review | Kurami started a separate Codex task to fix something | wait |
| Preview queued, Preview ready | the preview is building or open | look at it, press Mark reviewed |
| Preview required | Done was requested but the required preview is missing | start and confirm the preview |
| Human control | the task is yours, automation released it | work in Codex, then Continue autonomously |
| Needs attention | automation stopped and waits for you | read the text on the card |
| Cancelled — local work preserved | the run was cancelled, local work kept | decide: keep or delete |
| Completed | the run is done, resources released | nothing |

## Buttons

A button appears only when its action is valid in the current state. The card shows at most four buttons in the order below; the rest live under **More actions…**. The three ownership buttons, Take control, Continue in Codex and Continue autonomously, are covered in [Human control](@human-control). The three ownership buttons, Take control, Continue in Codex and Continue autonomously, are covered in [Human control](@human-control). The full table with ids and request names is in the [commands reference](@commands).

| Button | When it appears | What it triggers |
|---|---|---|
| **Take control** | Codex is running in a managed session | Kurami interrupts Codex's current turn, waits for a pause and hands the thread to you |
| **Continue in Codex** | Codex finished and nobody owns the task | The task moves to you, the card shows an "Open in Codex" link |
| **Continue autonomously** | the task is yours | You confirm you are done. Kurami starts a fresh Codex task on the same branch |
| **Start preview** | the project supports previews, none exists yet | A slot is leased and the preview is built — see [Previews](@previews) |
| **Remove preview**, **Extend 24h**, **Mark reviewed** | a preview exists | Remove it, extend it, mark it reviewed |
| **Attempt CI fix** | CI failed or a required check is missing, fewer than two attempts | A fresh Codex task fixes exactly that commit |
| **AI Code Review** | the PR is open and this commit has no review yet | An independent reviewer reads the PR and posts a review on GitHub |
| **Fix Review** | the current AI review has findings | A fresh Codex task fixes them and resolves their threads |
| **Recover delivered fix** | a fix was preserved but not committed | Kurami rechecks the preserved task and finishes it |
| **Cancel run** | cancellation has not started | The run stops, resources are released, the issue returns to Backlog |

## A press queues a request

A button does not perform the action itself. The Discord plugin checks that you pressed it, writes a *request* to the database and immediately switches the card to "queued". The controller rechecks the conditions on the next minute and takes the step. So the reply "Start preview queued" only means "request accepted". The result shows on the card: the stage changes and an event arrives in the thread.

A stale or repeated press is harmless. If the condition no longer holds, Kurami answers with one line, "Control rejected safely: …", or rejects the request when it processes it. Details are on [Discord: cards and commands](@discord-control-plane).

::shot{file="shot-run-timeline.png" size="card" alt="Thread of run PF-23: events Ready for review and Preview is ready with links, and the final card of a completed run." caption="Events sit above, the current card below. The final card shows CI, AI review and the confirmed preview."}

## The /kurami status command

If the card has scrolled far up or looks stale, type `/kurami status` inside the run thread. Kurami posts a fresh card at the bottom and replies with a link to it. Outside a run thread the command refuses and changes nothing. Only you can use it. The other `/kurami` commands are in the [reference](@commands).

## Cancel and discard preserved work

**Cancel run** stops the run and releases the branch, working copy and preview. If some work should not be lost silently, the run moves to "Cancelled — local work preserved" and waits for you. The card then offers **Discard local work** for unpublished work, or **Close draft PR & discard** when a draft PR is open. Both buttons first open a confirmation visible only to you. Only the second press queues the request.

:::cards
- [How cards and commands work](@discord-control-plane) — the path from a press to an action
- [Previews](@previews) — start, extend and review a preview
- [Human control](@human-control) — take a task from Codex and hand it back
- [Commands and buttons](@commands) — the full reference
:::
