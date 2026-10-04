# Managed Codex protocol lifecycle

This partial release enables private stdio app-server execution only for CI repair and review fix.
Primary writers, successors, human-control and legacy sessions retain their existing TUI path. tmux remains a process supervisor. It has no authority
to declare a protocol turn complete. Structured AI review retains its read-only protocol
path, output schema, GitHub App separation and exact-SHA publication checks, and now persists
the returned turn identity and terminal status as well.

## Verified protocol baseline

Inspection used the installed `codex-cli 0.159.3`, without connecting to its existing daemon.
Both stable and experimental TypeScript bindings were generated in disposable directories:

```sh
codex app-server generate-ts --out /tmp/kurami-codex-stable
codex app-server generate-ts --out /tmp/kurami-codex-protocol --experimental
```

The consumed contract is `initialize` → `initialized` → `thread/start` →
`thread/name/set` → `turn/start`, followed by exact `turn/completed` notifications.
Cancellation uses `turn/interrupt`. Recovery uses `thread/read` without resuming.
The worker explicitly opts into `experimentalApi` for `historyMode: "legacy"`, so stored
turns can be read without paginated-history APIs. Incompatible versions fail closed;
they do not fall back to terminal completion parsing.

The installed bindings define terminal statuses as `completed`, `failed` and
`interrupted`. Errors expose `codexErrorInfo`, including usage limits and variants with
HTTP status codes. Permission requests use an empty permission grant with turn scope.
Unrecognised interactive requests receive an error and stop the task.

Official documentation consulted:

- [App-server protocol](https://learn.chatgpt.com/docs/app-server):
  lifecycle, exact identities, stored reads, interruption, permissions and transport.
- [Codex app-server authentication integration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server):
  initialization and terminal status handling.
- [Remote engineering workflows](https://developers.openai.com/blog/mastering-codex-remote-for-engineering):
  paired hosts, steering and ownership from the mobile application.

These sources describe experimental interfaces. Installed-binding inspection and the real
local smoke test establish this implementation's baseline, not production or mobile compatibility.

## Durable boundaries

`run_codex_tasks` stores the task/run/context identity, exact supervisor, frozen working copy
and branch, thread, turn, terminal status, failure code, stop intent and acknowledged process
exit. A unique unreleased-task constraint prevents a second managed writer for the same run.
`run_codex_task_events` stores the first exact terminal receipt, without prose or tool payloads.

Thread and turn IDs come from their corresponding start replies, rather than a newest-thread
search by directory. A notification arriving before the turn-start reply is buffered, then checked
against the persisted identity. Duplicate and conflicting terminal notifications cannot change
the first receipt. Old-thread, old-turn, changed-resource, Remote-owner and released-task events
have no authority.

The worker runs inside the exact linked worktree with workspace-write, its isolated and common
Git directories, network access and the existing auto-review setting. Its environment strips
unrelated secrets and reviewer App credentials; only the writer token is retained intentionally.
The launcher still validates private credential-file permissions. The model does not receive
writable access to the controller's database or prompt directory.

A completed turn and acknowledged child-process exit permit parking. They do not establish
a commit, push, delivered PR, passed CI or resolved review thread. Existing outcome checks
continue to use the exact resulting SHA and original evidence snapshots. Undelivered review-fix
work keeps its task mapping and writer fence for explicit recovery after delivery.

Controller restarts reuse persisted receipts. Missing workers trigger read-only recovery of
the exact known turn. A recovered terminal event without an exit acknowledgement remains
`needs_attention` with its writer fence intact. A lost start reply is never retried. Unknown
dispatch or process state requires operator recovery; this implementation does not automatically
resume a crashed writer.

Cancellation and runtime expiry ask the worker to interrupt its exact turn and acknowledge
process exit. Failed acknowledgement blocks release. Runtime expiry, external billing/usage
blocks, rate limits, permission denial, interruption and protocol disconnect remain distinct
failure codes. The TUI main-writer default remains 240 minutes. The technical-worker default remains 90 minutes and is passed to the protocol worker.

## Bounded stop diagnostics / Ограниченная диагностика остановки

Migration `038_codex_worker_summary.sql` adds a nullable, maximum-800-character
`run_codex_tasks.final_summary`; existing rows are not backfilled. The first exact
successful `turn/completed` receipt may persist only an `agentMessage` with phase
`final_answer`, from that turn's items or exact `item/completed` notifications. Early
notifications are bounded and checked after the turn-start acknowledgement. Exact
`thread/read` recovery uses only the persisted technical thread and turn; no primary
conversation or newest-thread search is a diagnostic source. Prompts, progress,
command stdout, error prose and echoed orchestrator prompts are excluded. Redaction
precedes truncation; credential-like values, URLs, control characters and Markdown
mentions/markup are removed. Unknown/missing final phase falls back to unavailable.

Read-only status joins the newest task to the newest matching terminal CI attempt
or review-fix round, including run/context/thread provenance and the current attention
receipt's exact task/attempt/round ID. Cleanup-only history is ignored; a later unrelated
failure suppresses the old worker report. It shows the controller
outcome separately from the worker's untrusted report, with task/thread/turn IDs in
run-control JSON. A successful scope refusal is not labelled as a crash; failed or
interrupted workers use their existing protocol discriminant instead. No report is
proof of a commit, push, green CI or release. No eligibility, ownership, attempt
budget or historical incident rows are changed. The migration is repository-only
until an independently approved deployment applies it.

Миграция добавляет итоговый отчёт до 800 символов без заполнения старых строк.
Источник — только финальный ответ точного технического хода; промпты, вывод команд,
ошибки и основной разговор не используются. Очистка секретов предшествует обрезке.
Статусы run-control, Discord и Projects показывают результат контроллера отдельно
от отчёта исполнителя. Отказ без изменений не считается падением; отсутствие отчёта
остаётся явным, а падение сохраняет протокольный код ошибки. Диагностика не меняет
владельца, допустимость действий, бюджет попыток или старые строки инцидента. Диагностика требует точного task/attempt/round ID текущей
причины остановки; служебная история очистки игнорируется, а более поздняя посторонняя
ошибка исключает старый отчёт исполнителя.

CI repair alone now permits minimal compatible published upstream security fixes
and targeted compatible overrides supported by exact failed CI evidence. No fix
available, major upgrades, custom patch/fork, advisory exception/suppression, audit
policy weakening, migrations or security-boundary/secret/permission changes remain
stop conditions. Initial writer, human-control, successor and review-fix policies
are unchanged; same-branch focused commit authorization remains explicit.

Только CI repair разрешает минимальное совместимое опубликованное upstream-исправление
или точечный совместимый override по точным данным упавшего CI. Нет исправления,
major-обновление, собственный патч/форк, исключение advisory, ослабление audit policy,
миграция или изменение границ безопасности, секретов и прав требуют остановки.
Политики остальных режимов не меняются; разрешение focused commit и push в ту же
ветку остаётся явным.

Verification: `npm run test:worker-diagnostics`, `npm run test:codex-protocol`,
`npm run test:ci-repair`, then `npm test`. Tests use disposable stores/worktrees;
never repair or backfill live incident rows to validate diagnostics.

## Remote migration blocker

The installed CLI exposes `remote-control`, daemon management, `app-server proxy` and a
remote terminal client. Their availability does not prove that a thread from an isolated stdio
app-server can be transferred into an already paired mobile Remote host while preserving
process, credential and ownership boundaries.

No public transfer RPC was found in the generated bindings. This task did not start, stop,
pair with, enable or inspect the production daemon or running sessions. Mobile visibility
and same-thread ownership transfer therefore remain unverified, rather than being reported
as implemented or as definitively impossible upstream.

Take control and Continue in Codex remain present. Existing human-control CLI handoff stays
available. For a protocol-created thread, live handoff and parked Remote claim fail explicitly
with `protocol_remote_handoff_unverified`, preserve ownership and record a failed control request.
They do not silently assign `remote` or leave an unsupported request blocking subsequent parking.

Continue autonomously from an existing Remote-owned run remains a fresh successor, requiring
the owner's explicit finished-task confirmation. It never resumes or sends input to the predecessor.
Primary autonomous writers and fresh successors remain on the existing TUI path. Legacy sessions receive no inferred protocol identity and keep terminal completion observation, runtime limits and all existing handoff controls. The guarded TUI parser accepts both `·` and `•` completion-footer separators and rejects busy or approval-blocked tails.
Migration does not backfill or mutate existing production sessions.

A complete interactive migration needs an isolated, authenticated Remote-host integration test:
prove same-thread visibility, interrupt acknowledgement, sole writer ownership, credential
containment and restart behavior before replacing the human-control CLI route.

## Verification

`npm run test:codex-protocol` runs fault fixtures and launcher-to-worker lifecycle integration.
It covers exact completion, early events, stale identities, duplicates/conflicts, failure,
approval/permissions/unknown requests, disconnect, lost acknowledgement, cancellation, timeout,
restart, changed ownership and independent CI outcome checks.

`npm run test:codex-protocol-smoke` starts the real installed binary with a temporary Codex home,
a localhost Responses provider and a disposable linked Git worktree. It completes a turn,
reads its history and replays the receipt. It uses no account credentials, GitHub remote or
GitHub writes, and verifies a clean working copy. It is intentionally separate from the full
regression suite because it requires an installed Codex binary.

The historical `Worked for 50s • 09:50` footer is covered by the legacy completion regression. It has no authority for protocol tasks.

The matching English/Russian human pages are `codex-sessions`, `run-lifecycle` and
`human-control`. No UI components were changed. No production Run Store migration or release
operation was performed.

## Guarded PF33 legacy recovery

Read-only inspection on 2026-10-01 found run `r_367ac0dcb458a2f56692` stopped under
`ci_repair_runtime_budget_exceeded`. Attempt `cra_51fbd62d584245b6a7cf58862dacd015`
started at `2026-10-01T09:49:49.241Z`; the preserved timeout transcript reports
`Worked for 50s • 09:50`, an unchanged worktree and no repair or CI retry. Its actual
block is GitHub account billing or spending limit, not Codex usage billing.
The worktree was clean, and local HEAD, remote-tracking branch and PR #156 all named
`b56b7ce2a7261677d5484e83f0f3eed33a1968f0`.

The existing `recover_managed_task` control recovers delivered review fixes only.
This incident instead uses an explicit, incident-specific CLI. After deployment, first
refresh the normal read-only CI observation. Quiesce controller/launch activity while
checking and applying recovery; the apply transaction fences controller DB claims,
and local process inspection refuses live writers. Do not launch another writer concurrently.
Run the following preview against the operator's configured Kurami home:

```sh
KURAMI_HOME="$KURAMI_HOME" node src/orchestrator/projects/sessions/recover-legacy-ci-timeout.ts --run-id r_367ac0dcb458a2f56692
```

Only after the preview succeeds and the owner approves incident recovery, apply the same guard:

```sh
KURAMI_HOME="$KURAMI_HOME" node src/orchestrator/projects/sessions/recover-legacy-ci-timeout.ts --run-id r_367ac0dcb458a2f56692 --apply
```

The guard pins the run, issue, original request/attempt, both original thread IDs, branch,
source SHA, PR number and URL. It requires a provisioned live-mode run with owner `none`,
no stop intent or supervisor mapping, no pending control or active worker, and no protocol
task for that run. The latest attention event must be the original CI-repair timeout with
its exact runtime identity and transcript path. The original transcript must match SHA-256
`f9201478d3886897e758fbd0e780aa6c53c74708f56228aff1ae657b86c93741`
and contain guarded completion, without an active or approval prompt. The exact canonical
linked worktree must be clean, on the original branch, with both HEAD and remote-tracking
HEAD still at the source SHA. A successful normal CI observation no older than two minutes
must retain the original PR/source SHA and failed CI. The original tmux supervisor must be
absent and no local Codex/app-server writer may use the worktree. Missing process evidence
also refuses recovery.

Apply changes only the run to `parked_review`, the preserved attempt's failure classification
to `legacy_ci_repair_completed_billing_block`, and appends the recovery evidence to history.
The attempt remains `needs_attention`; the source SHA, result SHA (null), snapshots, task
thread and predecessor stay unchanged. The billing blocker remains unresolved. Automatic cleanup refuses this classification, so recovery cannot silently restore the
primary thread or make another repair eligible. Existing explicit `cleanup-repair` remains
available after a separate owner decision; it archives the technical thread and restores
the predecessor through the existing path. Until then, Take control retains its existing
`ci_repair_cleanup_pending` prerequisite. No writer, CI rerun, archive,
thread resume, repair retry or GitHub write occurs. Other attention reasons are refused.
A second apply is refused because the timeout fence no longer matches.

`npm run test:legacy-ci-timeout-recovery` verifies preview immutability, apply behavior,
identity preservation and refusals for cancellation, Remote ownership, other attention reasons,
changed task/source/PR identity, stale CI, competing controls, dirt, changed remote HEAD,
changed transcript, live supervisor and a live detached writer. This preparation did not run
preview/apply against the production store and performed no live recovery.

## Guarded PF33 protocol no-head recovery

The later incident has latest attempt `cra_e4cb3b423e6b478abdfc0b1e93058481` and
protocol task `ct_5d0bfee44e0b4bc7913cdce1069fcc16` on the same PF33 run, PR #156,
branch and source SHA listed above. The owner reports GitHub billing prevented CI
jobs from starting; the completed task produced no edits or commits. The technical
thread is already archived and the predecessor restored. The legacy timeout
command does not cover this task.

After deploying this command, quiesce controller/launcher activity and refresh
normal CI observation. The parent operator performs live recovery under the
owner's incident authorization. Preview against the configured Kurami home:

```sh
node src/orchestrator/projects/sessions/recover-ci-no-new-head.ts --run-id r_367ac0dcb458a2f56692
```

Apply the same checks with explicit mutation:

```sh
node src/orchestrator/projects/sessions/recover-ci-no-new-head.ts --run-id r_367ac0dcb458a2f56692 --apply
```

The CLI accepts only this run and these arguments. Both modes validate:

- Live-mode, provisioned `needs_attention`, owner `none`, no stop/completion intent,
  no supervisor mapping, no successor run, and the restored original predecessor
  with no pending technical-thread cleanup.
- Latest attention reason and state transition `ci_repair_no_new_head`, exact
  attempt/source details, latest allowlisted attempt in `needs_attention`, null result SHA and
  the original no-head failure reason. Exactly two attempts must remain, with no
  active repair. An unexhausted budget refuses recovery rather than exposing retry.
- Exact allowlisted task/run/context, branch, worktree, technical thread and turn;
  successful terminal receipt, acknowledged stop and release, no failure or cancel/
  timeout intent. The protocol parking receipt and archived-thread history must
  agree with the task and restored predecessor.
- No pending/processing control, pending Project status mutation, unreleased task,
  active AI review, review-fix round or autonomous successor. The original tmux
  session and all worktree panes must be absent; the existing fail-closed local
  Codex/app-server writer inspection also runs.
- Clean canonical linked worktree within the configured root, exact branch and
  HTTPS origin, local and remote-tracking HEAD at the source SHA, and read-only
  `git ls-remote` confirmation of the live remote branch.
- A live, open, unmerged GitHub PR with the exact repository, number, URL, head
  branch/SHA and configured base branch. Failed CI observation must match that
  PR/SHA, have no error, and be no older than two minutes (future dates refuse).
- Latest AI review `ready` for that PR/head and the live base SHA, completed without
  failure, with nonempty findings consistent with stored counts. Its native GitHub
  review must still exist, be submitted on the source SHA, match its stored ID/URL
  and remain undismissed. A newer non-ready or wrong-head review refuses recovery.

Apply holds `BEGIN IMMEDIATE` while checking and changes only the run to
`parked_review`, owner `none`, plus its update timestamp. It appends
`protocol_ci_no_new_head_review_recovery` with task/turn/stop/release identities,
archive and prior history sequence, source and base SHAs, PR and ready review IDs,
CI observation time and the owner-reported external billing block. The record
explicitly says `repairRetry: false`. Attempts, failed CI, review findings,
resources, control requests and task events remain unchanged. No migration,
reset, retry, GitHub write, CI job, thread resume or review-fix launch occurs.

Existing reconciliation ignores the terminal attempts; the restored predecessor
needs no automatic cleanup. The preserved two-attempt count fences CI repair,
while existing ready findings and owner-triggered **Fix review** remain available.
The owner must trigger Fix review separately through existing controls and guards.
Repeated preview/apply is an unchanged success only while the same recovery record
is the latest state transition and every current guard still passes. Drift or
another state transition refuses replay. Launchers must stay quiescent because
local process inspection cannot lock out an independently started external writer.

`npm run test:ci-no-head-recovery` uses disposable migrated SQLite and linked Git
fixtures, real protocol receipt/release and CI reconciliation, and the actual
recovery action. GitHub and remote network responses are substituted. It checks
read-only preview, atomic refusals, preservation, guarded replay, no automatic
writer/retry or renewed attention, and existing Fix review planning. Implementation
verification does not constitute live PR validation or incident recovery.
