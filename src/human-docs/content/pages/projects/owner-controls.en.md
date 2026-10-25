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

::shot{file="shot-run-ready-review.png" size="card" alt="Run card PF-33 at Ready for review: CI failed, preview required, buttons Take control, Start preview, Attempt CI fix, AI Code Review and a More actions menu." caption="Up to four buttons in a row, the rest under More actions. Links to the issue and PR sit on their own line, not on buttons."}

Use **Run review** to choose **General** (correctness and operational risks) or **Clarity** (unnecessary code complexity). Both results remain visible separately with their reviewed commits. **Fix findings** starts one agent for all completed review profiles on the current PR commit, including General and Clarity. It also includes your unresolved review threads. There is no profile selector for this action. Clarity is manual and optional; General remains the autopilot review.

General and Clarity can be queued independently, including while the other profile is running. Each profile permits one queued or running review per task. Both count toward **Concurrent LLM**: if no slot is free, the second review waits in the queue. Fixing findings waits for all running reviews to finish.

## The Projects page

Open Projects through the Apps menu. Choose a project in the header, search for
a task, or sort by task, status and Kurami state. The interface defaults to
English. On phones, the bottom panel opens Projects and Search; Settings contains
language and theme in horizontal rows. Outline project icons distinguish folders,
a panda, a fox and a profile card; selected links have a left rail. Each project has its own colour:
the project icon and name tell tasks apart in the mixed list; Neon adds a soft glow around the icon.
A subtle warm tint means "your decision needed"; a selected task has a quiet blue tint. Search opens at the top of the visible screen and adjusts to
the keyboard. Desktop keeps project links and language in the header. The
table scrolls within the window, with more space inside each row. On mobile a
task fills the screen: swipe right
to return to the list and left to reopen the last task.

On phones, ten tasks appear initially. **Show more** reveals the next ten. Search checks the whole list, and refreshing keeps the number already revealed. Reopening the current task adds no duplicate browser-history entry.

The **remaining**, **active** and **need you** counters on the left are filter buttons.
Remaining is selected by default: it hides tasks in the project's Done status and
keeps Backlog, Deferred and other unfinished tasks. Active shows work in progress
and tasks waiting for your attention; backlog, deferred and done tasks stay hidden.
Need you shows tasks requiring your decision. Only one filter is enabled at a time.
Each count uses the same selection as its filter. Click the enabled filter again
to show all tasks, including Done, or choose another filter to switch views. The
choice stays in the page URL across searches, project and language changes, reloads
and automatic refreshes. Opening Projects without a saved filter URL selects Remaining.

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

### Complete a pull request

While Fix Review is queued or active, the task stage and AI Review block show its
current phase: queued, editing, waiting for CI or resolving threads. The displayed
round comes from the Run Store, not the old preview status. Completion and
needs-attention states remain visible. Conflicting controls stay unavailable
until the agent stops and technical-session cleanup finishes.

At the bottom of a managed task, **Cancel run** sits beside the PR action.
When no PR action is available, its explanation appears below the actions;
the disabled PR button keeps its place, so **Cancel run** keeps the same width.
Loading and temporary read failures also preserve both buttons.
Queued, running and failed actions show their status in a full-width row below the button pair.
Each status names its action; multiple messages stack without sharing a button column.
For a draft, **Ready for review** opens a confirmation. For an open non-draft,
**Merge PR** opens a compact menu of allowed methods: Squash, Rebase or Merge commit.
Choose a method, then confirm it in the same popup:
**Squash and merge**, **Rebase and merge** or **Create merge commit**.
Selecting a method does not merge the PR.
Repository settings and effective branch rules narrow the list; Squash appears first when available.
The page reads GitHub when you open the
task and refreshes that view with the task, without blocking the task table.

Both actions require an active or review task, fresh project data and a stopped, unowned run. Before writing,
Kurami rechecks the current PR, commit, permissions and merge requirements.
Fresh polling settles an older status write for this check; its original receipt stays in the database.
An unresolved write still blocks PR actions. A conflict notice clears after two minutes only when fresh polling observes the later status.
Merging submits the displayed head SHA without bypassing GitHub rules.
Stacked PRs, non-default target branches and merge queues remain managed in GitHub.

When a merge is confirmed, the notice celebrates: a small Kurami sticker on its left edge in place of the check mark
(not when the character is switched off in Hub, and without motion when the device asks for less).

GitHub accepting a merge request does not mean the PR has merged. **Check result**
rechecks the same request after 30 seconds without issuing another write.
While its result is pending or unconfirmed, run controls and status changes are
locked. Kurami leaves the Project status unchanged: a configured GitHub workflow
can move the task to Done after merging. Normal polling then observes that change.
See [Completion and cleanup](@release-cleanup) for the resulting cleanup.

For an issue in Backlog, click **Start work**: choosing In progress and saving separately is no longer needed.
The card immediately shows the start request, then synchronization, admission and session preparation.
Waiting survives reload through the request receipt, not a UI timer.
Another click does not create a second request. When a write is unconfirmed, **Check result** checks the same request.
An admission refusal shows its reason and leaves the status editor available; actual execution replaces the waiting state.

If Projects changes while the page is open, reload when prompted. Kurami keeps the previous card and disables writes instead of combining new markup with older scripts and styles. A successful refresh clears its previous refresh-error notice.

For other states, the status editor stays visible. Issue, PR, review and Discord links use bordered
buttons in a grid. CI, review and preview share one block,
with repair actions beside their checks. Preview has its own link and expiry.
After **Mark reviewed**, its button disappears and **Preview reviewed** stays visible with a green check.
The mark refers to the exact preview commit. After the PR changes, an amber mark says **Reviewed for an earlier commit**.
A matching commit appears once; differing commits stay visible. A ready review
does not mean there are no findings.

A single action fills its row; two actions share a row, including Open preview
and Remove preview. Continuation, recovery and cleanup actions sit below the
checks without separate headings. Informational notes use a distinct color;
review counts use a monospaced font.
Paired buttons keep the same height when their labels wrap. A deletion
confirmation fills the action area, with its buttons aligned right.

CI and review fixes use a blue accent, as does saving a changed status.
Removing a preview uses amber; marking it reviewed uses green. Cancel run and
discarding work remain red. Starting a preview or review, opening links and
marking a draft ready remain neutral; disabled actions stay gray.

Review counts separate critical findings in red, important findings in amber and
suggestions in neutral text. Ordinary action information and synchronization use
blue; stale data and unconfirmed writes use amber. Explicitly failed or rejected
run actions use red. Preview expiry is neutral until its last hour, then amber;
an elapsed expiry is labeled without claiming that the environment has stopped.

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

### Quick task "+"

**+** in the Projects header opens a short form: the project and one field, "What should happen", in your
own words. **Hand to Kurami** queues it: Kurami picks the fitting issue form of the project's repository (bug,
feature, tech debt…), fills its fields from your text and files the issue with the form's labels; a managed
project's card goes straight onto the board in Backlog. Your note is kept in the issue under a spoiler. It usually
takes about a minute; a notice tells you the number. When the model is unavailable the issue is filed as written,
so nothing is lost. A repeated tap creates no duplicate.

The form also opens from:

- the **Quick task** shortcut on a long press of the app icon;
- **Share → Kurami** on Android, including from a Kurami page itself: the shared title, text and link fill the form.

### Ideas

Not everything is a task. Tell an idea to any Kurami chat: Discord or Telegram, a Claude Code or Codex session,
later the site chat. They all share one `kurami-ideas` skill and one pool. Only the gist is required; Kurami
keeps the message verbatim and asks at most three of the missing questions (what prompted it, where it belongs,
a first step, when) — answer "skip" to any of them. Saving an idea starts nothing.

Requests such as "add a task", "record a task" and "we should do this later" also go into the ideas pool.
To record a task elsewhere, name the destination: "create an issue in GitHub" or "add a task to the
PickFlick backlog". A request to change or implement something now starts work.

Open ideas (new and thinking) sit in the **Ideas** block under the table: number, gist, project, "when" and the
date. An idea unfolds into its details, a journal of notes and status changes (entries are only ever added) and
a field for a new note. Parking, closing or turning an idea into a task is a request in any chat ("park idea
3", "make idea 3 a task in PickFlick"). Ideas are stored in Kurami and included in the daily backup.

## What the card shows

Read the card from the top. First comes the stage (**Ready for review**) and a one-line explanation. The **Control** line appears only when it matters who holds the task: `AI Agent` means managed Codex is working, `You` means the task was handed to you. Below is a compact table of CI, AI review, Preview and Policy, then details for each check and a line of links: issue, PR, preview, Codex. The footer has a short run id and the update time in local time.

The stage decides which buttons make sense. Stage and button names are given as they appear in Discord.

| Stage | What is happening | What you usually do |
|---|---|---|
| Preparing worktree, Starting agent | Kurami prepares the working copy (worktree) and starts Codex | wait |
| Agent working | Codex is writing code | wait, or press Take control |
| Ready for review | Codex finished, the PR is open, the session is free | read the PR, optionally start checks |
| Fixing CI, Review fix queued, Fixing review | Kurami started a separate Codex task to fix something | wait |
| Preview queued, Preview ready | the preview is building or open | look at it, press Mark reviewed |
| Preview required | Done was requested but the required preview is missing | start and confirm the preview |
| Human control | the task is yours, automation released it | work in Codex, then Continue autonomously |
| Needs attention | automation stopped and waits for you | read the text on the card |
| Cancelled — local work preserved | the run was cancelled, local work kept | decide: keep or delete |
| Completed | the run is done, resources released | nothing |

## Buttons

A button appears only when its action is valid in the current state. The card shows at most four buttons in the order below; the rest live under **More actions…**. The ownership buttons, Take control and Continue autonomously, are covered in [Human control](@human-control). The full table with ids and request names is in the [commands reference](@commands).

| Button | When it appears | What it triggers |
|---|---|---|
| **Take control** | Codex is running in a managed session | Kurami interrupts Codex's current turn, waits for a pause and hands the thread to you |
| **Take control** | Codex finished and nobody owns the task | The task moves to you, the card shows an "Open session" link |
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

## Retry an interrupted request

If a primary agent request ends with a native error, the run shows **Needs attention** instead of **Working**. Use **Retry** in the Projects task or Discord card to request one continuation in the same session. Existing work, model, configuration and approval boundaries stay in place. No automatic retries or model switches occur.

The control rechecks the provider, failed attempt, ownership, branch, working copy and idle session. Busy sessions, permission prompts, typed input and competing actions refuse the request. After sending, the card waits for a new native attempt before showing **Working**. An unconfirmed send is never replayed automatically; inspect that session through chat. Provider-specific state and transport live in an adapter. Codex is currently supported; an unknown provider never falls back to Codex.
