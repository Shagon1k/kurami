# Kurami project readiness contract

This is the smallest contract a repository and GitHub Project must satisfy
before Kurami can manage engineering runs for it. It describes compatibility,
not permission to mutate the project.

Start with the visual guide in `docs/guide.html`. Run the read-only checker with:

```bash
npm run readiness -- --project <registry-key>
npm run readiness -- --project <registry-key> --live
```

The first command validates tracked configuration only. `--live` additionally
reads GitHub and the configured local workspace. Neither mode has an apply or
mutation path. JSON output is available with `--json`.

## Result levels

- **PASS** — the required fact is present and internally consistent.
- **WARN** — the project can still be compatible, but an optional capability or
  live proof is absent. The owner must understand the limitation.
- **FAIL** — Kurami must not admit the project until the contract is corrected.

The process exits non-zero only when at least one `FAIL` exists. A warning never
silently becomes a pass; it remains visible in human and JSON output.

## 1. Identity and GitHub Project

Each entry in `deploy/config/projects.yaml` needs:

- a stable lowercase registry key;
- the GitHub user or organization in `owner`;
- the numeric Project v2 number in `project_number`;
- the exact `owner/repository` name;
- the exact single-select `status_field` name;
- distinct configured values for `backlog`, `active`, `review`, `done`, and
  `deferred`;
- optionally an `icon` for Projects navigation (`panda`, `fox`, `profile`,
  `book`, `news`, `cinema`, `chart`; anything else shows the generic project
  icon);
- optionally a `color` for its tasks in Projects (`blue`, `teal`, `green`,
  `violet`, `pink`, `gold`; without it, or with another value, the colour
  follows the registry order).

The registry is the only list of projects: Hub and Projects show them in
registry order under the repository's name, and `run-project-poller.sh` accepts
exactly the registered keys (`src/core/projects-registry.ts`). A new project
still needs its own Hermes cron job calling the poller with its key.

Live readiness additionally proves that the repository and Project are readable,
the configured base branch exists, and the Project exposes the configured status
field/options. Readiness never creates fields, options, items, or labels.

## 2. Admission-ready issues

Kurami admits only an open Issue from the configured repository after a real
Project transition into the configured active status. The issue needs a non-empty
description. Existing items seen during the initial poll become a baseline and
do not start retroactively.

The `human-control` label is optional per issue. It changes the initial ownership
mode; it does not bypass admission, WIP, exact-resource, CI, or cleanup guards.

## 3. Git workspace

The project entry needs:

- an absolute `canonical_repository` path;
- a separate absolute `worktree_root` path;
- the exact `base_branch`;
- a short safe `branch_prefix`.

The canonical checkout is a reference and integration checkout, never an agent
workspace. Every admitted run gets its own managed branch/worktree. A live check
warns when the configured paths are unavailable on the current host; production
admission remains fail-closed.

## 4. Discord surface

Each project needs an allowlisted Discord `guild_id` and project `channel_id`.
Global `discord.digest_channel_id` in `deploy/config/orchestrator.yaml` is also
required. The digest channel is a permanent text channel in the shared Projects
category; Kurami owns one changed-only card per project and does not create a
thread, move the channel, or delete it.

The narrow Discord plugin accepts only allowlisted Kurami component IDs and the
configured owner. Telegram remains an inbound/text fallback and is not the
primary proactive surface.

## 5. CI policy

When `ci.enabled: true`:

- `required_checks` must contain unique, non-empty, exact GitHub check names;
- `missing_grace_minutes` must be a positive bounded integer;
- the observer evaluates only the managed PR's exact head SHA.

Live readiness compares configured names with check runs observed on the base
branch. A missing name is a `WARN`, not an automatic config rewrite, because
some checks may be PR-only. Before production admission, the owner must still
confirm the names against a representative PR.

When `ci.enabled: false`, no check names are required. Kurami still discovers
exactly one managed PR and stores its exact head SHA before preview or completion
evidence can advance.

## 6. Triage metadata

When `triage.enabled: true`, configure exact `priority_field` and `effort_field`
names. Kurami may propose values, but it writes only an accepted batch and only
to a blank or previously Kurami-owned field after a fresh live drift check.
Dependencies and due dates are not inferred.

## 7. Preview capability

Preview is optional for project compatibility. Without a `preview` block the
checker reports a warning and the owner will not receive `Start preview`.

For `adapter: compose`, configure:

- optional `required_label` when preview must gate completion;
- repository-relative `compose_file`;
- absolute `secrets_file` outside Git;
- allowlisted owner email and `/`-prefixed frontend/backend/MinIO health paths.

For `adapter: static`, configure:

- safe repository-relative `artifact_directory`;
- positive `max_files` and `max_bytes` limits.

The shared static ingress serves existing files directly and falls back to the
artifact root `index.html` for client-routed SPA paths; the repository does not
need a preview-only web server or Compose stack.

Both adapters publish only a clean worktree whose HEAD equals the observed PR
head. Missing provenance, dirty files, mismatched SHA, symlinks/path escapes, or
failed health checks stop publication before ingress becomes available.

## 8. Shared operational capacity

Project WIP values share the Global WIP pool; they are caps, not reservations.
Runtime settings may be changed only while the entire orchestrator is idle.
Physical limits, disk thresholds, channels, repository identity, and secret paths
remain deploy configuration rather than Discord settings.

Adding a project must not require a new scheduler architecture. Give it one
project poll job using the existing wrapper and keep the global controller/event
consumer lock shared with every other project.

## Onboarding exit checklist

1. Config-only checker has zero failures.
2. Owner reviews every warning and either resolves or explicitly accepts it.
3. Live checker has zero failures on the VPS.
4. A read-only Project poll succeeds twice; the second observation is a no-op.
5. One disposable issue exercises admission → isolated worktree → Draft PR →
   exact-SHA evidence → Human Review → guarded cancellation or authorized merge.
6. Preview is exercised only if configured, using its selected adapter.
7. Discord card/digest appears in the intended existing channels.
8. Cleanup proves zero test run/resource/preview/worktree/branch residue.
9. `npm test` and runtime health remain green.

Do not onboard a project by editing production SQLite, copying an old run, or
reusing another project's branch, worktree, Discord, preview, or scheduler IDs.
