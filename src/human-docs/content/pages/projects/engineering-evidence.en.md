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
- What it does: reads the CI of the PR commit, and on an owner request or enabled autopilot starts a CI fix, an independent AI review and a fix of review comments
- Who starts it: the CI observer by itself every minute; other steps by the owner or per-project autopilot
- Where it runs: short controller scripts; the reviewer is a separate tmux session `rv-…`
- State: `run_ci_snapshots`, `run_ci_repair_attempts`, `run_ai_reviews`, `run_review_fix_rounds` in the Run Store
- Limits: 2 CI fix attempts, up to 10 review findings, 10 minutes to wait for a new commit, 30 minutes for CI, 90 minutes per process
- What you see: the CI and AI review fields on the card, the native review by `kurami-ai[bot]` in the PR
:::

```diagram
kind: graph
title: Three kinds of evidence around one commit
desc: The PR provides a commit. The CI observer records that commit's checks in a snapshot. The owner or enabled autopilot requests a read-only review or a fresh Codex fix through the same admission checks. The reviewer publishes a review; the fixer pushes a new commit. The Discord card shows the snapshot and the review.
node owner "Requests" "owner or autopilot" owner at 0,0
node pr "PR commit" "head SHA" external at 1,0
node ci "CI observer" "every minute" at 2,0
node snap "run_ci_snapshots" "row per run" store at 2,1
node review "AI review" "read-only, rv-…" at 1,1
node reviews "run_ai_reviews" "row per review" store at 1,2
node fix "Fix" "fresh Codex task" at 0,1
node card "Discord card" "CI and AI review" external at 2,2
edge pr -> ci "checks"
edge ci -> snap "records"
edge owner -> review "Run review"
edge pr -> review "diff"
edge review -> reviews "result"
edge review -> pr "review" dashed
edge owner -> fix "Fix findings"
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

## Configurable autopilot

Autopilot is off by default and enabled per project in [Settings](@settings). For a parked Human Review task with a PR, it requests one missing step: a first CI repair for failed or missing CI; a review of the current commit after passed CI; or one fix round for critical or important findings. An active repair or review-fix worker blocks another step. Suggestions alone do not start a fix.

Accepted requests are remembered by task, action and head. Refused requests may retry at most four times, at least 15 minutes apart. Acceptance means a request was queued, not that CI passed or a review was published. A separate Take the next task switch uses the guarded board transition only when the project has nothing active or in review. Merge and issue acceptance remain owner decisions.

## Fixing CI

Manual CI repair allows up to two fresh Codex tasks, each started by the owner's **Attempt CI fix** button. The button appears when CI is `failed` or `missing`, the run is in `parked_review`, the thread is known and fewer than two attempts were made. The limit of two bounds the cost and the "fix — red again" loop; after the second red attempt you decide.

The controller checks that the working copy is clean and stands exactly on `source_head_sha`, and refuses otherwise. Before a CI fix, review fix or preview starts, a shared source preflight can fast-forward a stale managed branch to that exact live PR head. This requires a clean, unowned parked run, no active writer/session or preview runtime, the configured repository and branch, and matching live PR and remote heads. Dirty or divergent local work is preserved and refused: there is no reset or rebase. If the source moves during validation, admission stops; an already completed safe fast-forward is retained. Fetch uses the existing protected owner credential, without changing reviewer permissions or persisting credentials in Git configuration.

It then starts a new session with a prompt: here is the SHA, here are the failed checks as untrusted data, read the logs through `gh`, make the smallest fix, commit and push to the same branch. The prompt forbids force-push, rebase, merging and a second PR. When Codex finishes its turn, the controller releases the session and the task waits for CI.

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

An AI review is an independent read-only Codex pass over the diff between the PR base and its commit, published as one native GitHub review. Choose **Run review → General** or **Clarity** in Projects or the Discord card to start it in a calm state, when nobody owns the working copy. You can start it while CI is still running: it writes nothing.

General and Clarity can be queued independently, including while the other profile is running. Each profile permits one queued or running review per task. Both count toward **Concurrent LLM**: if no slot is free, the second review waits in the queue. Fixing findings waits for all running reviews to finish.

The controller checks that the branch has exactly one open PR with the expected base, and that the managed copy is clean. The reviewer fetches the live PR head and exact base into a private detached snapshot; an externally advanced PR or a divergent clean local branch does not require moving the managed copy. Local commits and branch refs are preserved. The snapshot is removed on exit; controller reconciliation cleans snapshots after a disappeared worker. The reviewer App needs repository Contents read access for this fetch. Projects requests still have to match the commit and PR shown when requested. If this commit already has a ready review for the selected profile, a second one for that profile is not started. A separate tmux session `rv-tt-42-3f9a1c-1` performs the review; it has no `GH_TOKEN`: the script obtains a short-lived token of the GitHub App `kurami-ai`, reads the PR and the issue and passes them to Codex as data. The child Codex runs in a `read-only` sandbox without approvals, every variable holding a secret is removed from its environment, and any permission request is declined and counted as an error.

Codex must return JSON: a short summary and up to ten findings with severity (`critical`, `important`, `suggestion`), confidence, file and line. The script rejects the answer if it contains secret-like strings, more than ten findings or an unsafe path. Before publishing it checks the PR, base, commit and the cleanliness of the copy once more. Findings on changed lines go out as inline comments, the rest into the review body. The review is always published as `COMMENT`, without approval or a change request. The card then shows `N Critical · N Important · N Suggestions`.

The review prompt weighs likelihood and impact against actual requirements. Proposed additions need a concrete scenario, impact and the smallest sufficient fix. Low-impact hypotheticals are not blockers, and acceptable limitations are not defects; security, authorization, data integrity and explicit acceptance requirements remain protected.

Simplicity is not a finding quota. A complexity finding needs evidence of a concrete maintenance or correctness cost introduced by the diff and a proportionate simplification. Fewer lines or a preferred style alone do not justify a finding. A review with no findings is valid; the read-only, exact-SHA and JSON contracts stay unchanged.

General checks correctness, security and concrete operational risks. Clarity Review focuses on unnecessary complexity and the cost of understanding, changing or debugging code. Each profile has its own session, reviewed SHA, counts and PR link. Clarity is optional and manual; it does not replace General or become an autopilot or completion requirement.

Clarity receives the full installed `engineering-tools:simplify-code` skill together with its role prompt and the shared read-only output contract. Kurami saves the exact skill text, plugin version and SHA-256 with the review before launching the agent. Missing or invalid skill content stops startup. A later manual plugin update affects future reviews; existing reviews retain their original edition. Automatic skill updates are outside this feature.

The publisher adds **🔎 Kurami · General Review** or **🧩 Kurami · Clarity Review** to the review body and every inline comment. Attribution comes from the selected profile, rather than generated text.

## Fixing review comments

A review fix is a fresh Codex task that edits exactly the discussion threads that were unresolved when you selected **Fix findings → General** or **Clarity**. The button appears if the ready review of the current commit has at least one finding.

The selected profile determines which AI comments enter the fix. General also includes your unresolved threads; Clarity includes only its own AI findings. Summary findings without an inline anchor use the same profile filter.

The controller takes an immutable snapshot: unresolved, non-outdated threads whose first comment was left by `kurami-ai` with the current commit's marker, or by you. Your replies inside a thread become clarifications. There are at most twenty threads. Comments added later go into the next round. Codex gets the snapshot as data and must push a fix, but not reply in the threads and not wait for CI.

After that Kurami runs the round itself. When a new commit with green CI appears, the `kurami-ai` bot replies in each thread "Fixed by Kurami in `<sha>` after CI passed", and the thread is resolved. Your token resolves it: GitHub allows that only to the PR author or a user with write access, and the bot has neither. The token reaches neither Codex nor the reviewer. There are three attempts to resolve the threads.

```diagram
kind: sequence
desc: You select Fix findings. The controller snapshots the unresolved threads and starts Codex. Codex pushes a new commit. After green CI the kurami-ai bot replies in the threads, and the owner's token resolves them.
actor you "You" owner
actor ctl "Controller"
actor codex "Codex"
actor gh "GitHub" external
actor bot "kurami-ai"
msg you -> ctl "Fix findings"
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
- **You** — 10:45 you press **Run review → General**. The controller starts `rv-tt-42-3f9a1c-1` for base `9c1d4e7` and commit `a41f0c2`.
- **Reviewer** — 10:52 publishes the review: 0 Critical · 2 Important · 1 Suggestions, three inline comments marked `head=a41f0c2`.
- **You** — 11:05 you press **Fix findings → General**. Round 1 takes three threads on commit `a41f0c2`.
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
| The PR moved during the review | the review is `superseded`, nothing is published | run the selected review profile again |
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
- The owner or enabled autopilot may request these steps through the same guards; manual CI repair has a two-attempt budget, while autopilot requests one CI repair and one review-fix round per task.
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
- `src/orchestrator/runtime/autopilot.ts` — bounded per-project requests through owner-action guards
- `src/orchestrator/security/prompt-safety.ts` — secret stripping and safe data passing
- `deploy/config/projects.yaml` — the project's required checks
:::


## Operator recovery after an external PF-34 fix

PF-34 / PR #157 is a separate, owner-approved external delivery case. Its completed
CI worker produced no new head; the archived attempt remains `needs_attention`,
with original source `c442192ed8aa4eccc25e06bd90874cc9d1adf7a5` and null result.
The external fix delivered `b46c7eb16912198596b45d075d5e4f9610671387` with six passed
checks. Only the incident-pinned `recover-external-ci-delivery.ts` operator CLI can
restore this run to `parked_review`; green CI alone never clears attention.
Default dry-run checks exact receipt/archive history, restored thread, sole-writer
absence, clean linked copy, local/tracking/live remote and draft PR head, fresh CI
and native GitHub receipts. This case refuses any AI/review-fix lineage.
Explicit apply adds an external-delivery audit, not worker success. No attempt
budget, worker output, preview label or review/preview gate is changed. AI review
and preview acceptance still require their normal owner controls. Replays are
idempotent only while all guards still pass. This implementation is not a live apply.
