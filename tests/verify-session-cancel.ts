import { execFileSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

process.umask(0o077);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function main(): Promise<void> {
  const appDirectory = resolve(import.meta.dirname, "..");
  const testHome = await mkdtemp(resolve(tmpdir(), "kurami-session-cancel-"));
  const fakeBin = resolve(testHome, "fake-bin");
  const fakeTmuxState = resolve(testHome, "tmux-alive");
  const fakeTmuxLog = resolve(testHome, "tmux-calls.log");
  const runId = "r_cancel_without_thread";
  const tmuxSession = "cx-tt-9401-cancel";

  try {
    await mkdir(resolve(testHome, "config"), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(fakeBin, { recursive: true, mode: 0o700 });
    await copyFile(
      resolve(appDirectory, "deploy/config/orchestrator.yaml"),
      resolve(testHome, "config/orchestrator.yaml"),
    );
    await copyFile(
      resolve(appDirectory, "deploy/config/projects.yaml"),
      resolve(testHome, "config/projects.yaml"),
    );

    const fakeTmux = resolve(fakeBin, "tmux");
    await writeFile(
      fakeTmux,
      `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$FAKE_TMUX_LOG"
case "$1" in
  has-session)
    test -f "$FAKE_TMUX_STATE"
    ;;
  capture-pane)
    printf '%s\\n' 'Working (1s - esc to interrupt)'
    ;;
  send-keys)
    exit 0
    ;;
  kill-session)
    /bin/rm -f "$FAKE_TMUX_STATE"
    ;;
  *)
    exit 64
    ;;
esac
`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(fakeTmux, 0o700);
    await writeFile(fakeTmuxState, `${tmuxSession}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });

    const env = {
      ...process.env,
      KURAMI_HOME: testHome,
      ORCHESTRATOR_MIGRATIONS_DIR: resolve(appDirectory, "migrations"),
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_TMUX_STATE: fakeTmuxState,
      FAKE_TMUX_LOG: fakeTmuxLog,
    };
    execFileSync(
      process.execPath,
      [resolve(appDirectory, "src/orchestrator/state/init-run-store.ts")],
      { env, stdio: ["ignore", "ignore", "pipe"] },
    );

    const databasePath = resolve(testHome, "state/orchestrator.db");
    const database = new DatabaseSync(databasePath);
    database
      .prepare(
        `
        INSERT INTO project_events (
          event_id, observed_at, project, item_id, content_id, content_type,
          repository, issue_number, title, url, from_status, to_status,
          payload_json, processing_state
        ) VALUES (
          'cancel-event', '2026-08-16T20:44:00.000Z', 'tailortales',
          'cancel-item', 'cancel-content', 'Issue', 'Shagon1k/TailorTales',
          9401, '[Test]: Cancel before thread synchronization',
          'https://example.invalid/issues/9401', 'In progress', 'Human Review',
          '{"issueState":"OPEN","labels":[],"hasDescription":true}',
          'processed'
        )
      `,
      )
      .run();
    database
      .prepare(
        `
        INSERT INTO runs (
          run_id, trigger_event_id, project, item_id, content_id, repository,
          issue_number, interaction_policy, state, owner_state,
          execution_mode, stop_reason
        ) VALUES (
          ?, 'cancel-event', 'tailortales', 'cancel-item', 'cancel-content',
          'Shagon1k/TailorTales', 9401, 'autonomous', 'parked_review',
          'cli', 'live', 'cancelled'
        )
      `,
      )
      .run(runId);
    database
      .prepare(
        `
        INSERT INTO run_resources (
          run_id, resource_state, worktree_path, branch_name,
          codex_thread_id, tmux_session_name
        ) VALUES (
          ?, 'provisioned', '/tmp/worktrees/9401/TailorTales',
          'TT-9401_cancel-before-thread-sync', NULL, ?
        )
      `,
      )
      .run(runId, tmuxSession);
    database.close();

    const stdout = execFileSync(
      process.execPath,
      [
        resolve(appDirectory, "src/orchestrator/projects/sessions/manager.ts"),
        "cancel",
        "--run-id",
        runId,
        "--apply",
      ],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const result = JSON.parse(stdout) as {
      ok: boolean;
      action: string;
      forced: boolean;
      codexThreadId: string | null;
    };
    assert(result.ok, "CLI cancellation did not succeed");
    assert(result.action === "cancelled_cli", "Unexpected cancellation action");
    assert(result.forced, "Unresponsive tmux did not use bounded force-stop");
    assert(
      result.codexThreadId === null,
      "Cancellation unexpectedly required a synchronized Codex thread",
    );
    assert(!(await exists(fakeTmuxState)), "Fake tmux session is still alive");

    const verify = new DatabaseSync(databasePath, { readOnly: true });
    const row = verify
      .prepare(
        `
        SELECT r.state, r.owner_state, r.stop_reason,
               rr.tmux_session_name, rr.codex_thread_id
        FROM runs r
        JOIN run_resources rr USING (run_id)
        WHERE r.run_id = ?
      `,
      )
      .get(runId) as {
      state: string;
      owner_state: string;
      stop_reason: string;
      tmux_session_name: string | null;
      codex_thread_id: string | null;
    };
    const history = verify
      .prepare(
        `
        SELECT reason, details_json
        FROM run_state_history
        WHERE run_id = ?
        ORDER BY sequence DESC
        LIMIT 1
      `,
      )
      .get(runId) as { reason: string; details_json: string };
    verify.close();

    assert(
      row.state === "stopping" &&
        row.owner_state === "none" &&
        row.stop_reason === "cancelled",
      "Run ownership was not safely released after cancellation",
    );
    assert(row.tmux_session_name === null, "tmux mapping was not cleared");
    assert(
      row.codex_thread_id === null,
      "NULL Codex thread ID was not preserved",
    );
    assert(
      history.reason === "codex_cli_cancel_completed",
      "Cancellation history was not recorded",
    );
    const details = JSON.parse(history.details_json) as {
      forced: boolean;
      previousTmuxSessionName: string;
    };
    assert(details.forced, "Forced cancellation was not recorded in history");
    assert(
      details.previousTmuxSessionName === tmuxSession,
      "Cancellation history lost the managed tmux identity",
    );

    const transcriptPath = resolve(
      testHome,
      "logs/session-cancellations",
      `${runId}.txt`,
    );
    assert(
      (await readFile(transcriptPath, "utf8")).includes("Working (1s"),
      "Cancellation transcript was not preserved",
    );
    const calls = await readFile(fakeTmuxLog, "utf8");
    assert(
      calls.includes(`kill-session -t =${tmuxSession}`),
      "Cancellation did not target the exact managed tmux session",
    );

    const completionTmuxSession = "cx-tt-9401-complete";
    await writeFile(fakeTmuxState, `${completionTmuxSession}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    const completionSeed = new DatabaseSync(databasePath);
    completionSeed
      .prepare(
        `UPDATE runs
         SET state = 'stopping', owner_state = 'cli', stop_reason = 'completed'
         WHERE run_id = ?`,
      )
      .run(runId);
    completionSeed
      .prepare(
        `UPDATE run_resources SET tmux_session_name = ? WHERE run_id = ?`,
      )
      .run(completionTmuxSession, runId);
    completionSeed.close();

    const completionStdout = execFileSync(
      process.execPath,
      [
        resolve(appDirectory, "src/orchestrator/projects/sessions/manager.ts"),
        "cancel",
        "--run-id",
        runId,
        "--apply",
      ],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const completionResult = JSON.parse(completionStdout) as {
      ok: boolean;
      action: string;
      forced: boolean;
    };
    assert(completionResult.ok, "CLI completion stop did not succeed");
    assert(
      completionResult.action === "stopped_cli_for_completion",
      "Completed run used cancellation semantics",
    );
    assert(completionResult.forced, "Completed run did not stop its managed tmux");

    const completionVerify = new DatabaseSync(databasePath, { readOnly: true });
    const completionRow = completionVerify
      .prepare(
        `SELECT r.state, r.owner_state, r.stop_reason, rr.tmux_session_name
         FROM runs r JOIN run_resources rr USING (run_id)
         WHERE r.run_id = ?`,
      )
      .get(runId) as {
      state: string;
      owner_state: string;
      stop_reason: string;
      tmux_session_name: string | null;
    };
    const completionHistory = completionVerify
      .prepare(
        `SELECT reason FROM run_state_history
         WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`,
      )
      .get(runId) as { reason: string };
    completionVerify.close();
    assert(
      completionRow.state === "stopping" &&
        completionRow.owner_state === "none" &&
        completionRow.stop_reason === "completed" &&
        completionRow.tmux_session_name === null,
      "Completion stop did not preserve completed intent while releasing CLI ownership",
    );
    assert(
      completionHistory.reason === "codex_cli_completion_stop_completed",
      "Completion stop history was not recorded distinctly",
    );
    const completionTranscriptPath = resolve(
      testHome,
      "logs/session-completions",
      `${runId}.txt`,
    );
    assert(
      (await readFile(completionTranscriptPath, "utf8")).includes("Working (1s"),
      "Completion stop transcript was not preserved",
    );
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        isolated: true,
        cancellationWithoutThreadId: true,
        reviewRaceRecovered: true,
        boundedForceStop: true,
        exactManagedSessionOnly: true,
        transcriptPreserved: true,
        final: {
          state: row.state,
          owner_state: row.owner_state,
          stop_reason: row.stop_reason,
        },
      })}\n`,
    );
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
