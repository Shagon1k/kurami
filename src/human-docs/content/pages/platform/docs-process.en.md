---
title: How the docs are updated
nav: Docs updates
summary: Once a week an agent compares the site with the code and proposes edits, and only your click in Discord can publish them.
section: platform
group: guide
order: 90
next: hermes-integration
---

The documentation does not publish itself. Every Monday Kurami prepares a proposal of edits, opens a PR for it and posts a "Docs proposal" card to the `#updates` channel. The site changes only after you click **Publish**. If you press nothing, the site stays as it was and the card waits.

## The documentation week

:::steps
- **Hermes** — on Monday at 06:00 local time starts the audit. The job is scheduled twice in UTC, and a script picks the right hour.
- **The audit** — lists the code changes since the last docs release and creates a draft: a separate working copy and a branch `docs/weekly-<date>-<id>`.
- **The agent** — compares the changes with the code and the pages, edits only the draft, runs the docs tests and writes a short description in Russian and English.
- **The worker** — checks the draft once a minute, keeps only allowed files, commits, opens a PR and posts the card.
- **You** — read the card and the PR and choose a button.
:::

One proposal is active at a time. While the previous one is open, no new draft is created: the audit reports which proposal is in the way.

## The card and its buttons

The "Docs proposal · DD.MM" card holds the English description of the edits, the list of affected pages (new, changed or removed) and a status line. The buttons depend on the state.

| Button | What it does |
|---|---|
| **Publish** | merges the PR into `main`, builds the site and swaps the live release; the card shows the short hash of the build |
| **Discuss** | opens a thread on the card, where you write what to fix |
| **Apply remarks** | replaces Discuss once a thread exists: the agent reads only your messages from the thread, edits the same branch, reruns the checks and updates the card |
| **Reject** | closes the PR and rejects the proposal; the branch stays on GitHub |
| **Retry release** | appears instead of Publish when the PR is already merged but the release failed; repeats only the release |
| **PR #n** | a link to the PR |

The card changes with the state of the proposal:

| State | What it means |
|---|---|
| `drafting` | the audit is still writing the draft |
| `ready` | the PR is open and waits for your decision |
| `revising` | your remarks from the thread are being applied |
| `publishing` | merge and release are running, up to a couple of minutes |
| `published` | the site is updated and the previous release is kept for rollback |
| `rejected`, `empty` | the proposal was rejected or no edits were found |
| `failed` | the checks failed or the release failed; the reason is written on the card |

A click on an outdated card is refused with an explanation and is not replayed later.

## Server checkout after publication

After the Docs release passes its access check, the worker tries to fast-forward the server's `main` checkout to that exact published docs SHA. The owner's Publish approval covers this conditional docs-only synchronization, not an application deployment. The worker takes the same lock as the application release command and checks the checkout again immediately before moving it.

| Check | If it does not pass |
|---|---|
| Correct repository origin, `main` branch, and no tracked or untracked edits | The checkout stays in place; owner work is preserved |
| Current HEAD is an ancestor of the published SHA | An ahead or divergent checkout stays in place |
| Every intervening commit changes only the proposal allowlist | Runtime changes block synchronization, even when a later commit reverts them |
| Application release lock is available | Synchronization is blocked; even an empty or stale lock requires operator inspection |

Missing target objects are fetched by exact SHA without updating tracking branches. A newer remote `main` does not change the target. Already at the published SHA is a successful no-op. This synchronization runs no application build, migration, restart or deployment.

If synchronization is blocked, the docs stay `published` and the card explicitly says **Server checkout sync pending/blocked**. The audit records the target SHA, observed checkout SHAs and reason. Release-drift checks stay unchanged; publishing docs is not proof that application code was deployed. There is no automatic retry of a blocked synchronization; an operator resolves the recorded cause separately.

## What a proposal may change

A proposal edits only the pages readers see: the Markdown files in `src/human-docs/content/pages/`, the changelog ledger `changelog.json`, the copy test `tests/human-docs/verify.ts` and the coverage record `docs/human-docs-coverage-audit.md`. Everything else — the site structure, the build, application code — the worker discards before committing, and at publish time it checks once more that the PR holds nothing else. So the worst a bad edit can do is show up in a page's text, and you see it in the PR before publishing.

The description on the card is display text: it selects neither files nor commands. Details of the checks, the release and the rollback are on [How the docs are built](@docs-system).

:::cards
- [How the docs are built](@docs-system) — page format, diagrams, build and release
- [Automation boundaries](@automation-boundaries) — what Kurami does alone and what only on your button
:::
