---
title: Board statuses
nav: Board statuses
summary: What Kurami does when you move a card between GitHub Project columns, and what to do when an issue did not start.
section: projects
group: guide
order: 20
next: project-setup
---

The GitHub Project board is your control panel: each column tells Kurami what to do with an issue. Kurami reacts to a card being *moved*, not to where it sits. Whatever was on the board at a project's first poll stays a baseline and starts no work.

::shot{file="shot-project-board.png" size="wide" alt="GitHub Project board of TailorTales with Backlog, In progress, Human Review, Done and Deferred columns and issue cards" caption="Five columns. Their names come from the project configuration; Kurami matches them letter for letter."}

## What each move does

```diagram
kind: graph
title: What happens when you move a card
desc: A decision tree. A move to In progress passes three checks and ends either in a run or in a rejection with a reason. A move to Human Review pauses the run for review, Done starts completion, and Backlog or Deferred cancels the run while keeping the work.
node move "Card moved" "you, on the board" owner at 1,0
node col "Where to?" "new column" decision at 1,1
node park "Review pause" "Codex finished its turn" at 0,2
node gates "Issue fit?" "open, has description" decision at 1,2
node done "Completion" "after the merge" at 2,2
node cancel "Cancellation" "work is kept" at 3,2
node ignored "Ignored" "no consequences" at 0,3
node live "Run exists?" decision at 1,3
node rejected "Rejection" "with a reason" fail at 0,4
node room "Room left?" "limits and disk" decision at 1,4
node admitted "Run created" end at 2,4
edge move -> col
edge col -> park "Human Review"
edge col -> gates "In progress"
edge col -> done "Done"
edge col -> cancel "Backlog, Deferred"
edge gates -> ignored "no" muted
edge gates -> live "yes"
edge live -> ignored "yes" muted
edge live -> room "no"
edge room -> rejected "no" accent
edge room -> admitted "yes"
```

| Move | What happens | What you see |
|---|---|---|
| Any column → **In progress** | If the issue passes the checks, a run appears and Codex starts working | Discord card: "Preparing worktree", then "Starting Codex" |
| → **Human Review** | The run pauses for review. The Codex session closes once it finishes its current turn | "Finalizing for review", then "Ready for review" |
| → **Done** | Completion starts: resources are released only after the merge is proven | "Stopping", then "Completed" |
| In progress or Human Review → **Backlog** or **Deferred** | The run is cancelled. Unsaved and published work stays with you | "Cancelled", or "Cancelled — local work preserved" |
| Any other move | Recorded and ignored | Nothing |

Backlog and Deferred both mean "not now", but they differ. [Projects Digest](@project-digest) picks the next-task candidate from Backlog. Deferred waits for your explicit decision and does not appear in suggestions.

## Two labels

Labels sit on the GitHub issue itself and are read at the moment the card moves.

| Label | What it changes |
|---|---|
| `human-control` | The run starts under your control: Codex takes its first turn, then the session is handed to you in the Codex app. Limits and checks are the same. See [Human control](@human-control) |
| `preview-required` | A move to Done does not complete the run until you open the preview of the exact commit and mark it reviewed. See [Previews](@previews) |

## Why an issue did not start

The reason is always recorded on the run or the event.

| Symptom | Cause | What to do |
|---|---|---|
| No Discord card, no run record | The issue is closed, has an empty description or belongs to another repository | Add a description, move the card to Backlog and back to In progress |
| You moved a card from Human Review back to In progress and nothing happened | The issue still has a live run paused for review | Use the buttons in the Discord thread: Fix Review, Continue in Codex |
| Run is `rejected`: `WIP limit reached: global 2/2, project 1/2` | All slots are taken | Finish or cancel another run, then move the card again |
| Run is `rejected`: `Resource guard blocked admission: …` | Disk is 85% full, the worktree cap is reached, or there is an unaccounted directory or tmux session | Deal with the resource named in the reason, then move the card again |
| Discord card says "Waiting for GitHub" | The board poll failed or went stale | Wait: the next successful poll resumes the run by itself |

There is no automatic retry. To retry, move the card to Backlog and back to In progress: that is a new event, and Kurami creates a new run linked to the rejected one.

## What Kurami moves itself

Kurami performs only two moves. When autonomous Codex has finished and the PR and CI are known, Kurami moves the card from In progress to **Human Review**. When a cancelled run has fully released its resources, Kurami moves the card to **Backlog**, so a cancelled issue does not sit in progress and your next move to In progress is a fresh start. Kurami records these moves on its side, so it does not mistake them for yours.

How an issue is checked, how limits are counted and how names are chosen is described in [Admission](@project-admission). How the board turns into events is in [From board to event](@event-intake).

:::guarantees
- A run starts only from a card move: neither the baseline nor a card created directly in In progress begins work.
- A move to Backlog or Deferred cancels the run but never deletes unsaved or published work.
- Kurami moves cards itself only to Human Review and to Backlog.
:::

:::code-map
- `src/orchestrator/projects/poll-projects.ts` — notices a card move and records the event
- `src/orchestrator/projects/process-project-events.ts` — decides what to do with each move
- `src/orchestrator/projects/project-status.ts` — the only place where Kurami changes a board column
- `deploy/config/projects.yaml` — the five column names and the labels of a project
:::
