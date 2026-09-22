import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  inspectRuntimeBudgets,
  recordRuntimeTimeout,
  shouldDeferCompletedMainWriter,
  stopManagedRuntime,
  type RuntimeBudgetConfig,
} from "../src/orchestrator/projects/sessions/runtime-budget.ts";

const root = await mkdtemp(resolve(tmpdir(), "kurami-runtime-budget-test-"));
const databasePath = resolve(root, "orchestrator.db");
const database = new DatabaseSync(databasePath);
const originalPath = process.env.PATH;
const config: RuntimeBudgetConfig = {
  version: 1,
  mode: "live",
  limits: {
    main_writer_timeout_minutes: 240,
    technical_worker_timeout_minutes: 90,
  },
};

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

try {
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE runs (
      run_id TEXT PRIMARY KEY, state TEXT NOT NULL, owner_state TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT '2026-08-21T00:00:00.000Z'
    );
    CREATE TABLE run_resources (
      run_id TEXT PRIMARY KEY REFERENCES runs(run_id),
      tmux_session_name TEXT, worktree_path TEXT, branch_name TEXT,
      codex_thread_id TEXT, previous_codex_thread_id TEXT,
      updated_at TEXT NOT NULL DEFAULT '2026-08-21T00:00:00.000Z'
    );
    CREATE TABLE run_state_history (
      sequence INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(run_id),
      from_state TEXT, to_state TEXT NOT NULL, reason TEXT NOT NULL,
      details_json TEXT, occurred_at TEXT NOT NULL
        DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE run_ci_repair_attempts (
      attempt_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(run_id),
      attempt_state TEXT NOT NULL, failure_reason TEXT, created_at TEXT NOT NULL,
      updated_at TEXT, completed_at TEXT
    );
    CREATE TABLE run_review_fix_rounds (
      round_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(run_id),
      round_state TEXT NOT NULL, failure_reason TEXT, created_at TEXT NOT NULL,
      updated_at TEXT, completed_at TEXT
    );
    CREATE TABLE run_ai_reviews (
      review_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(run_id),
      review_state TEXT NOT NULL, failure_reason TEXT,
      tmux_session_name TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT, completed_at TEXT
    );
    CREATE TABLE run_autonomous_successions (
      succession_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(run_id),
      succession_state TEXT NOT NULL, tmux_session_name TEXT,
      failure_reason TEXT, created_at TEXT NOT NULL,
      updated_at TEXT, completed_at TEXT
    );

    INSERT INTO runs (run_id,state,owner_state) VALUES ('r_main','running','cli');
    INSERT INTO run_resources VALUES (
      'r_main','cx-main','/work/main','codex/main','thread-main',NULL,
      '2026-08-21T00:00:00.000Z'
    );
    INSERT INTO run_state_history (
      run_id,from_state,to_state,reason,details_json,occurred_at
    ) VALUES (
      'r_main','starting','running','codex_initial_turn_started','{}',
      '2026-08-21T06:00:00.000Z'
    );

    INSERT INTO runs (run_id,state,owner_state) VALUES ('r_repair','parked_review','cli');
    INSERT INTO run_resources VALUES (
      'r_repair','cx-repair','/work/repair','codex/repair','thread-fix','thread-main',
      '2026-08-21T00:00:00.000Z'
    );
    INSERT INTO run_ci_repair_attempts VALUES (
      'cra_1','r_repair','running',NULL,'2026-08-21T08:20:00.000Z',NULL,NULL
    );

    INSERT INTO runs (run_id,state,owner_state) VALUES ('r_review','parked_review','none');
    INSERT INTO run_resources VALUES (
      'r_review',NULL,'/work/review','codex/review','thread-review',NULL,
      '2026-08-21T00:00:00.000Z'
    );
    INSERT INTO run_ai_reviews VALUES (
      'air_1','r_review','running',NULL,'rv-review',
      '2026-08-21T08:31:00.000Z',NULL,NULL
    );

    INSERT INTO runs (run_id,state,owner_state) VALUES ('r_fix','parked_review','cli');
    INSERT INTO run_resources VALUES (
      'r_fix','cx-fix','/work/fix','codex/fix','thread-fix','thread-main',
      '2026-08-21T00:00:00.000Z'
    );
    INSERT INTO run_review_fix_rounds VALUES (
      'rfr_1','r_fix','running',NULL,'2026-08-21T08:00:00.000Z',NULL,NULL
    );

    INSERT INTO runs (run_id,state,owner_state) VALUES ('r_ai_old','parked_review','none');
    INSERT INTO run_resources VALUES (
      'r_ai_old',NULL,'/work/ai','codex/ai','thread-ai',NULL,
      '2026-08-21T00:00:00.000Z'
    );
    INSERT INTO run_ai_reviews VALUES (
      'air_2','r_ai_old','running',NULL,'rv-ai-old',
      '2026-08-21T08:00:00.000Z',NULL,NULL
    );
  `);

  const inspection = inspectRuntimeBudgets(
    database,
    config,
    Date.parse("2026-08-21T10:00:00.000Z"),
  );
  assert(inspection.warnings.length === 0, "Unexpected timestamp warning");
  assert(inspection.plans.length === 4, "Expected four overdue runtime kinds");
  assert(
    inspection.plans.map((plan) => plan.kind).join(",") ===
      "main_writer,ai_review,review_fix,ci_repair",
    `Unexpected timeout plans: ${JSON.stringify(inspection.plans)}`,
  );

  const main = inspection.plans[0]!;
  const completedTerminal = [
    "Completed the bounded delivery.",
    "─ Worked for 4h 01m ─",
    "› Ask Codex to do anything",
  ].join("\n");
  assert(
    shouldDeferCompletedMainWriter(main, completedTerminal),
    "A completed main writer should be deferred to the controller, not timed out",
  );
  assert(
    !shouldDeferCompletedMainWriter(
      main,
      `${completedTerminal}\nWorking (1s • esc to interrupt)`,
    ),
    "An active main writer must not bypass its runtime budget",
  );
  const fakeBin = resolve(root, "bin");
  const fakeState = resolve(root, "tmux-alive");
  await mkdir(fakeBin, { recursive: true });
  await writeFile(
    resolve(fakeBin, "tmux"),
    `#!/bin/sh
set -eu
state="$KURAMI_FAKE_TMUX_STATE"
case "$1" in
  has-session) test -f "$state" ;;
  capture-pane) printf 'runtime transcript evidence\\n' ;;
  send-keys)
    for arg in "$@"; do
      if [ "$arg" = "Enter" ]; then rm -f "$state"; fi
    done
    ;;
  kill-session) rm -f "$state" ;;
  *) exit 64 ;;
esac
`,
    { mode: 0o700 },
  );
  await chmod(resolve(fakeBin, "tmux"), 0o700);
  await writeFile(fakeState, "alive\n", { mode: 0o600 });
  process.env.PATH = `${fakeBin}:${originalPath ?? ""}`;
  process.env.KURAMI_FAKE_TMUX_STATE = fakeState;
  const stopEvidence = await stopManagedRuntime(main);
  assert(stopEvidence.tmuxAliveAtStart, "Managed session was not detected");
  assert(!stopEvidence.forced, "Graceful exit was unexpectedly forced");
  assert(
    stopEvidence.transcript.includes("runtime transcript evidence"),
    "Terminal evidence was not captured",
  );
  recordRuntimeTimeout(database, main, {
    tmuxAliveAtStart: stopEvidence.tmuxAliveAtStart,
    forced: stopEvidence.forced,
    terminalTailPath: resolve(root, "main.txt"),
  });
  const mainState = database
    .prepare(
      `SELECT r.state, r.owner_state, rr.tmux_session_name,
              rr.worktree_path, rr.branch_name, rr.codex_thread_id
       FROM runs r JOIN run_resources rr USING (run_id) WHERE r.run_id='r_main'`,
    )
    .get() as Record<string, unknown>;
  assert(mainState.state === "needs_attention", "Main writer was not parked");
  assert(mainState.owner_state === "none", "Main writer ownership was not released");
  assert(mainState.tmux_session_name === null, "Main tmux mapping was not cleared");
  assert(mainState.worktree_path === "/work/main", "Main worktree was not preserved");
  assert(mainState.branch_name === "codex/main", "Main branch was not preserved");
  assert(mainState.codex_thread_id === "thread-main", "Main thread was not preserved");

  const aiReview = inspection.plans.find((plan) => plan.kind === "ai_review")!;
  recordRuntimeTimeout(database, aiReview, {
    tmuxAliveAtStart: true,
    forced: false,
    terminalTailPath: resolve(root, "ai-review.txt"),
  });
  const aiState = database
    .prepare(
      `SELECT r.state, rr.worktree_path, ar.review_state, ar.failure_reason
       FROM runs r JOIN run_resources rr USING (run_id)
       JOIN run_ai_reviews ar USING (run_id) WHERE r.run_id='r_ai_old'`,
    )
    .get() as Record<string, unknown>;
  assert(aiState.state === "needs_attention", "AI review run was not parked");
  assert(aiState.review_state === "failed", "AI review was not failed safely");
  assert(aiState.worktree_path === "/work/ai", "AI review worktree was not preserved");

  const reviewFix = inspection.plans.find((plan) => plan.kind === "review_fix")!;
  recordRuntimeTimeout(database, reviewFix, {
    tmuxAliveAtStart: true,
    forced: false,
    terminalTailPath: resolve(root, "review-fix.txt"),
  });
  const fixState = database
    .prepare(
      `SELECT r.state, rr.worktree_path, rr.previous_codex_thread_id,
              f.round_state, f.failure_reason
       FROM runs r JOIN run_resources rr USING (run_id)
       JOIN run_review_fix_rounds f USING (run_id) WHERE r.run_id='r_fix'`,
    )
    .get() as Record<string, unknown>;
  assert(fixState.state === "needs_attention", "Review-fix run was not parked");
  assert(fixState.round_state === "needs_attention", "Review-fix round was not parked");
  assert(fixState.worktree_path === "/work/fix", "Review-fix worktree was not preserved");

  const repair = inspection.plans.find((plan) => plan.kind === "ci_repair")!;
  recordRuntimeTimeout(database, repair, {
    tmuxAliveAtStart: true,
    forced: true,
    terminalTailPath: resolve(root, "repair.txt"),
  });
  const repairState = database
    .prepare(
      `SELECT r.state, r.owner_state, rr.tmux_session_name,
              rr.worktree_path, rr.previous_codex_thread_id,
              a.attempt_state, a.failure_reason
       FROM runs r JOIN run_resources rr USING (run_id)
       JOIN run_ci_repair_attempts a USING (run_id)
       WHERE r.run_id='r_repair'`,
    )
    .get() as Record<string, unknown>;
  assert(repairState.state === "needs_attention", "Repair run was not parked");
  assert(repairState.attempt_state === "needs_attention", "Repair attempt was not parked");
  assert(repairState.failure_reason === "runtime_budget_exceeded", "Repair reason missing");
  assert(repairState.worktree_path === "/work/repair", "Repair worktree was not preserved");
  assert(repairState.previous_codex_thread_id === "thread-main", "Main thread reference was lost");
  const history = database
    .prepare(
      `SELECT reason, details_json FROM run_state_history
       WHERE run_id='r_repair' ORDER BY sequence DESC LIMIT 1`,
    )
    .get() as { reason: string; details_json: string };
  assert(
    history.reason === "ci_repair_runtime_budget_exceeded",
    "Repair timeout history missing",
  );
  assert(
    JSON.parse(history.details_json).preserved.includes("worktree"),
    "Preservation evidence missing",
  );
  const underBudget = database
    .prepare(
      `SELECT review_state FROM run_ai_reviews WHERE review_id='air_1'`,
    )
    .get() as { review_state: string };
  assert(
    underBudget.review_state === "running",
    "Under-budget AI review was changed",
  );

  await readFile(databasePath);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      isolated: true,
      mainWriterTimeoutMinutes: 240,
      technicalWorkerTimeoutMinutes: 90,
      overdueKinds: inspection.plans.map((plan) => plan.kind),
      underBudgetAiReviewPreserved: true,
      worktreeBranchAndThreadsPreserved: true,
      exactTmuxMappingReleased: true,
      gracefulStopVerified: true,
      terminalEvidenceCaptured: true,
      needsAttentionRecorded: true,
    })}\n`,
  );
} finally {
  process.env.PATH = originalPath;
  delete process.env.KURAMI_FAKE_TMUX_STATE;
  database.close();
  await rm(root, { recursive: true, force: true });
}
