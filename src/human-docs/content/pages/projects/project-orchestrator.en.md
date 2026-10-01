---
title: Project Orchestrator
nav: Overview
summary: You move a card on a GitHub board; Kurami turns that into engineering work by Codex on its own branch and follows it until the merge or a cancellation.
section: projects
group: start
order: 10
next: board-statuses
---

:::glance
- What it does: turns moving an issue into In progress into a Codex run on its own branch and working copy (worktree)
- Who starts it: you, by moving a card on the GitHub Project board
- Rhythm: once a minute — poll the board, admit new work, take one step for every run
- State: the Run Store SQLite database, one `runs` row per attempt at an issue
- Where you see it: the run card and thread in Discord, the PR and CI in GitHub
- Your decisions: merging the PR, deploying, deleting preserved work
:::

Project Orchestrator works like a thermostat. The GitHub Project board is the *desired* state: which issues you want in progress. The Run Store is the *actual* state: what has been created, started and checked. Once a minute Kurami compares the two and takes exactly one safe step to bring the actual state closer to the desired one. There is no background daemon: every step is a short script that reads the state from SQLite, checks it again and records the result.

## The parts

```diagram
kind: graph
title: The one-minute cycle of Project Orchestrator
desc: You move a card on the board. The board poll records the transition as an event, admission turns it into a run, the controller creates a branch and starts Codex, and Discord shows what is happening. Codex pushes code and opens a PR on GitHub.
node you "You" "move a card" owner at 0,0
node board "GitHub Project" "the issue board" external at 1,0
node github "GitHub" "PR and CI" external at 2,4
node poller "Board poll" "every minute" at 1,1
node events "project_events" "transition queue" store at 0,2
node admission "Admission" "issue, limits, disk" at 1,2
node runs "runs" "run state" store at 0,3
node controller "Controller" "one step per run" at 1,3
node discord "Discord" "card and thread" external at 2,3
node worktree "Branch and working copy" at 0,4
node codex "Codex" "session in tmux" at 1,4
group kurami "Kurami on the server" poller events admission runs controller worktree codex
edge you -> board "In progress"
edge board -> poller "statuses"
edge poller -> events "transition"
edge events -> admission
edge admission -> runs "new run"
edge runs <-> controller
edge controller -> worktree "creates"
edge controller -> codex "starts"
edge codex -> github "push and PR" dashed
edge controller -> discord "updates"
```

Inside Kurami there are five parts, each with one job. The **board poll** reads the GitHub Project and notices that a card changed column. **Admission** decides whether the issue may become a run right now. The **Run Store** holds everything known about every run. The **controller** picks the next step for each run and performs it. **Discord** shows you the state and takes your commands — a button does not act immediately, it queues a request for the controller.

## One issue, end to end

::::example Issue TT-42 "Add dark mode toggle"
:::steps
- **You** — at 10:00 you move the card from Backlog to In progress.
- **Board poll** — at 10:01 it sees the column change and queues an event.
- **Admission** — the issue is open, has a description, and the limits and disk allow it. A run appears in state `admission_pending`.
- **Controller** — creates the branch `TT-42_add-dark-mode-toggle` and a working copy, and starts Codex the next minute.
- **Codex** — writes code for forty minutes, pushes commits and opens a PR. Kurami follows CI for that exact commit.
- **Kurami** — sees that Codex finished its turn, releases the session and moves the card to Human Review. Discord shows "Ready for review".
- **You** — read the PR, optionally ask for an AI review or a preview, merge the PR and move the card to Done. Kurami confirms that the PR really is merged and removes the branch and working copy.
:::
::::

Each line of this path takes a minute or more. That is by design: the controller takes one step per run per cycle, so a failure anywhere along the way leaves a clear state that the next minute continues from.

## Three ideas that hold it together

:::compare
### The board is intent, the database is fact
You steer by moving cards, not by managing processes. Kurami reacts only to *transitions* between columns: a card that was already in In progress at the first poll does not start any work.
### One step, checked again
Every step re-reads the run from the database and refuses if the state has changed in the meantime. So two overlapping cycles or a crashed process break nothing: the next minute simply tries again.
### Proof is an exact commit
CI, reviews and previews belong to one SHA — the PR's latest commit. A new commit means new checks. The branch is deleted only when its commit has provably reached the main branch.
:::

## Where to go next

:::cards
- [Board statuses](@board-statuses) — what each move of a card does
- [Connecting a project](@project-setup) — how to add a repository and a board
- [Connecting a project](@project-setup) — how to add a repository and a board
- [Controls in Discord](@owner-controls) — the run card, its buttons and what they do
- [Projects Digest](@project-digest) — which issue to take next
- [Projects Digest](@project-digest) — which issue to take next
- [Admission](@project-admission) — the checks an issue passes before a run starts
- [Controller](@controller) — how the one-minute cycle chooses the next step
- [Run lifecycle](@run-lifecycle) — every run state and the moves between them
- [CI and AI review](@engineering-evidence) — checks of the exact commit and how they get fixed
- [Why it is so](@projects-decisions) — the decisions behind the design
- [Why it is so](@projects-decisions) — the decisions behind the design
:::

:::guarantees
- It never merges a PR or deploys application code — that is always your decision.
- It never creates two runs for one issue: a unique index in the database forbids it.
- It never deletes unsaved or published work without your explicit confirmation.
- It never retries a rejection silently: a rejected issue waits until you move it again.
:::

:::code-map
- `run-project-poller.sh` — the one-minute cycle: poll, admission, controller and Discord in order
- `src/orchestrator/projects/poll-projects.ts` — board poll and recorded transitions
- `src/orchestrator/projects/process-project-events.ts` — admission and reactions to transitions
- `src/orchestrator/runtime/controller.ts` — the controller: plan and execute steps
- `migrations/` — the Run Store schema
:::
