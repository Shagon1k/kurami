# Kurami Dev Orchestrator

Kurami Dev Orchestrator turns explicit GitHub Project status changes into safe,
durable engineering runs. Hermes provides scheduling and conversation gateways;
deterministic TypeScript components own polling, admission, resource mapping,
and recovery; Codex performs engineering work only after those gates pass.

This README is the local developer and AI entry point. The full architecture and
rollout decisions live in `hermes-dev-orchestrator-plan.md` outside this app.

## Mental model

```text
GitHub Project status change
  -> Project Poller detects the transition
  -> SQLite stores the event durably
  -> Event Consumer validates and admits/cancels the run
  -> Worktree Provisioner creates isolated Git resources when explicitly applied
  -> Session Manager starts and tracks the dedicated Codex session
  -> Hermes routes conversation and human control through Discord or Telegram
```

SQLite is the operational memory between processes and restarts. It prevents a
repeated poll, concurrent job, or VPS restart from creating duplicate runs and
records exactly which resources belong to each issue.

## Repository layout

```text
app/
  migrations/                 Versioned SQLite schema migrations
  src/
    init-run-store.ts         Applies migrations and checks DB integrity
    poll-projects.ts          Reads one or both GitHub Projects
    triage-snapshot.ts        Persists changed-only Backlog fact snapshots
    triage-rank.ts            Ranks every eligible issue with explainable policy
    notify-discord-digest.ts  Reconciles persistent per-project digest cards
    metadata-proposal-manager.ts
                              Plans durable changed-only metadata batches
    metadata-proposal-worker.ts
                              Runs bounded read-only Priority/Effort assessment
    metadata-sync.ts          Applies accepted metadata with field-level drift guards
    observe-ci.ts             Reads exact-PR CI state without GitHub mutations
    review-manager.ts         Validates and starts explicit exact-SHA AI reviews
    ai-review-worker.ts       Publishes one bounded native GitHub PR review
    process-project-events.ts Runs admission and cancellation state transitions
    controller.ts             Dispatches only handlers eligible for current states
    codex-app-server.ts       Minimal stdio client for durable Codex thread metadata
    observe-sessions.ts       Deduplicates persistent CLI attention conditions
    provision-worktree.ts     Plans or explicitly provisions Git worktrees
    release-worktree.ts       Safely releases cancelled or verified-merged Git resources
    cancel-resolution.ts      Guardedly resolves confirmed unpublished or Draft PR results
    project-status.ts         Returns fully cancelled released items to Backlog
    preview-manager.ts        Leases, acknowledges, extends, and releases preview slots
    preview-runtime.ts        Dispatches each durable lease to its selected adapter
    preview-compose-runtime.ts
                              Builds and removes rootless Compose previews
    preview-static-runtime.ts Publishes immutable static artifact snapshots
    preview-ingress.ts        Atomically reconciles running previews into Caddy routes
    codex-deeplink.ts         Validates Codex thread IDs and builds HTTPS launch URLs
    session-manager.ts        Starts, parks, hands off, and finalizes Codex TUI sessions
    run-controls.ts           Inspects runs and queues allowlisted owner actions
    notify-controls.ts        Frozen opt-in proactive Telegram fallback
    notify-discord-controls.ts
                              Reconciles Discord ticket threads and live cards
    backup-state.ts           Creates verified SQLite/config snapshots with retention
    runtime-health.ts         Read-only DB/Docker/preview consistency inspection
    monthly-maintenance.ts    Bounded old-log and unused Docker cache/image cleanup
  tests/
    verify-dry-run-admission.ts
                              Isolated WIP/idempotency/policy regression test
    verify-completed-release.ts
                              Proves unmerged work is retained and merged work is released
    verify-cancel-resolution.ts
                              Proves local discard, preservation, and exact Draft PR cleanup
    verify-project-status.ts  Proves guarded idempotent Backlog synchronization
    verify-ci-observer.ts     Proves exact-SHA CI normalization and bounded notifications
    verify-preview-slots.ts   Proves six-slot capacity, idempotency, and safe reuse
    verify-preview-ingress.ts Proves deterministic, loopback-only, fail-closed routing
    verify-preview-ttl.ts     Proves expiry, warning, extension, and guarded cleanup planning
    verify-preview-reviewed.ts
                              Proves exact-lease owner acknowledgement without lifecycle effects
    verify-preview-policy.ts  Proves opt-in exact-SHA preview evidence before completion
    verify-run-controls.ts    Proves event idempotency and explicit control dispatch
    verify-session-observer.ts
                              Proves idle blocker detection without transient false alerts
    verify-discord-controls.ts
                              Exercises card/thread reconciliation against a fake Discord API
    verify-discord-plugin.py  Checks the strict component-ID allowlist without Discord access
    verify-state-backup.ts    Proves consistency, retention, and secret exclusion
    verify-runtime-health.ts  Proves forgotten-preview detection without deletion
    verify-monthly-maintenance.ts
                              Proves exact log cleanup selection and exclusions
  run-project-poller.sh       Production poll -> consume wrapper
  run-projects-digest.sh      Collect -> rank -> publish Projects Digest pipeline
  bin/launch-codex-session.sh Secret-aware child launcher used only inside managed tmux
  bin/launch-ai-review.sh     Secret-aware launcher for detached read-only reviewers
  package.json
  tsconfig.json

../config/
  projects.yaml               Project, repository, status, and workspace registry
  orchestrator.yaml           Execution mode, digest channel, and hard limits

../state/orchestrator.db      SQLite Run Store (WAL mode)
../logs/                      Poller/consumer audit and error logs
../secrets/github.env         Runtime GitHub credential; never print or commit it
../secrets/github-reviewer-app.env
                              Reviewer GitHub App IDs and private-key path
../secrets/kurami-ai.private-key.pem
                              Mode-600 GitHub App private key; never back up

$HERMES_HOME/plugins/kurami-discord-controls/
  plugin.yaml                 Uniquely keyed extension of the bundled Discord platform
  __init__.py                 Extends the existing Hermes Discord adapter
  control_handler.py          Owner-authorized, bounded native-button callback handler
```

## Components and ownership

### Project Poller

`src/poll-projects.ts` reads GitHub Projects through `gh api graphql`. It stores
the latest item snapshot and creates an event only for a real status transition.
The initial observation is a baseline and never starts existing active items.

Each poll also records its latest success or failure in SQLite. A failed or
older-than-two-minutes Project snapshot blocks only new primary worktree/Codex
writers. Existing run reconciliation, CI observation, cleanup, and Discord card
updates continue; an affected pre-start card shows `Waiting for GitHub` until a
fresh successful snapshot restores the normal flow.

Events include only admission metadata: issue identity, status, title, URL,
open/closed state, labels, and whether a non-empty description exists. The full
issue body is not duplicated in SQLite.

### Event Consumer

`src/process-project-events.ts` processes pending events in chronological order
inside a SQLite write transaction. It owns:

- open-Issue and repository allowlisting;
- minimal readiness validation;
- `human-control` label -> `human_control` interaction policy;
- global and per-project WIP limits;
- idempotent run creation and previous-run linkage;
- planned branch/worktree identities;
- cancellation when an active item returns to `Backlog` or `Deferred`.

It does not invoke Git, tmux, Codex, or GitHub mutations.

### CI observer

`src/observe-ci.ts` maps each active managed branch to exactly one pull request,
reads check-runs and legacy commit statuses for that PR's exact head SHA, and
stores a normalized snapshot. GitHub API errors become `unknown`; missing
required checks become `missing` only after the configured grace period. The
observer never changes a pull request, branch, check, lifecycle state, or code.

Per-project CI policy is versioned in `deploy/config/projects.yaml`. The deployed
copy is `${ORCHESTRATOR_HOME}/config/projects.yaml`; both copies must be kept in
sync by the normal deployment/reconciliation flow. `ci.enabled: false` disables
observation for a project. When enabled, `required_checks` contains exact GitHub
check names and `missing_grace_minutes` controls only the initial missing-check
grace period. The future project-readiness checker should compare this policy
with the repository's actual workflows and checks.

### Bounded CI repair

Failed or missing required CI in a stable owner-free review state exposes an
owner-only `Attempt CI fix` control. Each click creates a fresh Codex task in
the existing managed worktree, pins it to the observed PR head SHA, and requires
the task to read failing logs before making the smallest safe same-branch fix.
The task may commit and push normally, but may not force-push, rebase, merge,
create another PR, or retry itself.

Attempts are durable in `run_ci_repair_attempts`. The controller waits for the
observer to report a new exact head SHA: passed CI completes the repair; the
first failed result permits one more explicit owner attempt; the second failure
ends at `needs_attention`. No new head within ten minutes, CI that remains
pending or unknown for thirty minutes, and dependency, schema, security,
permission, ownership, or infrastructure ambiguity also fail closed at
`needs_attention`. There is no automatic retry loop. When the fresh repair task
finishes, the controller archives that technical Codex task through the
official App Server protocol, restores the original primary task as the run's
Codex context, and retains the repair thread ID only in attempt history.
Terminal `stopping`, `archived`, and `cancelled` runs remain cleanup-eligible,
so a fast merge cannot strand the technical task as the run's primary context.
During the gap between push and the first observed new-SHA check, Discord reports
`Waiting for checks` and labels the old failed snapshot as the previous failure.
Takeover controls stay unavailable throughout the active repair lifecycle.

### PR-native AI code review

In a stable owner-free review state, `AI Code Review` explicitly starts one
fresh read-only Codex reviewer for the pull request's exact base and head SHAs.
It may run while GitHub CI is pending because neither process writes code. The
global LLM limit still applies, and a review cannot start while a CI repair or
another code writer owns the worktree.

The reviewer checks correctness, regressions, security and privacy boundaries,
concurrency and durability, failure handling, tests, and material
maintainability issues. Its response is a strict bounded JSON contract with at
most ten actionable findings classified as `Critical`, `Important`, or
`Suggestion`. The worker validates every finding before publishing one native
GitHub Review with batched inline comments and an aggregate summary. GitHub PR
review threads are the source of truth; Discord contains only status, counts,
and links.

The credential-owning worker fetches the private pull request and project issue
metadata before starting Codex and embeds their bounded title/body context as
source data in the review prompt. The detached reviewer receives no GitHub
credentials and has a zero-approval contract: it must use only read-only local
repository evidence and must not call GitHub, the network, connected tools, or
request escalation. App Server approval requests are explicitly declined and
fail the attempt immediately instead of waiting for the general review timeout.

Before publication, the worker proves that the managed worktree is still clean,
the local and remote heads still match the requested SHA, and the pull request
is still open at that SHA. A mismatch publishes nothing and marks the attempt
superseded. If a later commit changes the PR after a completed review, Discord
shows that result as `Outdated` and makes a new explicit review available. The
technical reviewer and its parent review task are archived after completion;
the primary development task remains unchanged. GitHub credentials remain in
the deterministic publisher process and are removed from the Codex reviewer
environment.

### Owner-controlled review fixes

`Fix Review` captures one immutable snapshot of current unresolved,
non-outdated GitHub review threads. A Kurami finding must be authored by
the `kurami-ai` GitHub App (both GraphQL login shapes are normalized), contain
the exact-SHA machine marker, and belong to a recorded ready review. An
owner-authored inline review comment is also actionable.
Resolved threads are skipped; owner replies inside a selected thread become
explicit refinement instructions. Comments added after the click belong to a
later round.

Each request starts a fresh writer task in the existing managed worktree while
preserving the primary Codex task. The writer is pinned to the snapshotted PR
head, may change only the selected feedback, and may commit/push normally to the
same branch. It may not force-push, merge, create another PR, reply to GitHub
threads, or start another review/fix round. Kurami waits for a new exact SHA and
CI. Failed or missing CI, no new head within ten minutes, or unsettled CI after
thirty minutes ends at `needs_attention`; there is no automatic writer retry.

After CI passes, the GitHub App posts an idempotently marked reply. A separate
deterministic resolver uses the protected owner credential only for GitHub's
conversation-resolution mutation, because GitHub permits resolution only to the
PR author or an actor with repository write access; that credential is never
passed to the reviewer or writer task. Only the snapshotted threads are touched.
Reconciliation is bounded to three attempts and then fails closed at
`needs_attention`. After a permission or implementation correction, an operator
may explicitly run `review-fix-manager.ts recover --round-id ... --apply` to
retry GitHub resolution only when the exact result SHA already passed CI; it
never reruns the writer or expands the immutable snapshot. The technical writer
task is archived and the original primary Codex task is restored. Another AI
review or fix round starts only through an explicit owner action.

### Controller / Reconciler

`src/controller.ts` reads actionable Run Store states after event consumption
and dispatches only the next eligible deterministic handler:

```text
admission_pending + planned       -> provision worktree
starting + provisioned            -> start Codex, subject to the LLM cap
running + missing thread ID       -> synchronize title/thread mapping
review-ready + CLI                -> park the persistent task, owner none
explicit take-control request     -> transfer the same thread to Remote
explicit failed-CI repair request -> fresh bounded task in the same worktree
finished repair task              -> archive repair task + restore primary task
explicit AI-review request        -> detached read-only review on the exact PR SHA
explicit Fix Review request       -> snapshot threads + fresh exact-SHA writer
passed review-fix SHA             -> bot reply/resolve snapshot + restore primary task
explicit preview-up request       -> lease, build, health-check, and publish
preview-required completion       -> wait for exact-SHA reviewed preview, then resume
stopping + active preview         -> revoke ingress and remove the exact runtime
stopping + releasable resources   -> safe worktree release
```

It does not call every component on every tick. Runs without an actionable
state are ignored. Each handler owns its own transactional claim and remains
idempotent across scheduler overlap or restart.

`Human Review` alone is not a preview or Remote trigger. Each run has one
durable progress card that is edited on meaningful lifecycle changes and at a
coarse five-minute heartbeat while active; it reports deterministic stages, not
invented percentages or ETAs. Review, human-control, preview-ready, preview-
failed, and attention events remain separate durable notifications.

Discord is the primary control surface. A new run creates one starter card in
the configured project channel and a public ticket thread named
`[TT-N] Title` or `[PF-N] Title`. The starter card is edited in place as the
lifecycle changes and remains link-only because Discord mirrors it into the
message-started thread as a non-authoritative representation. The notifier adds
the single allowlisted owner to the thread and creates one persisted,
thread-local control message. That message is edited rather than duplicated,
including after restart or an explicit `show controls` request, and is pinned as
the durable control anchor for the ticket thread. While managed Codex is active
the ownership action is labelled `Take control`; after autonomous work parks it
becomes `Continue in Codex` because no CLI owner remains. Native buttons
carry strict `kurami:*:<run_id>` IDs and are handled by a user-plugin extension
of the existing Hermes Discord adapter; they do not invoke an LLM. Events such
as preview-ready are posted once inside the ticket thread from a separate
durable delivery outbox. Each short lifecycle event includes one `Open controls`
link back to the pinned control message instead of duplicating action buttons.
CI and AI review are independent dimensions on the same live card: while both
are active it reports `Validating changes`; after review completes it keeps
waiting for CI when necessary. The card never creates a second Discord
conversation for findings.

An active `Take control` request is shown immediately as `Preparing human
control`. The controller sends the Codex TUI its normal `Escape` interrupt,
requires two stable idle observations within a bounded window, and only then
closes managed CLI/tmux and transfers the same thread. It never force-kills a
turn that does not become idle, and it refuses takeover at an approval prompt.
The takeover button is hidden during this work so repeated clicks cannot create
misleading duplicate intent. Regardless of whether GitHub reaches Human Review
during the wait, a successful handoff normalizes the durable state to
`remote_owned` with owner `remote`.

After a successful handoff, ownership becomes `remote` and the interaction is
replaced by an `Open in Codex` link. The live card and handoff event include the
exact Codex task title, `shagserv / <project>` connection context, the durable
thread ID as a diagnostic fallback, and an explicit note that managed
CLI/tmux automation released ownership. Discord rejects custom URI schemes in
link buttons, so the button targets the fixed HTTPS launcher
`https://go.shagon1k.win/codex/threads/<uuid>`. Caddy accepts
only an exact UUID path on that host and returns a `302` to
`codex://threads/<uuid>`; arbitrary redirect targets are impossible. The
launcher route is intentionally not protected by Cloudflare Access: it exposes
no task data or authorization and the Codex app still enforces the user's own
session. The UUID is an identifier rather than a credential.

The Discord surface digest includes lifecycle state, owner state, the exact
Codex thread ID, and preview state in addition to progress-card text. Therefore
a late or corrected thread ID or ownership change refreshes controls immediately
even when the visible stage has not changed. `Start preview` is shown and
accepted only after the run has reached a stable owner-free `parked_review` or
`waiting_human` state; an already running preview can still be stopped. Card timestamps are
labelled `Stage since` and contain both `DD.MM.YY HH:mm` in Europe/Vilnius and a
Discord relative timestamp. Ephemeral status replies are explicitly labelled
`Status snapshot` and include their capture time so they cannot be mistaken for
a live card.

Cancellation never destroys published work automatically. If a pull request or
remote branch already exists, Discord reports `Cancelled — published work
preserved` and keeps the GitHub links without offering the local-discard action.
Guarded `Discard local work` remains available only for unpublished preserved
work. A separate two-confirmation `Close draft PR & discard` action can resolve
one exact managed Draft PR only when the worktree is clean, local and remote
heads match, and no merged/non-draft/ambiguous PR is present. Every mismatch is
refused without deletion.

Telegram remains a reversible inbound fallback. Its text buttons arrive
through the normal Hermes Gateway and the `kurami-run-control` skill queues only
allowlisted actions. Both transports share the same Run Store and controller;
neither transport owns lifecycle state. Proactive Telegram application requires
the explicit process-local override `KURAMI_TELEGRAM_PROACTIVE=1`; without it,
`notify-controls.ts --apply` exits successfully without sending anything. This
prevents an old command or cron definition from silently re-enabling Telegram
spam while preserving a deliberate rollback path. Ambiguous Telegram outbox
rows left in `sending` are not automatically retried because Telegram may
already have accepted them. Ordinary polling remains `no_agent`.

### Run Store

`../state/orchestrator.db` is the operational source of truth. Important records:

- `project_items`: latest observed Project snapshot;
- `project_events`: durable transition queue and processing result;
- `runs`: issue attempt, interaction policy, owner, and lifecycle state;
- `run_resources`: worktree, branch, Codex/tmux, and preview mapping;
- `run_state_history`: append-only lifecycle evidence;
- `run_attention`: persistent two-observation notification deduplication;
- `run_control_events`: durable, one-time notification outbox;
- `run_control_requests`: idempotent owner-action queue and result;
- `run_ci_repair_attempts`: exact-SHA repair budget, task identity, and result;
- `run_ai_reviews`: exact-SHA reviewer identity, GitHub Review, counts, and result;
- `run_review_fix_rounds`: immutable owner-approved snapshot and exact-SHA result;
- `run_review_fix_threads`: per-thread reply/resolve reconciliation state;
- `project_triage_state`: latest factual Backlog hash and last checked/changed time;
- `project_triage_snapshots`: changed-only factual history for ranking and audit;
- `project_triage_rankings`: current full eligible ranking and Suggested-next identity;
- `project_discord_digest_surfaces`: stable direct-message identity per project;
- `project_metadata_assessment_cursors`: last fully assessed factual baseline;
- `project_metadata_proposal_batches`: immutable bounded AI assessment inputs and state;
- `project_metadata_proposals`: field-level proposals and later apply/revert provenance;
- `project_metadata_proposal_events`: append-only proposal lifecycle evidence;
- `run_progress_cards`: transport-independent desired lifecycle card per run;
- `run_discord_surfaces`: Discord starter card, ticket thread, owner membership,
  and persistent thread-control-message identity;
- `run_discord_event_deliveries`: Discord event delivery state;
- `preview_slots`: fixed hostnames and loopback port assignments;
- `preview_leases`: current and historical run-to-slot ownership;
- `schema_migrations`: applied schema versions.

GitHub Project remains the source of user intent and delivery status. SQLite
owns runtime state and resource identity.

### Projects Digest

Projects Digest is the user-facing feature name. The `triage-*` source and table
names below are internal implementation details retained for schema compatibility.

`src/triage-snapshot.ts` is the read-only P4a boundary. It collects all configured
Project issues, native `blockedBy` / `blocking` relationships, optional Priority
and Effort fields, readiness facts, active runs, WIP, and stable backlog totals.
It deliberately has no Due date policy and does not mutate Project fields or start
work.

Each project gets a canonical factual hash that excludes observation timestamps.
An identical rerun updates only `last_checked_at`; it does not append history or
recompute ranking. A meaningful issue, field, dependency, status, or run change
appends exactly one new snapshot.

`src/triage-rank.ts` ranks every eligible Backlog issue with versioned,
deterministic policy. Explicit owner Priority is the dominant tier. Lower Effort,
age, and issue number provide stable within-tier ordering. Existing explicit
blocked state is only an eligibility safety guard; dependency relationships do
not add score and Kurami does not infer or mutate them. The stored explanation is
derived from those same facts, so a model
cannot silently reorder work or invent urgency. P4b remains advisory: it never
assigns P0/P1, edits Project fields, moves cards, or starts a run.

`src/notify-discord-digest.ts` writes directly into one manually created permanent
text channel configured as `discord.digest_channel_id` in `orchestrator.yaml`.
It creates exactly one English bot-owned card per configured project and then
edits that message in place; no Discord thread, pin, or daily message stream is
created. Identical same-day state is a no-op. A daily check may refresh only the
displayed Last checked date. Status transitions trigger the same locked pipeline
from the project poller, while the daily Hermes job remains the recovery baseline.
The orchestrator must never create, move, or delete the `📋-digest` channel.

### Metadata proposal batches

P4c starts behind a read-only boundary. `src/metadata-proposal-manager.ts` plans
at most 12 Backlog issues per batch from the changed-only Projects Digest facts.
The initial bootstrap is chunked without losing remaining issues. Later batches
consider only new or proposal-relevant changed issues. One active batch per
project prevents daily reruns; unrelated project changes are deferred instead of
invalidating an existing proposal, while a change to a batch target supersedes
that stale batch.

`src/metadata-proposal-worker.ts` may suggest missing Priority values P1-P3 and
Effort values XS-XL. P0 is owner-only and is rejected by both the parser and the
database. Dependency relationships are excluded. The worker prefetches bounded
private issue context with read-only `gh api` calls, then removes GitHub tokens
from the detached Codex environment. Codex runs read-only with no approvals,
network, external tools, or mutation authority. Its strict JSON result is
revalidated against the current target facts before durable proposals are stored.
An invalid model result receives exactly one fresh detached Codex attempt inside
the same immutable batch. Both rejected outputs are recorded; a second invalid
result fails the batch. Transport, GitHub context, and source-change failures are
not treated as formatting failures and are not blindly retried.
The assessment stage does not edit GitHub Projects, Discord, issues, or
repository content.

Schema 22 adds the automatic daily continuation boundary. The argument-free
`Projects Digest` baseline admits at most one metadata-assessment batch per
project per UTC date, with the existing maximum of 12 issues per batch. Initial
backlog bootstrap therefore continues over bounded daily chunks; an unchanged
project, a same-day rerun, and event-driven per-project digest refreshes invoke
no additional AI work. The admission is durable in
`project_metadata_daily_admissions`, so a completed or failed batch cannot be
silently replaced by a second batch that day.

Automatic assessment shares the controller lock and respects
`limits.max_llm_running_global`. A planned batch interrupted before Codex starts
is resumed rather than duplicated. A batch still marked `running` from a prior
UTC day is failed with append-only recovery evidence and replaced by one bounded
batch on the new daily admission. Worker failure is logged without blocking the
factual digest card update; owner review and guarded GitHub synchronization keep
their existing explicit authorization boundaries.

Inspect the daily admission plan without mutation:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/metadata-proposal-scheduler.ts
```

The normal `kurami-projects-digest` Hermes job invokes the apply form once per
day. `--project` digest refreshes triggered by project changes deliberately skip
the scheduler.

Schema 20 adds the owner-review boundary. A ready batch appears inside the same
per-project Projects Digest card with `Accept batch`, `Review proposals`,
`Discuss batch`, and `Skip batch` controls. The public card contains plain
owner-facing status only; internal snapshot and policy identifiers remain in
SQLite and logs. An unchanged batch is a no-op and does not create another
message.

`src/metadata-proposal-controls.ts` is deliberately SQLite-only. Accepting a
batch records the remaining proposals as owner-approved, but performs zero
GitHub writes and keeps the accepted batch active until the later guarded-sync
stage. Review proposals uses an ephemeral Discord panel to show the full batch,
exclude individual proposals without per-ticket confirmation, restore accidental
exclusions, and accept everything remaining. The panel edits itself after each
selection instead of creating follow-up messages; acceptance replaces the source
panel with a final result and removes its stale controls. Discuss creates one temporary thread
only after an explicit owner action, reuses that thread for the batch, and
archives it after Accept or Skip. The archive is recorded only after Discord
confirms the operation. Every decision appends actor and event provenance.

Inspect and then create proposal batch plans:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/metadata-proposal-manager.ts prepare

ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/metadata-proposal-manager.ts prepare --apply
```

Inspect a planned batch without GitHub reads or Codex execution, then explicitly
run its read-only assessment:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/metadata-proposal-worker.ts --batch-id <batch_id>

ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/metadata-proposal-worker.ts --batch-id <batch_id> --apply
```

Schema 21 adds guarded GitHub Project synchronization. `Accept batch` is the
single owner authorization: the per-project poller picks up the durable accepted
batch and first re-reads every exact Project item field. A proposal may write
only when that field is blank, or when its current value still equals the last
value written and owned by Kurami. Any other non-empty value is treated as an
owner change and preserved as `conflicted`. P0 is rejected again at this final
boundary, even though proposal validation already forbids it.

Writes are recorded per field in `project_metadata_field_ownership`; matching
values that already exist are considered satisfied without claiming bot
ownership. Partial writes are durable and idempotent. Global failures retry at
most once (two total attempts), then the digest reports `Needs attention`
instead of looping. The owner-facing states are `Approved`, `Applying`,
`Applied`, `Partially applied`, and `Needs attention`. A changed sync result
immediately runs the same snapshot/ranking/digest pipeline, while idle ticks are
no-ops.

Inspect the next accepted batch without external reads or writes:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/metadata-sync.ts --project tailortales
```

Re-read all exact live fields and print guarded decisions without mutation:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/metadata-sync.ts --project tailortales --verify
```

`--apply` is normally invoked by the locked project poller after explicit owner
acceptance. During a controlled deployment it may be run manually while that
poller is paused.

### Worktree Provisioner

`src/provision-worktree.ts` validates the planned resource mapping and canonical
repository. Without `--apply`, it only prints a plan. With `--apply`, it requires
a `live` run, fetches the configured base branch, and creates an isolated branch
and worktree from the exact recorded base SHA.

Each attempt has a unique parent directory, while the Git worktree itself keeps
the canonical repository basename:

```text
../.worktrees/tailortales/TT-41_add-spanish-language-support/TailorTales
```

This preserves filesystem isolation while allowing an externally launched Codex
session to present the stable project name `TailorTales` instead of the attempt
directory name.

Provisioning states are durable:

```text
planned -> provisioning -> provisioned
                       \-> partial + needs_attention on failure
```

### Session Manager

`src/session-manager.ts` starts interactive Codex TUI processes only for live
runs whose worktree is already `provisioned`. The default `start` action is
plan-only; `--apply` claims a unique `cx-*` tmux identity, enforces the global
tmux cap, starts Codex in the recorded worktree with the initial engineering
prompt passed directly to the CLI, moves ownership to `cli`, and records the run
as `running`. This avoids timing-sensitive synthetic keyboard submission during
TUI startup. `sync` uses the official Codex App Server stdio protocol to find
the CLI thread by its exact worktree, apply the stable `[PROJECT-ISSUE]: title`
name directly to persisted metadata, and record its UUID without typing into a
live TUI. `inspect` compares the durable mapping with the actual tmux session.
`handoff` refuses an approval-blocked turn. For an active remote takeover it
requests the TUI's normal interrupt and requires a stable idle prompt within a
bounded window; failure remains non-destructive and retryable. It then saves a
mode-600 terminal tail, performs bounded graceful EOF, verifies that tmux
disappeared, and transfers durable ownership from `cli` to `remote`. The
database transition is recoverable when tmux already exited during handoff.
`finalize-stop` is plan-only by default. It permits the durable transition from
`stopping` to `cancelled` only after verifying that the tmux session, worktree,
and local branch are all absent; `--apply` records the verified cleanup.
If cancellation finds unpublished local changes, automation still stops but the
run becomes `needs_attention` and preserves the exact worktree. Discord then
offers `Discard local work`; that action requires a second confirmation and
calls `src/cancel-resolution.ts`, which refuses deletion when the branch has
commits beyond its recorded base or exists on the remote. Published Draft PR
results use the separate exact-match resolver described above. A successful
guarded resolution changes the run to `cancelled`, marks resources `released`,
and records the deleted resources in lifecycle history.

`bin/launch-codex-session.sh` loads `GH_TOKEN` from the orchestrator-owned
credential file inside the child launcher. The value is never passed in command
arguments, stored in tmux session environment, or written to SQLite.
The initial prompt tells Codex that sandboxed GitHub CLI authentication failures
are inconclusive when network access is restricted, forbids credential mutation,
and requires a narrowly scoped network retry before declaring a real auth
blocker.
Automated turns run in `workspace-write` with interactive `on-request` approval
and `auto_review`; this is intentionally not full access or `--yolo`. Routine
boundary requests can continue through the reviewer, while denied or dramatic
actions still require a safer path or Alex's decision.
AI reviewers are a separate path: they use the official Codex App Server review
turn with `read-only`, `never` approval, detached delivery, prefetched private
PR context, and an explicit decline handler for unexpected server-initiated
approval requests. They never take ownership of the persistent primary task or
inherit permission to mutate code. The worker authenticates only as the private
`kurami-ai[bot]` GitHub App: it exchanges the mode-600 private key for a
short-lived installation token, uses that token to read the exact PR/issue and
publish one native review, and has no fallback to the user's `GH_TOKEN`. The
token, App identifiers, and private-key path are removed from the Codex child
environment. Review summaries and inline findings carry visible AI attribution
plus hidden `review_id`/exact-SHA provenance markers for deterministic P3b
triage.

`src/observe-sessions.ts` checks only CLI-owned runs. A waiting approval,
interrupted turn, missing managed tmux, or idle textual blocker such as a stopped
publish workflow must persist for two observations before one durable
notification is emitted; the same condition is not repeated until it clears and
later recurs. Textual blocker matching requires the fresh Codex input prompt to
appear after the blocker, so transient narration does not trigger an alert.

### Human Review, Done, and release

Project transitions are durable lifecycle inputs:

```text
In progress -> Human Review   run -> parked_review, owner cli while finalizing
CLI safely released           run -> parked_review, owner none; review-ready
Human Review -> Done          run -> stopping(completed)
Backlog/Deferred cancellation run -> stopping(cancelled)
Discord Cancel run               -> stopping(cancelled)
dirty unpublished work           -> needs_attention; local work preserved
published Draft PR               -> needs_attention; published work preserved
confirmed exact safe resolution  -> cancelled + released
cancelled + released              -> GitHub Project item -> Backlog
```

Completed cleanup fetches the configured remote base and accepts either direct
Git ancestry or an authoritative merged GitHub PR whose head branch and exact
head SHA match the run. This supports merge commits, fast-forward, squash, and
rebase merges without weakening deletion safety. Until one proof passes, the
run remains `stopping` and the worktree is retained. After verification, the
worktree and local branch are released and the run becomes `archived`.
Cancellation cleanup remains stricter: dirty files or any commit beyond the
recorded base block automatic deletion and require attention. Only a deliberate
two-step action can remove dirty unpublished files or one exact clean managed
Draft PR result; merged/non-draft/ambiguous/mismatched published work remains
preserved. Once cleanup is complete,
`src/project-status.ts` returns the item to the project's configured Backlog
option and updates the local Project snapshot idempotently.

`Human Review` is intentionally not synonymous with immediate readiness. If the
GitHub transition arrives while the current Codex turn still owns the managed
CLI, the live card reports `Finalizing for review`. The one-time
`review_ready` event is created only after bounded graceful EOF has released
that ownership and `owner_state` is `none`. Its idempotency key is tied to the
corresponding `codex_cli_park_completed` history record, so later preview lease
self-transitions cannot emit another review-ready notification.

### Preview slot leasing

`src/preview-manager.ts` owns the fixed application-preview pool
`preview-1.shagon1k.win` through `preview-6.shagon1k.win`. Allocation uses an
SQLite `BEGIN IMMEDIATE` transaction, applies the global preview cap, selects
the lowest enabled free slot, records a historical lease, and maps the slot to
`run_resources.preview_id`. Repeating allocation for the same run returns the
existing lease instead of consuming another slot.

Each slot has deterministic loopback ports for frontend, backend, PostgreSQL,
Redis, MinIO API, and MinIO console. The slot pool is shared by repositories;
the Compose project name remains run-specific. Runtime concurrency is six,
while build/provision concurrency is separately limited to two.

Lease release is fail-closed. `--apply` additionally requires
`--runtime-absent`; the selected runtime adapter must first prove that its
runtime and ingress resources are gone. Released rows remain as audit history,
while the slot becomes reusable.

`src/preview-runtime.ts` is a narrow dispatcher. Before provisioning it reads
the project adapter; after a lease is claimed it always follows the adapter
persisted on that lease, so a later configuration edit cannot make one runtime
clean up another adapter's resources.

`src/preview-compose-runtime.ts` is the Compose adapter. It validates the mapped
worktree and repository-owned Compose contract, requires the rootless Docker
daemon, checks available RAM/disk and fixed loopback ports, transactionally
claims one of two build slots, and writes per-run runtime files below
`../state/previews/<run_id>` with mode `600`. Google credentials come from the
project-specific orchestrator secret file; per-run JWT, E2E, PostgreSQL, and
MinIO credentials are generated locally and never printed or stored in SQLite.
After Compose health checks pass, the lease becomes `running`.

Projects that produce an already-built static site may instead configure:

```yaml
preview:
  adapter: static
  artifact_directory: dist
  max_files: 5000
  max_bytes: 268435456
```

The static adapter requires the conventional root `index.html` and never
executes a configured build command. It inventories
only that relative directory in the exact managed worktree, rejects hidden
paths, symlinks, special files, path escapes, and bounded-size violations, then
copies and re-verifies an immutable snapshot below
`../state/previews/<run_id>/artifact`. The digest, file count, byte count, and
root become durable lease provenance. The same slot, TTL, extension, review
acknowledgement, exact-SHA policy, Discord controls, and fail-closed cleanup
apply to both adapters. Existing Compose projects are unchanged.

Successful health checks also start a bounded 24-hour TTL; build time does not
consume the owner-visible preview window. During the final two hours, the live
Discord card warns the owner and offers one `Extend 24h` action. An extension
is accepted only for the exact still-running, not-yet-expired lease and is
recorded in `run_state_history`. Repeated early extensions and extensions after
expiry are refused. Existing active previews receive a fresh 24-hour grace
period when migration `023_preview_ttl.sql` is first applied.

While a healthy preview is running, the owner can use `Mark reviewed` once.
This acknowledgement belongs to the exact lease and records its timestamp,
authorized owner identity, source, and an append-only `preview_reviewed` history
event. It does not change the run state, stop the preview, extend its TTL, or
act as merge approval. The control disappears after acknowledgement, while the
live card shows `Reviewed`; a newly allocated lease starts unreviewed again.

TailorTales can opt a run into a completion gate with the exact repository
label `preview-required`. The label is snapshotted only when the issue enters
`In progress`; adding or removing it later does not silently change the running
contract. When GitHub moves an enrolled issue to `Done`, Kurami keeps the run
parked and presents `Preview required` until a healthy preview for the exact
current PR head SHA has been acknowledged. A preview for an older commit never
counts. Once exact-SHA evidence exists, the controller resumes completion
automatically and retains the source event, lease, SHA, reviewer, and timestamps
as durable provenance. Runs without the label keep the existing lifecycle.

`src/preview-ingress.ts` is the only writer of the managed Caddy route fragment.
It renders routes solely for enabled slots whose lease is `running`, validates a
candidate configuration before replacing the live mode-`600` file, and reloads
Caddy through its loopback-only admin endpoint. A failed reload restores and
reloads the previous route set. Compose preview hostnames preserve the existing
frontend, `/api`, and MinIO routing. Static leases expose only their immutable
file tree on both assigned hostnames. Unknown and inactive hostnames receive
`404`.
The same managed fragment always keeps the narrow Codex launcher route active,
including when no application preview is running; all other unmatched requests
remain fail-closed.

Runtime publication is fail-closed: health checks pass, the lease becomes
`running`, and only then is ingress reconciled. Cleanup first moves the lease to
`releasing` and removes its public route, then addresses only the recorded
Compose project, removes its volumes, proves that no labeled containers remain,
releases the durable lease, and finally removes the exact per-run runtime
directory. Missing evidence or a partial cleanup leaves the lease occupied in
`failed` state for reconciliation.

The controller plans the same guarded `down` path when a TTL expires. That path
revokes ingress first, then removes only the recorded Compose project and its
volumes. The slot is released only after container absence is proven; failed
cleanup stays visible in runtime health instead of silently freeing the slot.

Branch naming is deterministic and readable:

```text
[Feature]: Add Spanish language support -> TT-41_add-spanish-language-support
unstructured/non-ASCII title             -> TT-41
occupied historical identity             -> TT-41_retry-2
```

## Execution modes

`../config/orchestrator.yaml` controls admission mode:

- `dry_run`: create and cancel durable plans without allowing Git provisioning;
- `live`: create live run records that may be passed to the provisioner.

`live` does not itself create a worktree or start Codex. Admission records intent;
the component that owns each external resource performs and records the mutation.

## Routine commands

Use the orchestrator-owned Node runtime:

```bash
cd /home/shagon1k/_hermes/_orchestrator/app
export PATH="/home/shagon1k/_hermes/_orchestrator/runtime/node/bin:$PATH"
```

Type-check production code and tests:

```bash
npm run check
```

Run the isolated admission regression test:

```bash
npm run test:admission
```

Create a consistent SQLite/config backup or inspect retained backups:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/backup-state.ts create

ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/backup-state.ts inspect
```

Each backup is a mode-700 directory under `../backups` containing a verified
SQLite snapshot, the non-secret config allowlist, and a SHA-256 manifest.
Secrets and OAuth stores are never copied. Fourteen snapshots are kept by
default; at the three-day schedule this is roughly six weeks of history.
`KURAMI_BACKUP_RETENTION` may be set from 2 through 90.

Inspect runtime consistency without changing anything:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/runtime-health.ts
```

The check compares active `preview_leases`, adapter provenance, recorded
`preview_id` mappings, runtime directories, and actual rootless Docker Compose
project labels. It reports forgotten `kurami-pv*` projects, missing Compose
projects or static snapshots, failed leases,
terminal runs that still own a lease, mapping drift, SQLite integrity, and backup
freshness. It never removes or repairs an orphan automatically.
The default freshness limit is 84 hours, matching the three-day backup cadence
with a 12-hour execution margin. `KURAMI_BACKUP_MAX_AGE_HOURS` may be set from
24 through 168. `--alert-text` is silent while healthy; `--summary-text` always
prints a compact owner-facing status.

Preview the monthly maintenance scope, then apply it:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/monthly-maintenance.ts

ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/monthly-maintenance.ts --apply
```

Maintenance removes only regular `.log`, `.jsonl`, and `.txt` files older than
90 days under `../logs`, then asks the rootless Docker daemon to prune unused
images and builder cache older than 30 days. It does not prune containers,
volumes, networks, worktrees, or preview runtimes. `KURAMI_LOG_RETENTION_DAYS`
may be set from 30 through 365.

Verify preview-slot exhaustion, idempotency, release, and reuse:

```bash
npm run test:preview-slots
```

Verify deterministic preview route rendering and rejection boundaries:

```bash
npm run test:preview-ingress
```

Verify static adapter migration safety, durable dispatch, deterministic
artifact inventory, and filesystem rejection boundaries:

```bash
npm run test:preview-static
```

Verify durable control/progress events, preview-ready notification, ambiguous-
delivery deduplication, review-event stability across preview history, no
automatic preview, explicit takeover, and human-control preparation handoff:

```bash
npm run test:controls
```

Verify owner-triggered exact-SHA CI repair, fresh-task planning, passed repair,
repair-task archival, primary-task restoration, and the durable two-attempt
`needs_attention` boundary:

```bash
npm run test:ci-repair
```

Verify the owner-triggered detached read-only reviewer, exact-SHA contract,
private context prefetch contract, zero-approval fail-fast behavior, native
GitHub Review payload, no-findings case, CI parallelism, and automatic
technical-task archival:

```bash
npm run test:ai-review
```

Inspect the preview pool without mutation:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/preview-manager.ts inspect
```

Plan and then atomically allocate a slot:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/preview-manager.ts allocate --run-id <run_id>

ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/preview-manager.ts allocate --run-id <run_id> --apply
```

Plan or apply an owner extension while the preview is inside its warning window:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/preview-manager.ts extend --run-id <run_id>

ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/preview-manager.ts extend --run-id <run_id> --apply
```

Verify the isolated TTL lifecycle and populated-v22 migration:

```bash
npm run test:preview-ttl
```

Plan or record the exact-lease acknowledgement from a trusted CLI context:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/preview-manager.ts review --run-id <run_id> --reviewed-by cli:owner

ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/preview-manager.ts review --run-id <run_id> --reviewed-by cli:owner --apply
```

Verify acknowledgement provenance and lifecycle isolation:

```bash
npm run test:preview-reviewed
```

Verify opt-in admission, deferred completion, stale-SHA rejection, owner-visible
state, and automatic guarded completion:

```bash
npm run test:preview-policy
```

Inspect or reconcile the desired Caddy routes from the Run Store:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/preview-ingress.ts inspect

ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/preview-ingress.ts reconcile --apply
```

Verify the post-merge release boundary in isolated local Git repositories:

```bash
npm run test:release
```

Apply pending database migrations and check integrity:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/init-run-store.ts
```

Run one production poll -> consume cycle manually:

```bash
./run-project-poller.sh tailortales
./run-project-poller.sh pickflick
```

Inspect a provision plan without mutation:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/provision-worktree.ts --run-id <run_id>
```

Provision an explicitly approved live run:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/provision-worktree.ts --run-id <run_id> --apply
```

Plan and then release a stopping run's clean worktree and local branch:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/release-worktree.ts --run-id <run_id>

ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/release-worktree.ts --run-id <run_id> --apply
```

Release refuses dirty files, an active tmux mapping, paths outside the configured
worktree root, uncommitted cancellation work, and completed work not yet merged
into the configured remote base branch.

Inspect a Codex session start plan without mutation:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/session-manager.ts start --run-id <run_id>
```

Start the interactive Codex TUI in managed tmux:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/session-manager.ts start --run-id <run_id> --apply
```

Synchronize the stable task title and Remote thread ID after the initial turn:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/session-manager.ts sync --run-id <run_id> --apply
```

Plan and then perform graceful CLI-to-Remote handoff:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/session-manager.ts handoff --run-id <run_id>

ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/session-manager.ts handoff --run-id <run_id> --apply
```

Inspect durable and live session state:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/session-manager.ts inspect --run-id <run_id>
```

Verify that a stopping run has no remaining tmux, worktree, or local branch:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/session-manager.ts finalize-stop --run-id <run_id>
```

After reviewing the plan, record the verified cleanup:

```bash
ORCHESTRATOR_HOME=/home/shagon1k/_hermes/_orchestrator \
node src/session-manager.ts finalize-stop --run-id <run_id> --apply
```

## Production scheduling

Hermes runs two one-minute `no_agent` jobs, one per project. They use wall-clock
cron `* * * * *`, not completion-anchored `every 1m`, and both call the same
`run-project-poller.sh` wrapper. Per-project locks prevent overlapping polls; a
global consumer lock prevents both jobs from processing the event queue at once.
The same lock also owns the subsequent controller pass, so poll, consume, and
reconciliation cannot overlap between the two project jobs. A transient GitHub
Project query failure is logged but no longer aborts that reconciliation pass;
the durable per-project poll health guard prevents the other project job from
starting work against the failed project's stale status.
After reconciliation, `notify-discord-controls.ts` maintains Discord ticket
cards, threads, native controls, and one-time lifecycle events through Discord
REST. It reads the existing platform token from `HERMES_HOME/.env`, never stores
or prints it, and never consumes Gateway updates. The Hermes Gateway remains the
only update consumer. A narrow user plugin extends that existing Discord adapter
to handle only allowlisted Kurami component IDs.

`notify-controls.ts` and the per-project Telegram targets remain installed as a
reversible fallback, but the poller does not invoke that notifier while Discord
is the primary proactive control plane. The notifier also refuses `--apply`
unless `KURAMI_TELEGRAM_PROACTIVE=1` is supplied for that exact invocation.
Cron delivery is local-only, so no proactive run lifecycle messages are sent to
Telegram.
Empty successful cycles are silent. Discord is the proactive run-notification
surface; Telegram remains available only as an inbound fallback.

Four additional `no_agent` jobs own operational housekeeping:

- state backup on days `1, 4, 7, ...` at `03:15 UTC`, delivered to the muted
  Discord maintenance channel;
- hourly read-only runtime health inspection, silent while healthy and delivered
  to the private Discord alerts channel only when attention is required;
- a compact healthy heartbeat every three hours, delivered to the muted Discord
  health channel;
- monthly bounded maintenance on the first day at `04:15 UTC`, delivered to the
  muted Discord maintenance channel.

The health job is intentionally not a cleanup reconciler. An orphan Docker
preview is evidence of state drift and requires owner review before the exact
Compose project is stopped. Monthly maintenance cannot hide that evidence by
pruning containers or volumes.

Do not add a second consumer cron or service unless the ownership model is
deliberately changed.

## Safety contracts

- Never read, print, log, copy into prompts, or commit secret values.
- Never use the canonical checkout as an agent workspace.
- Never create resources before admission succeeds.
- Never infer completion from process exit alone; verify state and evidence.
- Never let polling or retries create a second active run for the same item.
- Never bypass WIP limits by creating worktrees or sessions manually.
- Never merge a pull request or deploy production autonomously.
- A return from `In progress` to `Backlog` or `Deferred` is a cancellation signal.
- A cancelled run keeps historical mapping until guarded cleanup and is moved
  back to the configured Backlog status only after resources are released.
- Never discard preserved cancellation work without an explicit second
  confirmation; never discard a remote branch or commits beyond recorded base.
- After Remote handoff, never seize the same Codex thread from standalone CLI;
  create a successor thread in the same run/worktree when automation must resume.

## Making changes

For control-plane changes:

1. Preserve deterministic behavior and durable state transitions.
2. Add a versioned migration for schema changes; never edit an applied migration.
3. Run `npm run check`.
4. Run `npm run test:admission` when admission, naming, state, or limits change.
5. Test dangerous mutations first in plan-only or isolated mode.
6. Update this README when commands, ownership, layout, or safety contracts change.
7. Update the architecture plan and setup handoff when milestones or decisions
   change materially.

Avoid adding services, queues, caches, or abstractions without a concrete failure
mode that the existing SQLite + scripts design cannot handle.

## Recovery orientation

When something fails, inspect layers separately:

1. GitHub observation: did the poller see and store the transition?
2. Admission: what is `project_events.processing_state` and its note/error?
3. Run state: which run is active, cancelled, rejected, or needs attention?
4. Resource state: planned, provisioning, provisioned, partial, or released?
5. External resource: does the recorded worktree/branch/tmux session actually exist?

Do not repair SQLite and external resources independently. Reconcile the recorded
mapping against reality, preserve evidence, then perform the smallest reversible
repair.

## Recovery and tracked deployment assets

Tracked deployment and recovery assets live under `deploy/` and
`integrations/hermes/`. See [docs/recovery.md](docs/recovery.md) for the
restore order, required secrets, external infrastructure, cron jobs, and
post-restore verification.

The deployed `kurami-run-control` skill must remain byte-for-byte aligned
with `integrations/hermes/skills/kurami-run-control/`.
