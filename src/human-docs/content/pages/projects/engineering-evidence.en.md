---
title: CI and AI review
nav: CI and AI review
summary: How Kurami checks the exact commit of a PR, fixes red CI and review comments, and why every check loses its force after a new commit.
section: projects
group: internals
order: 60
next: release-cleanup
---

Evidence in Kurami is the result of a check of one specific PR commit: CI, an AI review or a fix. Each one stores that commit's SHA and stops counting when the commit changes.

:::glance
- What it does: reads the CI of the PR commit, and on your button starts a CI fix, an independent AI review and a fix of review comments
- Who starts it: the CI observer by itself every minute; everything else you, with a button
- Where it runs: short controller scripts; the reviewer is a separate tmux session `rv-…`
- State: `run_ci_snapshots`, `run_ci_repair_attempts`, `run_ai_reviews`, `run_review_fix_rounds` in the Run Store
- Limits: 2 CI fix attempts, up to 10 review findings, 10 minutes to wait for a new commit, 30 minutes for CI, 90 minutes per process
- What you see: the CI and AI review fields on the card, the native review by `kurami-ai[bot]` in the PR
:::

```diagram
kind: graph
title: Three kinds of evidence around one commit
desc: The PR provides a commit. The CI observer records that commit's checks in a snapshot. On a button, a read-only reviewer starts and publishes a review in the PR. On another button, a fresh Codex task fixes the comments and pushes a new commit. The Discord card shows the snapshot and the review.
node owner "You" "two buttons" owner at 0,0
node pr "PR commit" "head SHA" external at 1,0
node ci "CI observer" "every minute" at 2,0
node snap "run_ci_snapshots" "row per run" store at 2,1
node review "AI review" "read-only, rv-…" at 1,1
node reviews "run_ai_reviews" "row per review" store at 1,2
node fix "Fix" "fresh Codex task" at 0,1
node card "Discord card" "CI and AI review" external at 2,2
edge pr -> ci "checks"
edge ci -> snap "records"
edge owner -> review "AI Code Review"
edge pr -> review "diff"
edge review -> reviews "result"
edge review -> pr "review" dashed
edge owner -> fix "Fix Review"
edge fix -> pr "new commit"
edge snap -> card
edge reviews -> card
```

## Pinned to a commit

Kurami pins every piece of evidence to a SHA because the agent keeps pushing: green CI on commit A says nothing about commit B. So each kind of check has its own SHA field and its own way of dropping a stale result.

| Evidence | Where the SHA is stored | What invalidates it |
|---|---|---|
| CI snapshot | `run_ci_snapshots.head_sha`: checks are read on exactly this commit | any new push replaces the snapshot |
| CI fix | `source_head_sha`: the working copy must stand on it | only a new commit with green CI counts as success |
| AI review | `base_sha` and `head_sha`, hidden `head=<sha>` markers in the review and each comment | the commit moved — the card shows "Outdated"; it moved during the review — "Superseded", nothing is published |
| Review fix | the snapshot's `source_head_sha`; the result's `result_head_sha` | threads marked with another commit are not taken |
| Preview | the preview lease's `verified_head_sha` | the CI observer clears the mark when the preview has another SHA |
| Completion | the merged PR's commit equals the copy's HEAD | — |

The buttons that start these checks are described in [Controls in Discord](@owner-controls). How merge proof works at completion is in [Completion and cleanup](@release-cleanup), and preview proof is in [How previews work](@preview-internals).

## Watching CI

In Projects, open a task's details and expand **Checks** under CI. The entire Checks row is clickable. Each check occupies one line: a result icon and a name linking to its GitHub job when available. Long names truncate; the full name and result remain in the tooltip and accessible text. Failed or missing checks open the list automatically. The task table keeps only the overall CI status.

The list comes from the CI observer's saved snapshot, with its commit and observation time. Dashboard refreshes preserve your expanded or collapsed choice for that commit. A missing check has no fabricated link; unavailable details do not mean CI passed.

Once a minute the CI observer finds the single open PR for the run's branch and reads its checks on the commit. That way CI is judged independently of Codex and Discord: the observer only reads GitHub and writes a row to `run_ci_snapshots`.

It calls the GitHub REST API, takes the check-runs and commit statuses, and counts only the *required* checks from `projects.yaml` — exact names, for example `Secret scan` and `Lint, type-check, test` for TailorTales. For each name the newest record wins. The result is combined by priority: `failed`, then `unknown`, `pending`, `missing`, and only then `passed`.

| Result | Meaning |
|---|---|
| `passed` | all required checks are green on this commit |
| `failed` | at least one failed, was cancelled, timed out or needs action |
| `pending` | checks are running; absent ones also count as `pending` for the first 10 minutes (`missing_grace_minutes`) |
| `missing` | a required check has been absent for 10 minutes |
| `unknown` | several open PRs on the branch, a GitHub error or an unknown status |

There is one snapshot row per run and it is overwritten. A content digest lets the card notice a change, and `first_observed_at` resets with a new commit so the 10-minute grace starts again.

## Fixing CI

A CI fix is up to two fresh Codex tasks, each started by your **Attempt CI fix** button. The button appears when CI is `failed` or `missing`, the run is in `parked_review`, the thread is known and fewer than two attempts were made. The limit of two bounds the cost and the "fix — red again" loop; after the second red attempt you decide.

The controller checks that the working copy is clean and stands exactly on `source_head_sha`, and refuses otherwise. It then starts a new session with a prompt: here is the SHA, here are the failed checks as untrusted data, read the logs through `gh`, make the smallest fix, commit and push to the same branch. The prompt forbids force-push, rebase, merging and a second PR. When Codex finishes its turn, the controller releases the session and the task waits for CI.

```diagram
kind: graph
title: A CI fix attempt
desc: An attempt starts in running and moves to waiting_ci after Codex exits. A new commit with green CI ends it as a success. Red CI on the first attempt ends it as failed; on the second attempt, or after 10 minutes without a commit or 30 minutes without a result, the run goes to needs_attention.
node running "running" "Codex is fixing" start at 0,0
node waiting "waiting_ci" "waiting for a new SHA" state at 1,0
node ok "succeeded" "new SHA, CI green" end at 2,0
node failed "failed" "red, attempt 1" fail at 1,1
node attn "needs_attention" "waits for you" wait at 2,1
edge running -> waiting "Codex exited"
edge waiting -> ok
edge waiting -> failed "CI red" accent
edge waiting -> attn "attempt 2, 10 or 30 min" accent
```

The time limits are: no new commit 10 minutes after the worker parks — `needs_attention` (`ci_repair_no_new_head`); a commit exists but CI has not settled in 30 minutes — `ci_repair_ci_timeout`. While an attempt runs, Take control is unavailable. When it is done, the controller archives the technical thread and restores the main one.

A failed security-audit check can authorize a minimal compatible published upstream dependency fix or a targeted transitive override. Codex must verify the advisory, published version, consumer compatibility and relevant tests. Unrelated upgrades, major versions, custom patches or forks, advisory exceptions, weaker audit policy, migrations, security-boundary changes, secrets and permissions remain outside the repair scope. Without a compatible published fix, Codex stops and reports the blocker.

For a protocol worker, run-control status, Discord and Projects retain the bounded final report separately from the delivery outcome. A completed read-only refusal can therefore explain why no new PR head appeared; it is not a worker crash. The report is at most 800 characters, sanitized, and bound to the exact task, attempt, thread and turn. Only final assistant output is accepted. Tool stdout, errors, prompts and the restored main conversation are excluded. A missing report stays explicitly unavailable; a crash keeps its protocol failure code. The report changes neither ownership nor retry eligibility.

## AI review

An AI review is an independent read-only Codex pass over the diff between the PR base and its commit, published as one native GitHub review. You start it with the **AI Code Review** button in a calm state, when nobody owns the working copy. You can start it while CI is still running: it writes nothing.

The controller checks that the branch has exactly one open PR with the expected base, and that the copy's HEAD equals the PR commit. If this commit already has a ready review, a second one is not started. A separate tmux session `rv-tt-42-3f9a1c-1` performs the review; it has no `GH_TOKEN`: the script obtains a short-lived token of the GitHub App `kurami-ai`, reads the PR and the issue and passes them to Codex as data. The child Codex runs in a `read-only` sandbox without approvals, every variable holding a secret is removed from its environment, and any permission request is declined and counted as an error.

Codex must return JSON: a short summary and up to ten findings with severity (`critical`, `important`, `suggestion`), confidence, file and line. The script rejects the answer if it contains secret-like strings, more than ten findings or an unsafe path. Before publishing it checks the PR, base, commit and the cleanliness of the copy once more. Findings on changed lines go out as inline comments, the rest into the review body. The review is always published as `COMMENT`, without approval or a change request. The card then shows `N Critical · N Important · N Suggestions`.

## Fixing review comments

A review fix is a fresh Codex task that edits exactly the discussion threads that were unresolved when you pressed **Fix Review**. The button appears if the ready review of the current commit has at least one finding.

The controller takes an immutable snapshot: unresolved, non-outdated threads whose first comment was left by `kurami-ai` with the current commit's marker, or by you. Your replies inside a thread become clarifications. There are at most twenty threads. Comments added later go into the next round. Codex gets the snapshot as data and must push a fix, but not reply in the threads and not wait for CI.

After that Kurami runs the round itself. When a new commit with green CI appears, the `kurami-ai` bot replies in each thread "Fixed by Kurami in `<sha>` after CI passed", and the thread is resolved. Your token resolves it: GitHub allows that only to the PR author or a user with write access, and the bot has neither. The token reaches neither Codex nor the reviewer. There are three attempts to resolve the threads.

```diagram
kind: sequence
desc: You press Fix Review. The controller snapshots the unresolved threads and starts Codex. Codex pushes a new commit. After green CI the kurami-ai bot replies in the threads, and the owner's token resolves them.
actor you "You" owner
actor ctl "Controller"
actor codex "Codex"
actor gh "GitHub" external
actor bot "kurami-ai"
msg you -> ctl "Fix Review"
msg ctl -> gh "thread snapshot"
msg ctl -> codex "fix N comments"
msg codex -> gh "push new SHA"
phase "CI green"
msg ctl -> bot "replies in threads"
msg bot -> gh "Fixed by Kurami"
msg ctl -> gh "resolve threads" dashed
```

::::example TT-42: from CI to resolved comments
The data is invented. PR #57 of run `r_3f9a1c7e5b2d4a8c6e01`, TailorTales.
:::steps
- **CI observer** — 10:32 finds PR #57 at commit `a41f0c2`. The required checks are not there yet: result `pending`. At 10:36 both are green, result `passed`.
- **You** — 10:45 you press **AI Code Review**. The controller starts `rv-tt-42-3f9a1c-1` for base `9c1d4e7` and commit `a41f0c2`.
- **Reviewer** — 10:52 publishes the review: 0 Critical · 2 Important · 1 Suggestions, three inline comments marked `head=a41f0c2`.
- **You** — 11:05 you press **Fix Review**. Round 1 takes three threads on commit `a41f0c2`.
- **Codex** — 11:22 pushes `e77b3d0` and ends its turn. The round waits for CI.
- **CI observer** — 11:29 sees `passed` on `e77b3d0`. The round moves to `resolving`: the bot replies in three threads, your token resolves them.
- **Kurami** — AI review on the card now reads "Outdated": the review was for `a41f0c2`, and the PR stands at `e77b3d0`. You start a new review.
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| A required check did not appear | after 10 minutes the result is `missing`, Attempt CI fix is available | fix the workflow or try Attempt CI fix |
| Several PRs are open on the branch, or GitHub did not answer | result `unknown`, the reason is in the snapshot; a fix is unavailable | close the extra PRs, wait |
| No new commit 10 minutes after a CI fix | the attempt and the run go to `needs_attention` | take control |
| The second attempt is red too | the run goes to `needs_attention` (`ci_repair_attempt_budget_exhausted`) | fix it by hand |
| The PR moved during the review | the review is `superseded`, nothing is published | run AI Code Review again |
| The review process disappeared | after 15 seconds the review is `failed` | run it again |
| The reviewer's answer looks like a secret or is invalid | the review is `failed`, nothing is published | run it again |
| Codex left unsaved edits without advancing the commit | the round and the run go to `needs_attention`, work is preserved | take the work over by hand |
| Codex pushed but the terminal stayed dirty | the **Recover delivered fix** button, if commit, CI and session match | press it |
| The push arrived after the 10-minute wait | the round comes back by itself, the run is `parked_review` again | nothing |
| Resolving the threads failed three times | the round and the run go to `needs_attention` | fix the permissions; an operator retries only the resolving |
| A process runs longer than 90 minutes | stopped, the run goes to `needs_attention`, everything preserved | read the terminal tail |

:::guarantees
- Kurami counts as evidence only a result for the PR's current commit.
- The CI observer only reads GitHub: it changes no PR, branch or check.
- A CI fix, an AI review and Fix Review start only on your button; there are no automatic retries, and CI fixes are limited to two attempts.
- The reviewer works without write access and without secrets, every permission request is declined, and it publishes only `COMMENT`, never an approval.
- The Codex fixer does not reply in threads or resolve them; Kurami does that after green CI, and only for the snapshot's threads.
:::

:::code-map
- `src/orchestrator/projects/ci/observe.ts` — the CI snapshot and the result over required checks
- `src/orchestrator/runtime/reconcile-ci-repair.ts` — CI fix attempt states and timeouts
- `src/orchestrator/projects/reviews/manager.ts` — starting a review and the checks before it
- `src/orchestrator/projects/reviews/worker.ts` — the reviewer, answer validation, publishing to GitHub
- `src/orchestrator/integrations/codex/app-server.ts` — the read-only Codex run for reviews
- `src/orchestrator/integrations/github/review-threads.ts` — thread selection, reply and resolve
- `src/orchestrator/projects/reviews/fix-manager.ts` — replies and resolving threads after CI
- `src/orchestrator/runtime/reconcile-review-fix.ts` — review fix round states
- `src/orchestrator/security/prompt-safety.ts` — secret stripping and safe data passing
- `deploy/config/projects.yaml` — the project's required checks
:::
