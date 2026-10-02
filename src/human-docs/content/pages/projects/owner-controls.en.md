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

## The Projects page

Open Projects through the Apps menu. Choose a project in the header, search for
a task, or sort by task, status and Kurami state. The interface defaults to
English. On phones, the bottom panel opens Projects and Search; More contains
language and theme. Desktop keeps project links and language in the header. The
table scrolls within the window, with more space inside each row. On mobile a
task fills the screen: swipe right
to return to the list and left to reopen the last task.

The **active** and **need you** counters on the left are filter buttons. Active
shows work in progress and tasks waiting for your attention; backlog, deferred
and done tasks stay hidden. Need you shows tasks requiring your decision.
Each count uses the same selection as its filter. Click an enabled filter again
to return to all tasks, or choose the other filter to switch views. The choice
stays in the page URL across searches, project changes and refreshes.

On phones the filter buttons show icons and counts beside a compact Sync button.
The total task count is hidden to keep the controls on one line. Their full names
remain available to screen readers.
Sync keeps a small freshness indicator: green for fresh data, amber for delayed
sync. Open Sync for each project's observation time.

The card lets you change the GitHub Project status and use eligible Kurami
actions, including AI Review and preview controls. They share Discord's request
queue. Sync shows each project's freshness; the page refreshes every 30 seconds.
Check results use text values; the task status uses a badge. Suggested next comes
from the same ranking as Projects Digest. Discord continues to show notifications
and run state.
Without an observed agent run or stage, the Kurami column shows **No agent run**.
This is separate from the task's GitHub status, including Done.

The status editor stays visible. Issue, PR, review and Discord links use bordered
buttons in a grid. CI, review and preview share one block,
with repair actions beside their checks. Preview has its own link and expiry.
A matching commit appears once; differing commits stay visible. A ready review
does not mean there are no findings.

A single action fills its row; two actions share a row, including Open preview
and Remove preview. Continuation, recovery and cleanup actions sit below the
checks without separate headings. Informational notes use a distinct color;
review counts use a monospaced font.
Paired buttons keep the same height when their labels wrap. A deletion
confirmation fills the action area, with its buttons aligned right.

During a swipe, the panel follows your finger; a short drag returns it to place.
The last task opens from page memory and then refreshes. Controls stay disabled
until fresh data arrives. Vertical scrolling and form fields do not switch views;
a deletion confirmation also disables swipes.
The saved scroll position is restored before the panel appears.

Action feedback appears in a small bottom-right notification, not beside search.
Successful requests disappear automatically. Errors and unconfirmed status
writes stay until you close them or another result replaces them. Refreshing the
table preserves the notification; on phones it remains available inside the task
dialog. A queued request is not proof that the action has completed: check the
card's current state.

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

A button appears only when its action is valid in the current state. The card shows at most four buttons in the order below; the rest live under **More actions…**. The three ownership buttons, Take control, Continue in Codex and Continue autonomously, are covered in [Human control](@human-control). The full table with ids and request names is in the [commands reference](@commands).

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
