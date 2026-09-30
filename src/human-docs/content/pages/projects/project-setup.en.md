---
title: Connecting a project
nav: Connecting a project
summary: How to add a repository and a GitHub Project board to Kurami: the settings entry, the readiness check and the first-run checklist.
section: projects
group: guide
order: 30
next: owner-controls
---

A project joins with one entry in `projects.yaml`, one polling job in Hermes and one line in the poller script's list. Before the first run you check the entry with the readiness command: it only reads and changes nothing.

## What the project entry describes

The entry lives in `$KURAMI_HOME/config/projects.yaml` (the sample is `deploy/config/projects.yaml`). Every part is required except `preview` and `triage`.

| Part | What it sets | Why it matters |
|---|---|---|
| Identity | `owner`, `project_number`, `repository`, `status_field` and the five `statuses` column names | Which board to read and which issues to admit. The board must belong to a user, not an organization |
| Workspace | `canonical_repository`, `worktree_root`, `base_branch`, `branch_prefix` | Where Kurami creates working copies (worktrees). The main clone is only a source; the prefix gives names like `TT-42_…` |
| Discord | the project's `guild_id` and `channel_id` | Where run cards and threads appear |
| CI | `enabled`, `required_checks`, `missing_grace_minutes` | Which checks count for the exact PR commit |
| Triage | `priority_field`, `effort_field` | What Projects Digest ranks and proposes |
| Preview | `adapter` (`compose` or `static`), the `required_label` and adapter parameters | Whether Start preview exists and when a preview delays completion |
| Human control | `human_control_label` | Which label hands a run to you |

## Readiness check

The command reads the entry and prints a list of checks. Each is PASS, WARN or FAIL.

```
npm run readiness -- --project <key>          # configuration only
npm run readiness -- --project <key> --live   # plus GitHub and local paths
```

| Level | Meaning | Exit code |
|---|---|---|
| PASS | The fact is present and consistent | 0 |
| WARN | The project works, but an optional capability or live proof is missing. The warning stays visible | 0 |
| FAIL | The project must not be admitted until the entry is fixed | non-zero |

`--live` additionally checks that the repository and board are readable, the base branch exists, the status field and all five columns exist on the board, the CI check names appear on the base branch, and the local paths and the preview secrets file exist. A check name missing on the base branch gives WARN, not FAIL: some checks exist only in PRs.

## What else you must do

One entry is not enough: the poller knows projects from its own list.

1. In `run-project-poller.sh`, add the project key to the `case` statement. Without it the script exits with code 64.
2. Create a wrapper script `kurami-<project>-poller.sh` (samples are in `integrations/hermes/scripts/`) that calls `run-project-poller.sh <key>`.
3. Add a `no_agent` Hermes job with the schedule `* * * * *` and that script.
4. Put the preview secrets in a file outside Git if the project needs a Compose preview.

No new scheduler is needed: the controller lock is shared by all projects, while each project has its own poll.

## Checklist before the first run

:::steps
- **You** — run the check without `--live`: no FAIL.
- **You** — read every WARN and either fix it or accept it on purpose.
- **You** — run `--live` on the server: again no FAIL.
- **Kurami** — polls the board twice: the first poll records the baseline, the second finds no change. Why: [From board to event](@event-intake). Why: [From board to event](@event-intake).
- **You** — take a disposable issue through admission, working copy, Draft PR, exact-commit checks and Human Review to a cancellation or merge.
- **You** — test the preview if configured, and confirm the card and Digest appear in the intended channels.
- **You** — confirm that no runs, working copies, previews or branches are left after the test.
:::

Shared capacity limits, such as WIP and the Codex count, live elsewhere, in [Settings](@settings). What a connected project does is in [Board statuses](@board-statuses).

:::guarantees
- The readiness check only reads: it has no write mode.
- A project with a FAIL must not be admitted.
- A project is not connected by editing SQLite, copying an old run or reusing another project's branches, channels or preview ids.
- A project is not connected by editing SQLite, copying an old run or reusing another project's branches, channels or preview ids.
- A new project's first poll is a baseline: issues already on the board start nothing.
:::

:::code-map
- `src/orchestrator/projects/project-readiness.ts` — the PASS, WARN and FAIL checks
- `docs/project-readiness.md` — the project readiness contract
- `deploy/config/projects.yaml` — sample project entry
- `run-project-poller.sh` — the project key list and the one-minute cycle
- `integrations/hermes/scripts/kurami-tailortales-poller.sh` — sample wrapper script for Hermes
:::
