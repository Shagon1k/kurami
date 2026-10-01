---
title: Human control
nav: Human control
summary: How to take a task from Codex, work on it yourself and hand it back: the label, three buttons and what happens to the thread.
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

The run card in Discord shows one of three ownership buttons. They queue a request, and the controller carries it out on the next minute.

| Button | When it appears | What it does | What to check |
|---|---|---|---|
| **Take control** | Codex is working in a Kurami session | interrupts the turn, closes the session, hands the thread to the Codex app | the card became "Human control" and an "Open in Codex" link appeared |
| **Continue in Codex** | work has stopped and there is no session (card "Ready for review") | records that you drive the working copy and thread; nothing is stopped | the same |
| **Continue autonomously** | the thread is yours (card "Human control") | you confirm your part is done; Kurami starts a new thread in the same working copy | the card shows "Starting autonomous continuation", then "Codex working" |

Take control does not work while Codex waits for approval, while the thread id is unknown, and while a technical task is still being cleaned up. If the screen does not calm down within ten seconds, Kurami retries every minute.

::shot{file="shot-run-human-control.png" size="card" alt="Run card PF-33 under human control: control is yours, an Open in Codex link, buttons Continue autonomously and Cancel run." caption="Notice “Control · You”, the Open in Codex link and the Continue autonomously button."}

## What happens to the thread

The Codex thread stays the same one: Kurami renames it to `[TT-42]: Add dark mode toggle` and after the hand-over sends it no more messages. The "Open in Codex" link opens exactly this thread. While the thread is yours, Kurami keeps watching CI and previews but does not start repairs or AI review: those are for after automation has stopped.

**Continue autonomously** does not resume your thread. Kurami builds a snapshot: the latest commit, the diff including unsaved edits, and the state of the PR, CI and AI review. Secrets are stripped from it, and a new thread starts in the same working copy and branch. Your uncommitted changes stay. The permission covers one successor, and the label is not removed: the next run of this issue starts with you again.

:::guarantees
- Kurami does not write to a thread you drive.
- Kurami does not change the `human-control` label: autonomy after a hand-over is a permission for one successor.
- Kurami does not take control back without your press of Continue autonomously.
:::

How sessions, hand-over and thread replacement work is described in [Working copy and Codex session](@codex-sessions). The other card buttons are in [Controls in Discord](@owner-controls).
