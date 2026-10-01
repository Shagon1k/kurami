---
title: Principles
summary: Six decisions that run through all three Kurami products and explain why the system is built the way it is.
section: basics
group: decisions
order: 10
---

Each product has its own decisions, collected on the "Why it is so" pages of [Digest](@digest-decisions), [Projects](@projects-decisions) and [Platform](@platform-decisions). Here are the six cross-cutting principles those decisions follow from. Each is written in one format: what was needed, what was decided, why, and what it costs.

## Code does everything that can be checked; an agent does only what nothing else can

**Context.** A model writes good text and code, but fails unpredictably and does not repeat its results.

**Decision.** A model is called in two places: the Daily editorial draft and Codex's engineering work. Polling sources, checks, states, publishing and notices are ordinary deterministic code.

**Why.** Everything code does can be repeated, tested and explained from a database record. Code checks a model's output before you ever see it.

**Trade-off.** More code than an "agent that does it all", and strict formats the model must follow.

## The owner decides what cannot be undone

**Context.** Merging a PR, deploying an application and deleting someone's work cannot be undone.

**Decision.** Kurami's code has no operation to merge a project PR or deploy its application. Deleting preserved work is possible only after two confirmations in Discord.

**Why.** A limit drawn by the absence of code is more reliable than any permission check: a prompt mistake cannot bypass it.

**Trade-off.** Some work always waits for you: for example, Done without a merge holds the run until you merge the PR or cancel it.

## State in SQLite, processes short-lived

**Context.** One server, the Hermes scheduler already exists, reboots and crashes happen.

**Decision.** No business logic in memory: every job opens the database, takes one step in a transaction and exits. Parallel runs are kept apart by file locks.

**Why.** A crashed process loses nothing, and the next run continues from the recorded state. Any state can be inspected with plain `sqlite3`.

**Trade-off.** Reactions are not instant: up to a minute passes between an event and a step, and a chain of steps takes several minutes.

## Proof, not a checkmark

**Context.** A scheduler's "job succeeded" only means the script exited. "Green CI" may belong to an older commit.

**Decision.** Every process keeps its own proof of result: the notice receipt, the SHA of the checked commit, a backup manifest with checksums, the docs `build.json`.

**Why.** Decisions are made from facts that can be re-checked, not from indirect signs.

**Trade-off.** More fields and checks; sometimes a process honestly waits even though everything "looks" done.

## Observe, do not repair

**Context.** An unknown working copy, a stray tmux session or a broken preview may contain someone's work.

**Decision.** Health monitoring and the resource guard only observe, block new work and report. Only the process that owns a resource, and has proven it can be removed, deletes anything.

**Why.** A wrong automatic "cleanup" costs more than a delay caused by an alert.

**Trade-off.** Some problems need your action even when they look obvious.

## Discord is the control panel and the display, not the source of truth

**Context.** You need one convenient interface, but a message can be deleted and a click repeated.

**Decision.** Cards are built from the database and redrawn when it changes. A button creates a queued request with an idempotency key, and the ordinary cycle carries it out with the same checks as automation.

**Why.** A double click never makes a double action, and a deleted card restores itself.

**Trade-off.** Up to a minute usually passes between a click and the result.
