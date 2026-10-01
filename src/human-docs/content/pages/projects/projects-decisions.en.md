---
title: Why it is so
summary: The decisions that shaped Project Orchestrator: what was needed, what was decided, why, and what it costs.
section: projects
group: decisions
order: 10
---

Each decision is written in one format: **Context** — what was needed, **Decision** — what was done, **Why** — the reason, **Trade-off** — what it costs. The system-wide principles are on the [Principles](@principles) page.

## State lives in SQLite, and processes live for seconds

**Context.** Kurami runs on one server under Hermes. A reboot, a crash or two overlapping runs must neither lose state nor create duplicates.

**Decision.** All memory sits in one SQLite file. Every step is a short script: it opens the database, checks the record, changes it in one transaction and exits. There is no long-running process.

**Why.** State that is not in memory cannot be lost with a process. The database can be read with plain `sqlite3`, and every step can be repeated after a crash.

**Trade-off.** Any step takes up to a minute, and events arrive by polling, not by signal.

## A project's first poll is a baseline, not a command

**Context.** When you connect a project, its board already has cards in In progress. Launching them all at once would start as many Codex sessions as there are cards.

**Decision.** Only a move of a known card from one column to another starts a run. The first poll records the cards and creates no events. A new card created straight in In progress starts nothing either.

**Why.** A move is an explicit gesture, while a card's position may just be history. The event id is computed from the transition itself, so a repeated poll after a crash creates no duplicates.

**Trade-off.** A card created straight in progress has to be moved out and back once.

## A refusal is recorded, not queued

**Context.** When WIP limits or the resource guard keep an issue out, it is tempting to queue it for a later start.

**Decision.** Admission creates a run in the `rejected` state with a reason. There is no automatic retry: to retry, you move the card again.

**Why.** Moving a card is an explicit, time-bound wish. A queue would start Codex later, when you may have changed your mind. The reason stays visible, and a retry is a new decision.

**Trade-off.** A rejected issue must be retried by hand.

## The resource guard observes and blocks, but does not repair

**Context.** An unaccounted directory or tmux session on the server may be your unsaved work.

**Decision.** The guard compares disk and tmux with the records in the database. On any discrepancy it blocks admission in all projects, opens a quarantine (it becomes active after 30 minutes) and writes to Discord. It cannot delete or repair.

**Why.** A wrong deletion is irreversible, an extra hour of waiting is not. A discrepancy is treated as an incident for a human to sort out.

**Trade-off.** One forgotten discrepancy stops new runs everywhere until you clear it.

## New workers start only on a fresh board snapshot

**Context.** When GitHub is unavailable, the database remembers the board as of the last successful poll. The issue may already have left In progress.

**Decision.** Creating a working copy and starting Codex require the last poll to have succeeded and to be no older than two minutes. Serving existing runs, CI and cleanup do not depend on freshness.

**Why.** Starting a new Codex on a stale board could begin work you have already cancelled. Stopping current work because GitHub failed would do harm.

**Trade-off.** During a GitHub outage new issues wait, and the card shows "Waiting for GitHub".

## Limits change only while the system is idle

**Context.** WIP, Codex and preview limits affect runs that are already going. Changing a limit mid-work makes behaviour ambiguous.

**Decision.** Settings are immutable revisions with a checksum and an author. A new revision is accepted only when there are no runs, resources, previews, commands or events. Physical limits are not in the panel at all.

**Why.** Every run follows one set of rules from start to finish, and any change can be explained and rolled back.

**Trade-off.** While work is going on the limit cannot be changed; you must wait for a pause.

## Codex runs as an interactive CLI in tmux, not as a headless process

**Context.** You must be able to take a task over mid-flight and continue the same conversation in the Codex app. A scripted process without a terminal cannot offer that.

**Decision.** Kurami starts an ordinary Codex CLI in a tmux session, passes the prompt as a command-line argument and finds the thread id through `codex app-server`. It infers the run's state from terminal text.

**Why.** A thread created by the CLI belongs to the Codex app like any other. A prompt in the argument avoids a race with synthetic typing while the interface starts.

**Trade-off.** State has to be inferred from text on the screen, so the rules are conservative: two observations in a row, a check for a completed turn, no approvals on your behalf.

## Every piece of evidence is pinned to the PR commit SHA

**Context.** The agent keeps pushing. Green CI or a clean review on commit A says nothing about commit B.

**Decision.** The CI snapshot, the AI review, the CI fix, the review fix, the preview and the merge check all store a SHA. A result for another commit does not count.

**Why.** "Green" then always means specific checked code, not the state of a branch at an unknown moment. Buttons disappear or the card shows "Outdated" right after a new commit.

**Trade-off.** More bookkeeping: `head=<sha>` markers in GitHub comments, `verified_head_sha` fields, re-checks before every write.

## A fix runs in a fresh thread, the main one is preserved

**Context.** CI and review fixes must be confined to a narrow task, yet the main conversation must not be lost.

**Decision.** For a technical task Kurami starts a new Codex in the same copy and moves `codex_thread_id` into `previous_codex_thread_id`. After the task the technical thread is archived and the main one restored.

**Why.** The prompt holds only the evidence snapshot, so the task cannot grow. Each attempt's history is separate, and the main thread opens as before.

**Trade-off.** Two identifier fields and a cleanup step; until the cleanup finishes, Take control is unavailable.

## Completion is verified, cancellation is stricter

**Context.** After Done the copy can be deleted if the work is merged. After cancellation the copy may hold the only version of someone's work.

**Decision.** After Done the copy is deleted when HEAD is an ancestor of `origin/main` or a merged PR with the same commit is found. A cancelled run does not become `archived`, and preserved work is deleted only after a two-step confirmation.

**Why.** A deleted branch with unmerged commits cannot be restored, while an error in the other direction costs a minute of waiting.

**Trade-off.** Done without a merge holds the run in `needs_attention` until you merge or cancel, and some cases (commits only local) remain manual.

## Three GitHub identities instead of one token

**Context.** The Codex worker needs write access to its own branch, the reviewer only read access, and GitHub lets only the PR author or a user with write access resolve a review thread.

**Decision.** The worker uses the owner's token from `secrets/github.env`. Reviews and replies are published by the GitHub App `kurami-ai`. The owner's token is used to resolve threads and never reaches Codex.

**Why.** The reviewer gets an environment without secrets: every variable whose name looks like a token, password or key is removed. A leak through the model grants no write access.

**Trade-off.** Two sets of secrets and an extra thread-resolving step with a separate token.

## A successor instead of resuming a thread

**Context.** After a hand-over a human drives the thread: it may contain anything, and Kurami does not know what is going on in it.

**Decision.** "Continue autonomously" starts a new thread. It gets a bounded, secret-stripped snapshot: HEAD, `git status`, the diff, CI and the latest review. The old thread stays as history.

**Why.** Automation does not step into a conversation a human led, and it starts from verifiable facts instead of guesses about its content.

**Trade-off.** The new thread does not remember the previous one's reasoning, only the snapshot.

## A Discord button queues a request; the controller performs the action

**Context.** A press arrives at the Hermes gateway, which can restart, and Discord waits only a few seconds for an answer. Actions on a run — cancel, preview, task handover — are slow and risky.

**Decision.** The plugin checks a closed list of ids and the owner, `run.ts` writes a unique request to `run_control_requests` and immediately rewrites the card to "queued". On the next minute the controller rechecks the conditions and takes the step. The exception is Mark reviewed: one short, audited write.

**Why.** A request survives a restart, a repeated or stale press is harmless, and conditions are checked twice: at the press and at execution.

**Trade-off.** A minute or two passes between the press and the result, and the rules for when a button is available must be kept consistent in three places: `run.ts`, the card and the controller.

## A preview proves only the commit it was built from

**Context.** A preview you looked at an hour ago may no longer show the code that sits in the PR.

**Decision.** A preview is built only from a clean working copy whose `HEAD` equals the SHA in the CI snapshot. The lease stores `verified_head_sha`, and the `preview-required` policy counts only if it equals the current SHA.

**Why.** So a Mark reviewed note cannot be carried to the next commit, and Done does not complete a run without a check of exactly what will be merged.

**Trade-off.** After every new commit the preview must be rebuilt, and Start preview makes sense only once CI can see the PR.

## Six fixed slots instead of dynamic addresses

**Context.** Every preview needs a public address, a tunnel route and a Google OAuth return address, and ports must not collide.

**Decision.** The `preview_slots` table holds six slots with `preview-N` addresses and ports by formula. Partial unique indexes allow one active lease per slot, per run and per Compose project. At most two previews build at once.

**Why.** Addresses and routes are configured once in advance, and double allocation is impossible at the database level, even if processes race.

**Trade-off.** The ceiling of six previews does not depend on free memory, and a slot in `failed` stays occupied until you press Remove preview.

## The route goes on last and off first

**Context.** A public address that leads into a half-built or half-dismantled application shows foreign or broken code.

**Decision.** An address appears only after the lease became `running`. On removal the Caddy route is dropped first, then the stack is stopped, and the slot is freed only after checking that no containers remain. A new Caddy configuration is validated and rolled back on failure.

**Why.** The order removes the window in which a request hits a not-ready application, and it does not hand a known address to leftovers of the previous preview.

**Trade-off.** Any incomplete cleanup leaves the slot occupied in `failed`, and it must be sorted out by hand.

## The AI fills only empty fields and writes nothing itself

**Context.** Priority and estimate are the owner's call, but empty fields get in the way of choosing the next issue.

**Decision.** Once a day Codex, read-only, proposes Priority P1–P3 and Effort XS–XL for empty fields. You accept the batch, and only then the guarded sync writes values into empty fields or fields that still hold Kurami's earlier value. A formula, not the model, picks the issue.

**Why.** A model mistake cannot change the order of work or overwrite your decision, and P0 is impossible in the prompt, the parser and the database.

**Trade-off.** Proposals appear at most once a day per project, and any value you set by hand permanently removes that field from auto-filling.

:::cards
- [Project Orchestrator](@project-orchestrator) — how it all works together
- [Controller](@controller) — the one-minute cycle where these decisions show
- [Principles](@principles) — the system-wide decisions
:::
