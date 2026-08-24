# Kurami Orchestrator E2E acceptance catalog

This catalog is the reproducible acceptance boundary for the complete
orchestrator, not only the latest roadmap phase. Run it against a clean `main`
checkout. Never print credentials, copy issue or PR prose into a shell, or use a
real product ticket when a disposable `[Test]` item can exercise the boundary.
Its scope starts with the original Phase 0–6 plan (contract, observe-only
polling, admission/worktrees, discovery pilot, code/preview, human control, and
hardening) and includes every later P2–P8 increment.

## Evidence levels

- **Automated**: deterministic isolated test with fake GitHub, Discord, Git,
  tmux, Docker, or S3 boundaries.
- **Live read-only**: production identity, configuration, state, and external
  surfaces are inspected without mutation.
- **Live mutation**: a bounded disposable Project item exercises the production
  poller and is returned to a documented clean state.
- **Owner UI**: the configured owner verifies an ephemeral Discord interaction;
  this is intentionally the final checklist.

For every run, record the date, baseline SHA, deployed SHA, scenario result,
evidence reference, unexpected behavior, fix, retest, and cleanup result in a
dated report. A scenario is not complete while its cleanup column is unresolved.

## A. Baseline and deterministic regression

| ID | Boundary | Reproduction and expected result | Cleanup |
| --- | --- | --- | --- |
| BASE-01 | Git/deploy identity | Compare local `main`, `origin/main`, deployed app HEAD, installed plugin/skill/wrapper hashes, config registry, and canonical repo cleanliness. All tracked identities match and no unrelated dirty files exist. | None; read-only. |
| BASE-02 | SQLite/runtime | Open the production DB read-only; verify `integrity_check`, all versioned migrations, zero unexpected non-terminal runs/resources/previews/quarantines, and runtime-settings revision. | None; read-only. |
| BASE-03 | Schedulers/services | Inspect the eight Kurami Hermes jobs, gateway/ingress health, and last delivery errors. Three project pollers and five digest/operations jobs are enabled with documented schedules. | None; read-only. |
| AUTO-01 | Complete regression | Run `npm test`. TypeScript and all 40 ordered suites must pass; the runner must stop on the first failure and print a final JSON summary. | Test suites use temporary directories and remove them. |
| AUTO-02 | Adversarial input | Included in `test:adversarial`: delimiter, prompt-injection, credential-like, hostile branch/title, and forged control data remain inert or rejected without secret output. | Isolated fixtures only. |
| AUTO-03 | Linux parity | With no live managed worktrees, copy a clean candidate tree to a private temporary VPS directory, install from the lockfile, and run `npm test` with production Node/Python. Alternatively replace every project workspace root in the isolated registry. Do not point it at production state/secrets; the resource-guard suite intentionally inspects configured filesystem roots. | Delete only the exact temporary directory after preserving the result. |

## B. Project observation, admission, and execution

| ID | Boundary | Reproduction and expected result | Cleanup |
| --- | --- | --- | --- |
| POLL-01 | Initial snapshot/idempotency | Poll a fixture Project twice. Initial items form a baseline; the repeat creates no event or run. A real status transition creates one durable event only. | Remove isolated DB. |
| POLL-02 | GitHub failure isolation | Make one fixture Project query fail/stale while the other succeeds. New work for the stale project is blocked, existing reconciliation continues, and the healthy project remains independent. | Remove fixtures. |
| ADMIT-01 | Readiness/allowlist | Send open issue, closed issue, draft, missing-body, wrong-repo, and duplicate events through the consumer. Only the allowed, ready, unique issue is admitted. | Remove isolated DB. |
| ADMIT-02 | Shared WIP/LLM budget | Fill per-project and global WIP with fixture runs. Project caps share rather than reserve the global pool; project WIP never exceeds Global WIP and managed LLM starts never exceed the runtime cap. | Remove fixtures/tmux stubs. |
| RUN-01 | Provision/start | Move a disposable Project issue from Backlog to In progress. The poller records one event/run, provisions a branch/worktree from current `origin/main`, starts one managed tmux/Codex task, and leaves the canonical checkout clean. Repeated reconciliation is idempotent. | Continue to RUN-02 or CANCEL-01. |
| RUN-02 | Draft PR/handoff | The task makes only the issue-scoped change, runs repository checks, pushes the managed branch, and opens one Draft PR. Kurami records exact PR/head SHA, changes to owner-free review state, and Discord shows the handoff. | Continue to CI-01 and REVIEW-01. |
| RUN-03 | Merge/release | After owner validation, merge the one explicitly authorized harmless test PR and move its issue to Done. Kurami archives the run and releases tmux, worktree, local branch, preview lease, and active mappings without touching the canonical checkout. | Delete remote test branch if GitHub did not; verify zero active residue. |
| CANCEL-01 | Pre-publication cancel | Move a disposable admitted issue back to Backlog before a PR exists. Kurami stops the task and plans/releases only its recorded resources; repeated cancellation is safe. | Verify issue Backlog and zero branch/worktree/tmux residue. |
| CANCEL-02 | Published cancel | Move a disposable issue with a Draft PR back to Backlog. The owner-only resolution supports close/discard or keep-published; stale/foreign controls are rejected and no automatic destructive choice is made. | Close the disposable PR and delete its branch only through the guarded resolution. |
| SUCCESSOR-01 | Ownership/successor | Exercise CLI↔remote handoff and one bounded autonomous successor in isolation. Only the recorded owner writes, predecessor/successor linkage is durable, and attempts stop at the configured bound. | Remove isolated sessions/worktrees. |

## C. CI, review, preview, and controls

| ID | Boundary | Reproduction and expected result | Cleanup |
| --- | --- | --- | --- |
| CI-01 | Exact-SHA observation | For a managed Draft PR, compare stored required checks with GitHub checks for the exact recorded head SHA. Pending/success/failure/missing/unknown normalize deterministically; stale SHA data cannot advance the run. | Read-only after RUN-02. |
| CI-02 | Bounded repair | In isolation, fail a required check and request repair twice. Each approved attempt reads bounded logs, stays on the same branch, is SHA-pinned, and the third attempt is refused. | Remove fixtures. |
| REVIEW-01 | AI review | In isolation and, when economical, on RUN-02, review only the exact PR diff/head. Findings are deduplicated, evidence-bounded, and do not mutate or merge the PR. | No live cleanup beyond RUN-03/CANCEL-02. |
| REVIEW-02 | Review fix | Accept one actionable isolated finding. One scoped fix round updates the same branch, invalidates stale review/CI evidence, and remains bounded; rejection leaves code unchanged. | Remove fixtures. |
| PREVIEW-01 | Compose preview | For a preview-required TailorTales fixture/run, lease one of six slots, build within the two-build cap, route frontend/assets, verify exact head SHA, mark reviewed, and enforce the completion gate. | Release lease and stop only the recorded Compose project. |
| PREVIEW-02 | Static preview without CI checks | For a CI-disabled static-site run with one open managed PR, retain the exact PR head as passed with an empty checks list. Publish a self-contained artifact, pin digest and exact SHA, serve an existing asset directly, resolve a direct client-routed SPA path through the root `index.html`, acknowledge review, and release cleanly. | Stop the exact lease; close/discard the disposable Draft PR through guarded published cancellation. |
| PREVIEW-03 | Preview source integrity | For both adapters, reject publication if PR-head provenance is absent, the worktree HEAD differs, or tracked/untracked changes exist. Static inventory also rejects symlinks, hidden/path-escape content, and file/byte-limit overflow. | Isolated worktree/artifact only. |
| PREVIEW-04 | TTL/slots | Exhaust slots, extend TTL once, expire an unreviewed lease, and reconcile failure. Slot uniqueness and max-preview settings remain enforced. | Release all isolated leases. |
| DISCORD-01 | Lifecycle surface | Reconcile a run through admitted, running, review, preview, cancelled/Done states. The Components V2 starter stays compact, timeline events carry no controls, ordinary changes edit one dashboard, and an event moves a replacement dashboard below history before deleting the superseded message. Delivery retries and a stable repeat deduplicate. | Delete only the disposable bot-owned thread after preserving any required evidence. |
| DISCORD-02 | Control authorization | Automated plugin tests prove owner, guild, button/select allowlists, stale revision, stale SHA, and duplicate-delivery guards. Verify up to four visible contextual actions, overflow selection, destructive confirmation, and `/kurami status` only inside the exact active run thread. Then the owner performs the final live button/modal checklist. | Ephemeral responses expire; no settings mutation unless explicitly tested. |

## D. Project intelligence, operations, settings, and recovery

| ID | Boundary | Reproduction and expected result | Cleanup |
| --- | --- | --- | --- |
| DIGEST-01 | Snapshot/ranking/digest | Collect all configured Projects, rank factual metadata, and render one persistent Components V2 digest per project with a compact health table, Markdown links, metadata actions, and freshness. An unchanged rerun is silent; a real item transition refreshes only the affected digest. | Restore disposable issue status. |
| META-01 | Proposal/owner review | Generate delimiter-safe metadata proposals from a fixture snapshot. Accept/reject/expire controls are owner-only, revision-bound, and append durable events. | Remove isolated DB. |
| META-02 | Guarded sync | Apply an accepted fixture proposal only to owned GitHub fields, once. Drift, stale snapshot, foreign field, attempt exhaustion, and partial failure stop safely. | Isolated fake API; no live field mutation required. |
| SETTINGS-01 | Validation/idle lock | Automated tests cover ranges, cross-field constraints, stale revisions, idle locking, Apply/Reset/Undo, audit hashes, and defaults. Production status is read-only during certification. | Isolated DB/config. |
| SETTINGS-02 | Owner panel | As the configured owner, open `/kurami orchestrator settings`, verify current/default values, invalid cross-field feedback, stale-panel rejection, Apply, Undo, Reset, idle lock, ephemeral visibility, and maintenance audit. Restore the original settings revision values. | Required: restore the pre-test settings and confirm runtime idle. |
| READINESS-01 | Project compatibility | Run config mode against valid Compose/static projects and malformed registry fixtures; then run live mode with a read-only fake GitHub boundary. PASS/WARN/FAIL, exact selection, Project fields/options, exact CI names, workspace existence, and no mutation path must remain deterministic. | Remove isolated config/workspace fixtures. |
| GUARD-01 | Runtime health/resource guard | Inspect production read-only and exercise fixture orphan worktree/tmux/preview, disk, backup freshness, mapping drift, and changed-only Discord alerts. No automatic deletion of evidence is allowed. | Resolve fixture quarantines only. |
| MAINT-01 | Bounded maintenance | Plan old-log and unused Docker cache/image cleanup with fixtures; apply only to allowlisted old artifacts. Never remove active/recent containers, volumes, quarantined evidence, or backups. | Remove fixture directory. |
| DR-01 | Local backup/restore | Create a fixture backup, enforce retention, verify manifest/hash/secret exclusion, corrupt a copy to prove fail-closed behavior, and restore into a new empty home. | Remove fixture homes. |
| DR-02 | Encrypted S3 bundle | Inspect current production bundle freshness/readability without printing keys. Restore/download the newest encrypted bundle into a private temporary directory, verify checksum/decryption/SQLite integrity, and never overwrite production. | Securely remove the exact temporary restore directory; keep remote bundle. |
| RESILIENCE-01 | Restart/retry/dedup | Interrupt fixture poll, provision, notification, CI, and release stages and retry. SQLite mappings and external identities converge without duplicate run, PR, card, or destructive cleanup. | Remove fixtures. |
| CLEAN-01 | Final residue | Verify local/deployed Git identity, canonical repo cleanliness, no active test run/resource/preview/quarantine, no test tmux/worktree, intended Project statuses, expected PR/branch state, healthy jobs/services, and no temporary rollout directory. | Scenario is incomplete until every check passes. |

## Final owner-only Discord checklist

Perform this only after all autonomous scenarios and fixes are complete:

1. Open `/kurami orchestrator settings` as the configured owner and confirm the
   displayed current values match the report.
2. Confirm the response is ephemeral and a non-owner cannot operate a copied
   component ID.
3. Open two panels; apply a harmless temporary change from the first and confirm
   the second is rejected as stale.
4. Confirm invalid project-WIP/Global-WIP and preview-build/preview-cap
   combinations are rejected with understandable feedback. Confirm AI triage/day
   accepts 0 and 40, rejects 41, and explains that 0 disables proposals only.
5. Undo the temporary change, verify the original values, and confirm one
   secret-free maintenance audit message per successful action.
6. If a disposable run is still available, confirm settings are locked while it
   is non-terminal, then become editable again after cleanup.
