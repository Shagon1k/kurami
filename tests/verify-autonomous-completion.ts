import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

process.umask(0o077);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runController(
  controllerPath: string,
  env: NodeJS.ProcessEnv,
  apply = false,
): { plans?: Array<Record<string, unknown>>; results?: Array<Record<string, unknown>> } {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [controllerPath, ...(apply ? ["--apply"] : [])],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    ),
  ) as {
    plans?: Array<Record<string, unknown>>;
    results?: Array<Record<string, unknown>>;
  };
}

async function main(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const home = await mkdtemp(resolve(tmpdir(), "kurami-autonomous-completion-"));
  const fakeBin = resolve(home, "fake-bin");
  const completeAlive = resolve(home, "complete-alive");
  const activeAlive = resolve(home, "active-alive");
  const approvalAlive = resolve(home, "approval-alive");
  const stuckAlive = resolve(home, "stuck-alive");
  const ghCalls = resolve(home, "gh-calls.log");
  const tmuxCalls = resolve(home, "tmux-calls.log");
  try {
    await mkdir(resolve(home, "config"), { recursive: true, mode: 0o700 });
    await mkdir(fakeBin, { recursive: true, mode: 0o700 });
    await copyFile(
      resolve(app, "deploy/config/orchestrator.yaml"),
      resolve(home, "config/orchestrator.yaml"),
    );
    await copyFile(
      resolve(app, "deploy/config/projects.yaml"),
      resolve(home, "config/projects.yaml"),
    );
    await writeFile(completeAlive, "alive\n", { mode: 0o600 });
    await writeFile(activeAlive, "alive\n", { mode: 0o600 });
    await writeFile(approvalAlive, "alive\n", { mode: 0o600 });
    await writeFile(stuckAlive, "alive\n", { mode: 0o600 });
    await writeFile(ghCalls, "", { mode: 0o600 });
    await writeFile(tmuxCalls, "", { mode: 0o600 });

    const fakeTmux = resolve(fakeBin, "tmux");
    await writeFile(
      fakeTmux,
      `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FAKE_TMUX_CALLS"
case "$1" in
  has-session)
    case "$*" in
      *cx-tt-201-complete*) test -f "$FAKE_COMPLETE_ALIVE" ;;
      *cx-tt-202-active*) test -f "$FAKE_ACTIVE_ALIVE" ;;
      *cx-tt-203-approval*) test -f "$FAKE_APPROVAL_ALIVE" ;;
      *cx-tt-204-stuck*) test -f "$FAKE_STUCK_ALIVE" ;;
      *) exit 1 ;;
    esac
    ;;
  capture-pane)
    case "$*" in
      *cx-tt-201-complete*)
        printf '%s\n' 'Implemented and verified the focused change.' \
          '─ Worked for 2m 10s ─' \
          '› Ask Codex to do anything'
        ;;
      *cx-tt-202-active*)
        printf '%s\n' 'Quoted terminal example:' \
          '─ Worked for 1m 00s ─' \
          '› Ask Codex to do anything' \
          'Working (12s • esc to interrupt)'
        ;;
      *cx-tt-203-approval*)
        printf '%s\n' 'Implemented and verified the focused change.' \
          '─ Worked for 1m 00s ─' \
          '› Ask Codex to do anything' \
          'Would you like to run this command?'
        ;;
      *cx-tt-204-stuck*)
        printf '%s\n' 'Implemented and verified the focused change.' \
          '─ Worked for 1m 20s ─' \
          '› Ask Codex to do anything'
        ;;
      *) exit 1 ;;
    esac
    ;;
  send-keys)
    case "$*" in
      *cx-tt-201-complete*C-d*) /bin/rm -f "$FAKE_COMPLETE_ALIVE" ;;
    esac
    ;;
  kill-session)
    case "$*" in
      *cx-tt-201-complete*) /bin/rm -f "$FAKE_COMPLETE_ALIVE" ;;
      *cx-tt-204-stuck*) : ;;
    esac
    ;;
  *) exit 64 ;;
esac
`,
      { mode: 0o700 },
    );
    await chmod(fakeTmux, 0o700);

    const fakeGh = resolve(fakeBin, "gh");
    await writeFile(
      fakeGh,
      `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FAKE_GH_CALLS"
case "$*" in
  *mutation*)
    printf '%s\n' '{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"item-complete"}}}}'
    ;;
  *)
    printf '%s\n' '{"data":{"user":{"projectV2":{"id":"project-id","field":{"id":"status-field","options":[{"id":"review-option","name":"Human Review"}]}}}}}'
    ;;
esac
`,
      { mode: 0o700 },
    );
    await chmod(fakeGh, 0o700);

    const env = {
      ...process.env,
      KURAMI_HOME: home,
      ORCHESTRATOR_MIGRATIONS_DIR: resolve(app, "migrations"),
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_COMPLETE_ALIVE: completeAlive,
      FAKE_ACTIVE_ALIVE: activeAlive,
      FAKE_APPROVAL_ALIVE: approvalAlive,
      FAKE_STUCK_ALIVE: stuckAlive,
      FAKE_GH_CALLS: ghCalls,
      FAKE_TMUX_CALLS: tmuxCalls,
    };
    execFileSync(
      process.execPath,
      [resolve(app, "src/orchestrator/state/init-run-store.ts")],
      { env, stdio: ["ignore", "ignore", "pipe"] },
    );

    const databasePath = resolve(home, "state/orchestrator.db");
    const database = new DatabaseSync(databasePath);
    const addRun = (
      suffix: "complete" | "active" | "approval" | "stuck",
      issueNumber: number,
      sessionName: string,
    ): void => {
      database
        .prepare(
          `INSERT INTO project_events (
             event_id, observed_at, project, item_id, content_id, content_type,
             repository, issue_number, title, url, from_status, to_status,
             payload_json, processing_state
           ) VALUES (?, '2026-09-22T00:00:00.000Z', 'tailortales', ?, ?, 'Issue',
             'Shagon1k/TailorTales', ?, ?, ?, 'Backlog', 'In progress', '{}',
             'processed')`,
        )
        .run(
          `event-${suffix}`,
          `item-${suffix}`,
          `content-${suffix}`,
          issueNumber,
          `Autonomous ${suffix}`,
          `https://example.invalid/issues/${issueNumber}`,
        );
      database
        .prepare(
          `INSERT INTO project_items (
             project, item_id, content_id, content_type, repository,
             issue_number, title, url, status, first_seen_at, last_seen_at
           ) VALUES ('tailortales', ?, ?, 'Issue', 'Shagon1k/TailorTales', ?,
             ?, ?, 'In progress', '2026-09-22T00:00:00.000Z',
             '2026-09-22T00:00:00.000Z')`,
        )
        .run(
          `item-${suffix}`,
          `content-${suffix}`,
          issueNumber,
          `Autonomous ${suffix}`,
          `https://example.invalid/issues/${issueNumber}`,
        );
      database
        .prepare(
          `INSERT INTO runs (
             run_id, trigger_event_id, project, item_id, content_id, repository,
             issue_number, interaction_policy, state, owner_state, execution_mode
           ) VALUES (?, ?, 'tailortales', ?, ?, 'Shagon1k/TailorTales', ?,
             'autonomous', 'running', 'cli', 'live')`,
        )
        .run(
          `r_${suffix}`,
          `event-${suffix}`,
          `item-${suffix}`,
          `content-${suffix}`,
          issueNumber,
        );
      database
        .prepare(
          `INSERT INTO run_resources (
             run_id, resource_state, worktree_path, branch_name,
             codex_thread_id, tmux_session_name
           ) VALUES (?, 'provisioned', ?, ?, ?, ?)`,
        )
        .run(
          `r_${suffix}`,
          `/tmp/worktrees/${issueNumber}/TailorTales`,
          `TT-${issueNumber}_${suffix}`,
          `thread-${suffix}`,
          sessionName,
        );
    };
    addRun("complete", 201, "cx-tt-201-complete");
    addRun("active", 202, "cx-tt-202-active");
    addRun("approval", 203, "cx-tt-203-approval");
    addRun("stuck", 204, "cx-tt-204-stuck");
    database.close();

    const controllerPath = resolve(app, "src/orchestrator/runtime/controller.ts");
    let prematureReviewFailure = "";
    try {
      execFileSync(
        process.execPath,
        [
          resolve(app, "src/orchestrator/projects/project-status.ts"),
          "review",
          "--run-id",
          "r_complete",
          "--apply",
        ],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      prematureReviewFailure =
        (error as { stderr?: string }).stderr ?? String(error);
    }
    assert(
      prematureReviewFailure.includes("not a released autonomous completion"),
      "Project status boundary accepted a CLI-owned completion",
    );
    assert(
      (await readFile(ghCalls, "utf8")) === "",
      "Rejected CLI-owned review writeback called GitHub",
    );

    const plan = runController(controllerPath, env);
    assert(
      plan.plans?.some(
        (entry) => entry.runId === "r_complete" && entry.action === "park",
      ),
      "New terminal UI completion was not scheduled to park",
    );
    assert(
      !plan.plans?.some((entry) => entry.runId === "r_active"),
      "An active completion-like transcript was scheduled to park",
    );
    assert(
      !plan.plans?.some((entry) => entry.runId === "r_approval"),
      "An approval-blocked completion-like transcript was scheduled to park",
    );

    const applied = runController(controllerPath, env, true);
    assert(
      applied.results?.some(
        (entry) =>
          entry.runId === "r_complete" &&
          entry.action === "park" &&
          entry.status === "applied",
      ),
      "Completed autonomous run was not parked",
    );
    assert(
      !applied.results?.some((entry) => entry.runId === "r_active"),
      "Active autonomous run was acted on",
    );
    assert(
      !applied.results?.some((entry) => entry.runId === "r_approval"),
      "Approval-blocked autonomous run was acted on",
    );
    assert(
      applied.results?.some(
        (entry) =>
          entry.runId === "r_stuck" &&
          entry.action === "park" &&
          entry.status === "deferred",
      ),
      "A tmux release failure was not surfaced",
    );

    const interim = new DatabaseSync(databasePath, { readOnly: true });
    const interimRows = interim
      .prepare(
        `SELECT r.run_id, r.state, r.owner_state, pi.status,
                rr.tmux_session_name
         FROM runs r
         JOIN run_resources rr USING (run_id)
         JOIN project_items pi ON pi.project=r.project AND pi.item_id=r.item_id
         ORDER BY r.run_id`,
      )
      .all() as Array<{
      run_id: string;
      state: string;
      owner_state: string;
      status: string;
      tmux_session_name: string | null;
    }>;
    interim.close();
    const interimComplete = interimRows.find((row) => row.run_id === "r_complete");
    const interimStuck = interimRows.find((row) => row.run_id === "r_stuck");
    assert(
      interimComplete?.state === "parked_review" &&
        interimComplete.owner_state === "none" &&
        interimComplete.tmux_session_name === null &&
        interimComplete.status === "In progress",
      "Project moved before the completed CLI session was durably released",
    );
    assert(
      interimStuck?.state === "running" &&
        interimStuck.owner_state === "cli" &&
        interimStuck.tmux_session_name === "cx-tt-204-stuck" &&
        interimStuck.status === "In progress",
      "A failed tmux release advanced the run or Project status",
    );
    assert(
      (await readFile(ghCalls, "utf8")) === "",
      "The release pass called the GitHub Project boundary",
    );

    const unsafeTmuxEffectsBefore = (await readFile(tmuxCalls, "utf8"))
      .split("\n")
      .filter((line) => /^(?:send-keys|kill-session)\b/u.test(line)).length;
    let activeParkFailure = "";
    try {
      execFileSync(
        process.execPath,
        [
          resolve(app, "src/orchestrator/projects/sessions/manager.ts"),
          "park",
          "--run-id",
          "r_active",
          "--apply",
        ],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      activeParkFailure = (error as { stderr?: string }).stderr ?? String(error);
    }
    assert(
      activeParkFailure.includes("turn is still active"),
      "Session manager did not independently reject the active false positive",
    );
    let approvalParkFailure = "";
    try {
      execFileSync(
        process.execPath,
        [
          resolve(app, "src/orchestrator/projects/sessions/manager.ts"),
          "park",
          "--run-id",
          "r_approval",
          "--apply",
        ],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      approvalParkFailure = (error as { stderr?: string }).stderr ?? String(error);
    }
    assert(
      approvalParkFailure.includes("waiting for approval"),
      "Session manager did not independently reject the approval-blocked tail",
    );
    const unsafeTmuxEffectsAfter = (await readFile(tmuxCalls, "utf8"))
      .split("\n")
      .filter((line) => /^(?:send-keys|kill-session)\b/u.test(line)).length;
    assert(
      unsafeTmuxEffectsAfter === unsafeTmuxEffectsBefore,
      "An unsafe completion-like tail caused tmux sends or kills",
    );
    assert(
      (await readFile(ghCalls, "utf8")) === "",
      "An unsafe completion-like tail caused a Project mutation",
    );

    const reviewPlan = runController(controllerPath, env);
    assert(
      reviewPlan.plans?.some(
        (entry) => entry.runId === "r_complete" && entry.action === "project_review",
      ),
      "Released autonomous completion was not scheduled for Project review writeback",
    );
    const reviewApplied = runController(controllerPath, env, true);
    assert(
      reviewApplied.results?.some(
        (entry) =>
          entry.runId === "r_complete" &&
          entry.action === "project_review" &&
          entry.status === "applied",
      ),
      "Released autonomous completion was not moved to Human Review",
    );

    const verify = new DatabaseSync(databasePath, { readOnly: true });
    const rows = verify
      .prepare(
        `SELECT r.run_id, r.state, r.owner_state, pi.status,
                rr.tmux_session_name
         FROM runs r
         JOIN run_resources rr USING (run_id)
         JOIN project_items pi ON pi.project=r.project AND pi.item_id=r.item_id
         ORDER BY r.run_id`,
      )
      .all() as Array<{
      run_id: string;
      state: string;
      owner_state: string;
      status: string;
      tmux_session_name: string | null;
    }>;
    const completionHistory = Number(
      (
        verify
          .prepare(
            `SELECT COUNT(*) AS count FROM run_state_history
             WHERE run_id='r_complete' AND reason IN (
               'autonomous_completion_moved_to_human_review',
               'codex_cli_park_completed'
             )`,
          )
          .get() as { count: number }
      ).count,
    );
    verify.close();
    const complete = rows.find((row) => row.run_id === "r_complete");
    const active = rows.find((row) => row.run_id === "r_active");
    const approval = rows.find((row) => row.run_id === "r_approval");
    assert(
      complete?.state === "parked_review" &&
        complete.owner_state === "none" &&
        complete.status === "Human Review" &&
        complete.tmux_session_name === null &&
        completionHistory === 2,
      "Completed run, Project status, and durable ownership did not converge",
    );
    assert(
      active?.state === "running" &&
        active.owner_state === "cli" &&
        active.status === "In progress" &&
        active.tmux_session_name === "cx-tt-202-active",
      "Active false-positive fixture was mutated",
    );
    assert(
      approval?.state === "running" &&
        approval.owner_state === "cli" &&
        approval.status === "In progress" &&
        approval.tmux_session_name === "cx-tt-203-approval",
      "Approval-blocked false-positive fixture was mutated",
    );
    const calls = await readFile(ghCalls, "utf8");
    assert(
      (calls.match(/updateProjectV2ItemFieldValue/gu) ?? []).length === 1,
      "GitHub Project was not mutated exactly once for the completed run",
    );

    process.stdout.write(
      `${JSON.stringify({ ok: true, newTerminalFormat: true, activeFalsePositiveRejected: true, approvalFalsePositiveRejected: true, releaseFailureSafe: true, twoStageOrdering: true, projectAndRunConverged: true, cliReleased: true })}\n`,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
