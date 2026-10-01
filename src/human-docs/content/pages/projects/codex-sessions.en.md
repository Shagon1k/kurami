---
title: Working copy and Codex session
nav: Codex session
summary: How Kurami prepares a separate branch, starts Codex in it under supervision, and recognises that a turn has finished.
section: projects
group: internals
order: 50
next: engineering-evidence
---

A Codex session is an ordinary interactive Codex CLI that Kurami starts in tmux inside a separate working copy (worktree) and supervises until the turn ends.

:::glance
- What it does: creates a branch and working copy, starts Codex in it, watches the session and releases it when the turn is finished
- Who starts it: the controller, one step per one-minute cycle
- Where it runs: the Codex process inside a tmux session `cx-…`; between steps Kurami holds nothing in memory
- State: `runs` and `run_resources` in the Run Store — session owner, tmux name, Codex thread id
- Limits: one Codex at a time by default (1 to 3 in settings), at most three tmux sessions
- What you see: card stages "Codex working", "Finalizing for review", "Needs attention"
:::

```diagram
kind: graph
title: From an admitted run to a working Codex
desc: The controller calls scripts one after another. The first creates a branch and working copy from the main clone. The second starts a wrapper script in tmux, which starts Codex. A separate call finds the Codex thread through app-server and records its id in the Run Store.
node controller "Controller" "one step a minute" at 1,0
node runs "run_resources" "worktree, tmux, thread" store at 0,1
node provision "Create the copy" "git worktree add" at 1,1
node repo "Main clone" "source only" external at 2,1
node worktree "Branch and copy" "TT-42_add-dark-mode-toggle" at 1,2
node tmux "tmux cx-tt-42-3f9a1c" "launcher script" at 0,3
node codex "Codex CLI" "workspace-write sandbox" at 1,3
node appserver "codex app-server" "find and name thread" external at 2,3
group kurami "Server" controller runs provision repo worktree tmux codex appserver
edge controller -> provision "creates"
edge provision -> repo "fetch"
edge provision -> worktree "adds"
edge controller -> tmux "starts"
edge tmux -> codex "exec"
edge codex -> worktree "writes code"
edge controller -> appserver "sync"
edge controller -> runs "records"
```

## Branch and working copy

A working copy is a separate directory with its own branch, created from a fresh main clone of the repository. That way Codex edits files without touching the main clone, and two runs do not disturb each other.

The controller calls the provisioning script when a run is admitted and the board data is fresh (no older than two minutes). The script first checks that the path lies inside the project's working-copy root, that the main clone's `origin` matches the project repository, and that neither the directory nor a local branch of that name exists. It then moves the run to `starting` in one transaction, runs `git fetch --prune origin main` and creates the branch from the fetched `origin/main` commit. That commit is saved as `base_sha`; later checks use it to confirm the copy has not drifted from its base.

[Admission](@project-admission) chooses the branch and directory names. For the issue "[Feature]: Add dark mode toggle" that is the branch `TT-42_add-dark-mode-toggle` and the directory `…/.worktrees/tailortales/TT-42_add-dark-mode-toggle/TailorTales`. The parent directory is unique per attempt, and the last segment equals the repository name so that the Codex app shows a readable project name.

If anything fails, the run goes to `needs_attention` and the resource to `partial`. Kurami deletes nothing on its own: whatever got created stays.

## Starting in tmux

The controller runs Codex in tmux because you need the same thread: you can open it in the Codex app and continue yourself. There is no separate "agent" process — an ordinary interactive CLI runs, and Kurami looks at its terminal.

The steps: the controller checks that the copy and branch are the expected ones and that `base_sha` is an ancestor of the current HEAD. It picks the session name `cx-tt-42-3f9a1c` (project prefix, issue number, first six characters of the run id) and records it in `run_resources` inside a transaction that also checks the three-session limit. Then it writes the prompt to a file `state/session-prompts/<run>-<time>.b64` (mode 600) and creates a tmux session that executes `bin/launch-codex-session.sh`. The tmux environment holds no secrets.

The launcher works like a checkpoint. It refuses to start if `secrets/github.env` is readable by the group or others, or if the working copy is not a linked worktree of exactly the main clone named in the project settings. It then reads and deletes the prompt file, loads `GH_TOKEN` and replaces itself with the Codex process:

```text title="Codex flags"
codex -C <worktree> --sandbox workspace-write
  --add-dir <worktree git dir> --add-dir <common git dir>
  -c sandbox_workspace_write.network_access=true
  --ask-for-approval never -c approvals_reviewer="auto_review"
  -c projects."<main clone>".trust_level="trusted"  "<prompt>"
```

The `workspace-write` sandbox allows writing only to the copy and its git directories, the network is on, and Codex is not supposed to ask for approval: the only escalation path is the built-in automatic reviewer. When the Codex process exits, the tmux session disappears with it. A second later the controller checks that the session is alive and moves the run to `running` with owner `cli`.

## How Kurami finds the Codex thread

Kurami learns the thread id after the start, because the CLI creates the thread itself. On the next minute the controller performs the `sync` step: through `codex app-server` it takes the newest CLI thread whose working directory is this copy, renames it to `[TT-42]: Add dark mode toggle` and records the UUID in `run_resources.codex_thread_id`. Technical tasks get a suffix: ` · CI fix 1/2`, ` · Review fix 1`, ` · Autonomous continuation 1`.

## Who owns the session

Every working copy has at most one writer, shown by the `owner_state` field. `none` means no writer, `cli` means a managed tmux session owns it, `remote` means the Codex app drives the task. The rule is simple: two processes writing to one branch would corrupt it, and that cannot be detected afterwards.

```diagram
kind: graph
title: Owner of the working copy
desc: A managed session owns the copy while a turn runs. When the turn is finished Kurami releases the copy and there is no owner. Take control and the human-control label hand the thread to the Codex app; Continue autonomously starts a new thread. A time limit or an approval prompt stops the run in needs_attention.
node none "owner: none" "nobody writes" state at 0,1
node cli "owner: cli" "tmux and Codex" state at 1,0
node remote "owner: remote" "the Codex app" state at 2,1
node attn "needs_attention" "waits for you" wait at 2,0
edge none <-> cli "start · turn end"
edge cli <-> remote "Take control"
edge cli -> attn "approval, time limit" accent
```

Handing a session to you is the `handoff` step, triggered by the Take control button or the `human-control` label. The controller presses Escape, waits up to ten seconds for the screen to be calm twice in a row, closes Codex and tmux and records the owner `remote`. The thread stays the same; what you see is in [Human control](@human-control).

## How Kurami knows the turn has finished

Kurami treats a turn as finished when specific lines appear in the terminal, not when the process exits. After its answer Codex stays alive and waits for the next message: the process does not end by itself. The sign of the end is a block `Worked for 32m 8s · 10:37` followed by the prompt `› Ask Codex to do anything`, with neither "Working (" nor an approval question on the screen.

When an autonomous run shows that sign, the controller performs `park`. It captures the screen once more, saves its tail to `logs/session-handoffs/` (mode 600), sends Codex Ctrl-U and Ctrl-D and waits up to ten seconds for it to exit. If the turn is complete and the process still holds on after a second, the session is killed: nothing is lost, the turn is over. The run then moves to `parked_review`, the owner to `none`, and the tmux name is cleared.

```diagram
kind: sequence
desc: The controller captures the tmux screen, sees a finished turn, sends Codex an exit signal, checks that tmux is gone and records the release in the Run Store.
actor ctl "Controller"
actor tmux "tmux"
actor codex "Codex"
actor db "Run Store"
self ctl "capture-pane: turn finished?"
msg ctl -> tmux "Ctrl-U, Ctrl-D"
msg tmux -> codex "end of input"
self codex "process exits"
note tmux "session gone"
msg ctl -> db "parked_review, owner none"
```

## The observer and the time limits

The observer is a terminal check at the start of every minute that catches stuck sessions, and the time limit stops sessions that run too long. Both work independently of the controller, so a fault in one does not hide a problem in the other.

The observer looks only at sessions with owner `cli`. It notices five situations:

| What it sees | What the observer does |
|---|---|
| Codex asks for approval (`Would you like to run…`, `Press enter to confirm`) | after two checks in a row moves the run to `needs_attention`, rejects a pending Take control and approves nothing; when the question is gone it returns the run to `running` |
| "Approaching rate limits… Switch to … for lower credit usage?" | presses Enter at once and accepts the switch to the cheaper model |
| the tmux session is missing | after two checks writes a message to the observer output |
| the turn was interrupted (`Conversation interrupted`) | after two checks writes a message to the observer output |
| a textual blocker ("Publishing is blocked", "cannot push", "Re-authenticate with") and a fresh `›` prompt | after two checks writes a message to the observer output |

Only the approval case changes the run state. The other three are messages without a transition: the decision stays with you.

The time limit counts from the start of the task: the main writer gets 240 minutes; technical tasks (CI repair, review fix) and AI review get 90 each. When time is up, Kurami presses Escape, types `/exit` and, if needed, kills the session. The terminal tail goes to `logs/runtime-timeouts/` and the run to `needs_attention`. The branch, working copy and thread stay.

## Technical tasks and the thread swap

A technical task is a fresh Codex started in the same working copy to fix CI or review comments. It gets a narrow prompt with the evidence and knows nothing about the first conversation. The main thread is not lost: Kurami performs a *thread swap*.

When a technical task starts, the controller records `previous_codex_thread_id := codex_thread_id` and clears `codex_thread_id`. The `sync` step finds the new thread and stores it. When the task is done, the controller archives the technical thread through `codex app-server` and restores the main one. While `previous_codex_thread_id` is not empty the cleanup is unfinished, and Take control is unavailable.

A similar device is the *successor*. When you handed the thread to the Codex app and press "Continue autonomously", Kurami does not resume the old thread. It builds a trimmed snapshot (HEAD, `git status`, both diffs up to 24,000 characters, CI and the latest AI review), strips secrets from it and starts a new Codex with the tmux name `…-a1`. The old thread stays as history.

::::example Run TT-42 from the copy to the end of the turn
The data is invented. Run `r_3f9a1c7e5b2d4a8c6e01`, TailorTales, issue "[Feature]: Add dark mode toggle".
:::steps
- **Controller** — 10:01 creates the copy `…/TT-42_add-dark-mode-toggle/TailorTales` from `origin/main` at commit `9c1d4e7`; the run becomes `starting`.
- **Controller** — 10:02 creates tmux `cx-tt-42-3f9a1c`, the launcher starts Codex. The run is `running`, the owner `cli`.
- **Controller** — 10:03 performs `sync`: the thread is named `[TT-42]: Add dark mode toggle` and stored in the database.
- **Codex** — until 10:41 writes code, pushes and opens a draft PR. The screen shows `Worked for 38m 12s · 10:41` and the `›` prompt.
- **Controller** — 10:42 sees the finished turn and performs `park`. tmux disappears, the run is `parked_review`, the owner `none`.
- **Observer** — looked at the screen every minute and found nothing: `attention_kind` in `run_attention` is empty.
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| The copy cannot be created (fetch, path taken, foreign `origin`) | run to `needs_attention`, resource `partial` | read the cause, cancel the run |
| tmux dies within a second of the start (permissions on `secrets/github.env`, no `codex`) | session removed, run to `needs_attention` | fix the cause, cancel and start again |
| Codex asks for approval | after two checks `needs_attention`, nothing approved | open the session and decide, or take control |
| The tmux session vanished mid-turn | observer message; state unchanged | Take control (works without tmux) or Cancel run |
| Time is up (240 or 90 minutes) | process stopped, run to `needs_attention`, everything kept | read the terminal tail, take control or cancel |
| The process crashed between "claim the resource" and "record the result" | the run stays in `starting`, no automatic continuation | cancel the run, check the copy and tmux by hand |
| Codex did not open a PR | the card stays "Codex working" or "Ready for review" without CI | take control or cancel |

:::guarantees
- One working copy is written by one owner: `none`, `cli` or `remote`.
- The main clone of the repository is not a working directory; the launcher checks this at every start.
- Kurami does not answer Codex's questions for you. The only automatic keypress is the switch to a cheaper model at the rate limit.
- Only tmux sessions named `cx-…` (and `rv-…` for reviews) are killed.
- A time limit keeps the branch, copy, thread and terminal tail.
- Kurami does not resume a thread a human drove: it starts a new one.
:::

:::code-map
- `src/orchestrator/projects/worktrees/provision.ts` — creating the branch and working copy
- `src/orchestrator/projects/sessions/session-start.ts` — checks, session claim and tmux start
- `bin/launch-codex-session.sh` — secret and copy checks, Codex flags
- `src/orchestrator/projects/sessions/manager.ts` — `sync`, technical thread cleanup
- `src/orchestrator/projects/sessions/session-stop.ts` — `park`, `handoff`, cancellation
- `src/orchestrator/runtime/codex-terminal.ts` — end-of-turn signs in terminal text
- `src/orchestrator/projects/sessions/observe.ts` — the observer
- `src/orchestrator/projects/sessions/runtime-budget.ts` — time limits
- `src/orchestrator/projects/sessions/autonomous-successor.ts` — starting the successor
- `src/orchestrator/integrations/codex/app-server.ts` — the `codex app-server` client
:::
