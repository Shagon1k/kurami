---
title: Human control
nav: Human control
summary: How to take control of a task, work on it yourself and return it to automation: the label, buttons and session handoff.
section: projects
group: guide
order: 50
next: previews
---

Human control is the run state in which you drive the task in the Codex app and Kurami does not write to its thread. Two paths lead there: the `human-control` label on the issue before the start, and the **Take control** button while Codex works.

Primary autonomous writers, fresh successors and human-control sessions keep their TUI handoff and Remote controls. CI repair and review fix use private app-server workers; their technical threads report `protocol_remote_handoff_unverified` if you request Remote ownership. The main thread remains preserved for the existing cleanup path. See [Codex session](@codex-sessions).

## The human-control label

The `human-control` label sends a run into human control right after preparation. Kurami reads an issue's labels once, when it admits the issue, so add the label before you move the card to In progress. A label added later does not change a run that is already going.

Codex gets a prompt: "study the task and prepare, change no files or external state until the owner approves". The hand-over is quick and does not wait for that turn to end:

1. The controller creates the working copy (worktree), starts Codex a minute later, and a minute after that finds its thread.
2. The minute after that, the controller sees a run with the label and a thread, and hands the thread to you. That is roughly the third minute after you moved the card.
3. If Codex is still working at that moment, Kurami interrupts the turn and closes the session.

So the "study" phase lasts minutes and can be cut off in the middle of a turn. The thread keeps whatever Codex managed to read and write.

## The buttons

The run card in Discord shows either Take control or Continue autonomously. They queue a request, and the controller carries it out on the next minute.

| Button | When it appears | What it does | What to check |
|---|---|---|---|
| **Take control** | Codex is working in a Kurami session | interrupts the turn, closes the session, hands the thread to the Codex app | the card became "Human control" and an "Open session" link appeared |
| **Take control** | work has stopped and there is no session (card "Ready for review") | records that you drive the working copy and thread; nothing is stopped | the same |
| **Continue autonomously** | the thread is yours (card "Human control") | you confirm your part is done; Kurami starts a new thread in the same working copy | the card shows "Starting autonomous continuation", then "Agent working" |

Take control does not work while Codex waits for approval, while the thread id is unknown, and while a technical task is still being cleaned up. If the screen does not calm down within ten seconds, Kurami retries every minute.

::shot{file="shot-run-human-control.png" size="card" alt="Run card PF-33 under human control: control is yours, an Open session link, buttons Continue autonomously and Cancel run." caption="Notice “Control · You”, the Open session link and the Continue autonomously button."}

The Projects App shows **Human control** in the task list and engineering card. For a Remote-owned run, the card offers **Open session**, using the same saved Codex thread as Discord. The link appears only when a valid thread identifier is available; opening it does not change run ownership or resume automation.

## What happens to the thread

The Codex thread stays the same one: Kurami renames it to `[TT-42]: Add dark mode toggle` and after the hand-over sends it no more messages. The "Open session" link opens exactly this thread. While the thread is yours, Kurami keeps watching CI and previews but does not start repairs or AI review: those are for after automation has stopped.

**Continue autonomously** does not resume your thread. Kurami reads its exact local history and the same-run predecessor chain without sending messages. A repeated continuation retains the original discussion as well as the stopped successor report. The snapshot includes your text and assistant final replies in order, including decisions discussed without editing files. It also includes the latest commit, dirty diff, PR, CI and AI review. Credential-like content is redacted; tool outputs and reasoning are excluded. A new thread starts in the same working copy and branch, preserving your uncommitted changes. Permission covers one successor; the label stays for the next run.

Finish the Remote turn before pressing the button, then stop writing in the old thread. If local history is missing, incomplete, ambiguous, compacted, changed or too large, continuation reports an error and starts no writer. Kurami does not substitute a guessed summary or discard your latest choices. The exact limits and source checks are in [Codex session](@codex-sessions).

:::guarantees
- Kurami does not write to a thread you drive.
- Kurami does not change the `human-control` label: autonomy after a hand-over is a permission for one successor.
- Kurami does not take control back without your press of Continue autonomously.
:::

How sessions, hand-over and thread replacement work is described in [Working copy and Codex session](@codex-sessions). The other card buttons are in [Controls in Discord](@owner-controls).
