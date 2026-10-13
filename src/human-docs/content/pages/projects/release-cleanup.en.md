---
title: Completion, cancellation and cleanup
nav: Completion and cleanup
summary: How Kurami completes a run after Done, how it cancels one, and why it deletes the working copy only when it can prove nothing is lost.
section: projects
group: internals
order: 70
next: preview-internals
---

Cleanup is the step that deletes a run's working copy and local branch only when Kurami can show that nothing valuable is lost.

:::glance
- What it does: stops Codex, removes the preview, checks the merge and deletes the copy and branch; on cancellation it preserves whatever cannot be recovered
- Who starts it: you — by moving the card to Done, Backlog or Deferred, or with the Cancel run button; after that the controller, once a minute
- Where it runs: the completion and cancellation scripts called by the controller
- State: `runs.state` (`stopping` → `archived`, `cancelled` or `needs_attention`), `stop_reason` (`completed` or `cancelled`), `resource_state`
- Outcome: `archived` — the PR is merged, `cancelled` — the run was cancelled; when in doubt `needs_attention` and the work preserved
- Yours to decide: merging the PR and confirming deletion of preserved work
:::

```diagram
kind: sequence
desc: You merge the PR and move the card to Done. The controller learns about it at the poll, sets the run to stopping, closes the Codex session, checks the merge against the main branch and deletes the copy and branch. The run becomes archived.
actor you "You" owner
actor gh "GitHub" external
actor ctl "Controller"
actor codex "Codex"
msg you -> gh "merge the PR"
msg you -> gh "card → Done"
msg gh -> ctl "poll: Done"
self ctl "stopping (completed)"
msg ctl -> codex "Escape, /exit"
self ctl "fetch main, check SHA"
self ctl "delete copy and branch"
note ctl "archived"
```

## Merge accepts the exact task

A verified merge of the tracked managed task PR is sufficient owner acceptance, even with `preview-required` and no Preview lease or review mark. Kurami matches the repository, PR, base branch, managed branch and HEAD, and the exact run, Project item and issue. A merely closed PR, stale identity, newer run, cancellation or active control/Project/PR request cannot accept another task. No Project Done event is required.

The observer uses the native Project/issue boundary to confirm the exact item is Done and the issue is closed as completed, then records `merged_task_accepted` with genuine merge provenance and a Preview waiver. It does not fabricate a lease, runtime verification, review mark or Done event, and does not depend on `Closes #N` or external board automation.

Acceptance and cleanup are separate outcomes. Existing CI checks remain unchanged; cleanup still requires passed exact-head CI, a clean owned canonical worktree, no active owner/worker and no newer run or pending request. A blocker leaves the accepted task Done while resources remain preserved with attention. A fresh merge observation retries guarded cleanup. The normal controller stops Preview routing/runtime and releases the lease before worktree/branch release. Only successful release produces `archived` / `released`; terminal cards cannot show stale Preview required.

## Two intents

Kurami tells two intents apart and records them in `stop_reason`: `completed` — you finished the work, `cancelled` — you discarded it. The distinction matters because deleting after completion is safe when the commits are already in the main branch, while deleting after cancellation can lose someone's work.

| What you do | What Kurami records | How it ends |
|---|---|---|
| Move the card to Done | `stopping`, `stop_reason=completed` | `archived`, once the merge is proven |
| Move it from In progress or Human Review to Backlog or Deferred | `stopping`, `stop_reason=cancelled` | `cancelled`, or `needs_attention` with the work preserved |
| Press **Cancel run** | the same; other pending requests are rejected | the same |

Cancellation outranks the other signals: once it is requested, moving to Done or Human Review does not undo it. Before a verified exact task PR merge, an issue with the `preview-required` label waits at Done until you mark the preview of the current commit as reviewed; only then does the run move to `stopping`. How this looks in Discord is in [Board statuses](@board-statuses), [Previews](@previews) and [Controls in Discord](@owner-controls).

## Stopping

First the controller shuts down whatever is still running. If the run has a Codex tmux session, it presses Escape, types `/exit` and kills the session after five seconds. The terminal tail goes to `logs/session-completions/` or `logs/session-cancellations/`. Then the controller removes the run's preview. The copy must not be touched while a process works in it, so cleanup waits for both steps.

## Completion and merge proof

After Done, Kurami deletes the copy only when it sees the run's commit in the main branch. The reason is simple: a deleted branch with unmerged work cannot be restored.

The cleanup script runs `git fetch --prune origin main` and checks one of two conditions. Either the copy's HEAD is an ancestor of `origin/main` — that is how a regular merge and a fast-forward look. Or `gh pr list --state merged` finds a merged PR of this branch whose `headRefOid` equals the copy's HEAD — that is how squash and rebase look. Only the exactly matching commit counts as proof: a PR with a different commit means nothing.

With proof in hand, the script runs `git worktree remove` without `--force` and `git branch -D`, removes the attempt directory and moves the run to `archived`. Unsaved files block cleanup before any deletion, and `worktree remove` without `--force` is a second guard. Without proof, the script deletes nothing: the run moves to `needs_attention` with reason `completion_waiting_for_merge`, and the card says "Done has no verified merge. Work is preserved; merge the pull request or cancel the run.". The merge check repeats every minute: as soon as you merge the PR, the run completes by itself. If the PR should not be merged, press **Cancel run** — the ordinary cancellation with protected work follows.

## Cancellation and protected cleanup

Cleanup is stricter after cancellation than after completion: a cancelled run does not become `archived`, even if its branch happens to be merged. The script deletes the copy by itself only if it is clean and the branch has not moved past `base_sha`. The run then becomes `cancelled`, and the controller moves the card to Backlog.

If the copy has unsaved files, or commits beyond the base without merge proof, the script refuses. The run goes to `needs_attention` (`worktree_release_blocked`), and the card shows "Cancelled — local work preserved" or, when a PR exists, "Cancelled — published work preserved". Everything stays in place until you decide.

```diagram
kind: graph
title: Can the working copy be deleted
desc: The run is in stopping. For completion the copy must be clean and the merge proven: then the run becomes archived, without proof it waits for the merge in needs_attention, and a dirty copy is preserved. For cancellation a clean copy with no new commits is deleted and the run becomes cancelled, otherwise the work is preserved.
node s "stopping" "stop reason" start at 1,0
node reason "Reason?" "completed or cancelled" decision at 1,1
node dclean "Copy clean?" "completion" decision at 0,2
node merged "Merge proven?" "ancestor of main or PR" decision at 0,3
node arch "archived" "copy and branch deleted" end at 0,4
node wait "Waits for merge" "needs_attention, checked every minute" wait at 1,4
node cclean "Clean, no commits?" "cancellation" decision at 2,2
node canc "cancelled" "and card to Backlog" end at 2,3
node pres "needs_attention" "work preserved" wait at 2,4
edge s -> reason
edge reason -> dclean "Done"
edge reason -> cclean "Cancel"
edge dclean -> merged "yes"
edge dclean -> pres "no" accent
edge merged -> arch "yes"
edge merged -> wait "no"
edge cclean -> canc "yes"
edge cclean -> pres "no" accent
```

## Preserved work and confirming deletion

Only you delete preserved work, in two steps. The button first shows a confirmation, and only the second press starts the deletion. The script re-checks the conditions before it acts, because the state may have changed between the presses.

| Button | What must be true | What is deleted |
|---|---|---|
| **Discard local work** | the run is in `needs_attention` after a cancellation, there is no owner, HEAD equals `base_sha`, there is no remote branch | the copy with its unsaved files (`--force`) and the local branch |
| **Close draft PR & discard** | the copy is clean, local and remote HEAD match, exactly one PR has this commit, and it is a draft | the PR is closed, the remote branch is deleted (`git push --no-verify`), then the copy and local branch |

The remote branch is deleted with `--no-verify` so that the project's `pre-push` hook cannot leave the cleanup half done. If any condition fails (the PR is not a draft, the PR is merged, the commits are only local, the commits do not match), the script returns `preserved` with a list of reasons and deletes nothing. In both cases the run becomes `cancelled` after the deletion.

The last step is the card. When the run is `cancelled` and its resources are released, the controller moves the card to Backlog and records it in the history so it is not repeated.

::::example TT-42: from Done to a deleted copy
The data is invented. Run `r_3f9a1c7e5b2d4a8c6e01`, TailorTales; in this copy Codex has finished and stands at commit `e77b3d0`.
:::steps
- **You** — 11:40 you merge PR #57 on GitHub and move the card to Done.
- **Board poll** — 11:41 records the transition. The run becomes `stopping`, `stop_reason=completed`. The card shows "Stopping".
- **Controller** — 11:41 in the same cycle sees there is no tmux session (`park` closed it) and no preview, and starts cleanup. The copy is clean, `git fetch` brings the new `main`, and `e77b3d0` is an ancestor of `origin/main`.
- **Cleanup script** — deletes `…/TT-42_add-dark-mode-toggle/TailorTales` and the branch `TT-42_add-dark-mode-toggle`, recording `merged_worktree_release_completed`.
- **Kurami** — the run is `archived`, the resource `released`, the card "Completed".
:::
::::

Had you cancelled the issue at 11:00, while PR #57 was not yet merged, the picture would differ. The copy is clean, but the branch is two commits past `base_sha`. The script would refuse to delete and leave the card "Cancelled — published work preserved" with the **Close draft PR & discard** button.

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| You moved the card to Done but the PR is not merged (closed unmerged or abandoned) | the run moves to `needs_attention` (`completion_waiting_for_merge`); work is preserved and the merge is checked every minute | merge the PR and the run completes by itself, or press **Cancel run** |
| The merge could not be checked (a `gh` error, no network) | treats the merge as unproven and waits | wait or check GitHub |
| The copy has unsaved files at completion | cleanup refuses; the run goes to `needs_attention` | save or discard the edits |
| Cancellation: unsaved files or new commits | `needs_attention`, "Cancelled — … preserved" | Discard local work or Close draft PR & discard |
| Commits exist only locally, no PR | no delete button fits: `discard` needs HEAD at `base_sha` | sort it out by hand |
| Deleting the copy broke halfway | resource `partial`, the run goes to `needs_attention` (`worktree_release_failed`) | read the cause |
| The PR is not a draft, is already merged or is ambiguous | `preserved` with a list of reasons, nothing deleted | close or merge the PR yourself |
| After cancelling you merged the PR anyway | cleanup repeats every minute; once the merge is proven the copy is deleted and the run becomes `cancelled` | nothing |

:::guarantees
- Kurami does not archive a run or delete its branch until it has proven the merge of the exact commit.
- Kurami does not delete unsaved files at completion: `git worktree remove` runs without `--force`.
- A cancelled run does not become `archived`.
- Kurami does not delete preserved or published work without your two-step confirmation; only one draft PR with an exactly matching commit is closed.
- The controller does not merge PRs automatically. Projects merges only after your confirmation; it leaves the card's Done transition to GitHub or you.
:::

:::code-map
- `src/orchestrator/projects/worktrees/release.ts` — the merge check and deleting the copy and branch
- `src/orchestrator/projects/worktrees/cancel-resolution.ts` — deleting preserved work, local and published
- `src/orchestrator/projects/project-status.ts` — returning the card to Backlog and moving it to Human Review
- `src/orchestrator/projects/process-project-events.ts` — Done, Backlog and Deferred become `stopping`
- `src/orchestrator/projects/sessions/session-stop.ts` — stopping the Codex session on completion and cancellation
- `src/orchestrator/runtime/automatic-plan.ts` — the order of steps: stop, preview, cleanup, card
- `src/orchestrator/runtime/controller-execution.ts` — the stop request and running the scripts
:::
