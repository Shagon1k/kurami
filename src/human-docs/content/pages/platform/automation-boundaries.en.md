---
title: Where automation stops
nav: Automation limits
summary: For each Kurami process: what it does by itself, what waits for your decision and why the line is drawn there.
section: platform
group: internals
order: 60
next: docs-system
---

Automation in Kurami does not mean "does everything itself"; it means "takes a bounded step and stops where a decision cannot be undone". A schedule or a moved card starts a check, not an arbitrary action; each process keeps its own state and its own confirmations. The text of an issue, a PR, a review and a reply from an external service count as data, not orders.

:::glance
- The rule: it does by itself what can be checked and undone; publishing, merging, deploying and deleting are only yours
- Checks: limits, disk state, the exact commit, allowed paths, tool lists
- Code holds the line, not the model: the model has no "merge PR" operation
- Your decisions: merging a PR, deploying, publishing documentation, deleting preserved work, changing limits
- Where you see the line: the buttons on Discord cards
:::

## How far a trigger goes

```diagram
kind: graph
title: From a trigger to your decision
desc: A trigger starts a check. If the check passes, a bounded step that can be undone is taken. If an irreversible action is needed next, the process stops and waits for the owner.
node trigger "Trigger" "schedule, card" at 0,0
node gate "Check" "limits, state, evidence" at 1,0
node step "Bounded step" "can be undone" at 2,0
node irrev "Irreversible?" decision at 2,1
node owner "You" "decision by button" owner at 2,2
node stop "Refusal and reason" fail at 1,1
node done "Result recorded" end at 0,1
edge trigger -> gate
edge gate -> step "passed"
edge gate -> stop "no" accent
edge step -> done "reversible"
edge step -> irrev
edge irrev -> owner "yes"
```

## What it does itself and what waits for you

| Process | Does by itself | Waits for you | Why the line is here |
|---|---|---|---|
| Project Orchestrator | admission, branch and working copy, Codex start, reading CI, moving to Human Review | merging a PR, deploying the application, deleting preserved or ambiguous work | merging and deploying are irreversible; resource ownership must be proven |
| Codex | writes code in its own working copy, opens a PR; fixes CI and review on a button | everything outside the copy | works only in its own working copy and branch |
| Daily | collects, checks and publishes the edition, notifies | rewriting an accepted edition — an operator, not automation | a frozen edition is the record of the morning |
| Digest, live blocks | refreshes mail, calendar, weather hourly | archiving mail — by a press | writing to mail changes the outside world |
| Health | checks, edits the card, sends an alert | repairing: stopping a preview, removing a resource | a person must confirm the cause of a failure |
| Backup | takes a copy, encrypts, uploads | restoring | overwriting live state is irreversible |
| Maintenance | deletes old logs and unused Docker images | containers, volumes, working copies, previews | a running run may need them |
| Documentation audit | prepares a draft in an isolated copy | publishing: the Publish button | others read the site, changes must be read first |
| Connectors | reads; removes `INBOX` and `UNREAD` by stored identifiers | any other write | the action list is closed and checked |
| Hub | reads and shows | — | has no write at all |

The last column is not a caveat but the logic itself. Each line has one reason: either the action cannot be undone, or Kurami cannot prove the resource is its own. In the second case it preserves and waits: a resource without a confirmed owner is not deleted but blocks the admission of new tasks.

## A line against a failure

Automation does not replace a refusal with a quiet attempt. When a check fails, the process records the reason and stops. The poll does not start a run for a card that was already in In progress at the first read. The health check does not delete a lost preview but reports it. Publishing documentation does not go ahead without a Publish press on a card with the commit that you saw.

::::example A documentation-changes proposal (invented data)
:::steps
- **Schedule** — on Monday at 06:00 local time starts the audit; the script confirms the day and hour.
- **Agent** — edits pages in the draft copy `dp_3fa91c07d2e4` and writes a short description. An edit outside the allowed paths is dropped.
- **Worker** — runs the tests, opens a PR and posts a card with the buttons Publish, Discuss, Reject.
- **You** — read the PR and press Publish.
- **Worker** — merges the PR only with the commit that is on the card, builds the release and checks the site; on a failure it puts the previous release back.
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| A check fails | records the reason, stops | fix the reason; a repeated run starts afresh |
| The reason is unclear (a resource with no owner) | blocks admission and reports | check and decide by hand |
| The card is outdated | rejects the press: "This card is outdated" | refresh the card |
| A step fails midway | the next cycle continues from the saved state | look at the log if it did not continue |

:::guarantees
- Kurami does not merge PRs and does not deploy application code.
- Kurami does not delete work whose ownership is not proven and does not break resources for the sake of cleanup.
- Kurami does not publish documentation changes without your press on the exact commit.
- Kurami does not use broad write access to Gmail: only removing `INBOX` and `UNREAD` is allowed.
- The text of issues, PRs, reviews and external replies cannot change the limits.
:::

:::code-map
- `README.md` — the safety boundaries of the whole system
- `docs/technical-reference.md` — safety contracts per subsystem
- `src/orchestrator/resources/guard.ts` — disk, working copies, quarantine
- `src/orchestrator/projects/` — admission, release, cleanup
- `src/human-docs/approval/policy.ts` — allowed paths and proposal transitions
- `src/system/maintenance/monthly-maintenance.ts` — what maintenance does not touch
:::
