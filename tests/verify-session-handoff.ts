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
  const testHome = await mkdtemp(resolve(tmpdir(), "kurami-handoff-test-"));
  const fakeBin = resolve(testHome, "fake-bin");
  const fakeTmuxState = resolve(testHome, "tmux-alive");
  const fakeTmuxBusyState = resolve(testHome, "tmux-busy");
  const fakeTmuxLog = resolve(testHome, "tmux-calls.log");
  const runId = "r_review_handoff_race";
  const tmuxSession = "cx-tt-9501-handoff";
  const threadId = "01a00f08-7cd7-7e90-b710-5125e5425016";

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
    if test -f "$FAKE_TMUX_BUSY_STATE"; then
      printf '%s\\n' 'Working (4m 00s - esc to interrupt)'
    else
      printf '%s\\n' 'Conversation interrupted. Type a new instruction.' '› Implement {feature}'
    fi
    ;;
  send-keys)
    case "$*" in
      *Escape*) /bin/rm -f "$FAKE_TMUX_BUSY_STATE" ;;
      *C-d*) /bin/rm -f "$FAKE_TMUX_STATE" ;;
    esac
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
    await writeFile(fakeTmuxBusyState, `${tmuxSession}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });

    const env = {
      ...process.env,
      KURAMI_HOME: testHome,
      ORCHESTRATOR_MIGRATIONS_DIR: resolve(appDirectory, "migrations"),
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_TMUX_STATE: fakeTmuxState,
      FAKE_TMUX_BUSY_STATE: fakeTmuxBusyState,
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
          'handoff-event', '2026-08-17T09:24:00.000Z', 'tailortales',
          'handoff-item', 'handoff-content', 'Issue', 'Shagon1k/TailorTales',
          9501, '[Test]: Review transition during handoff',
          'https://example.invalid/issues/9501', 'In progress', 'Human Review',
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
          issue_number, interaction_policy, state, owner_state, execution_mode
        ) VALUES (
          ?, 'handoff-event', 'tailortales', 'handoff-item', 'handoff-content',
          'Shagon1k/TailorTales', 9501, 'autonomous', 'parked_review',
          'cli', 'live'
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
        ) VALUES (?, 'provisioned', '/tmp/worktrees/9501/TailorTales',
                  'TT-9501_handoff-race', ?, ?)
      `,
      )
      .run(runId, threadId, tmuxSession);
    database.close();

    const stdout = execFileSync(
      process.execPath,
      [
        resolve(appDirectory, "src/orchestrator/projects/sessions/manager.ts"),
        "handoff",
        "--run-id",
        runId,
        "--apply",
      ],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const result = JSON.parse(stdout) as {
      ok: boolean;
      toState: string;
      toOwner: string;
      busy: boolean;
      initialBusy: boolean;
      interruptedTurn: boolean;
    };
    assert(result.ok, "Handoff did not succeed");
    assert(result.toState === "remote_owned", "Handoff preserved parked_review");
    assert(result.toOwner === "remote", "Handoff did not assign remote owner");
    assert(result.initialBusy, "Busy fake session was not detected");
    assert(!result.busy, "Interrupted fake session remained busy");
    assert(result.interruptedTurn, "Active turn was not interrupted for takeover");
    assert(!(await exists(fakeTmuxState)), "Managed tmux session is still alive");

    const verify = new DatabaseSync(databasePath, { readOnly: true });
    const row = verify
      .prepare(
        `
        SELECT r.state, r.owner_state, rr.tmux_session_name,
               rr.codex_thread_id
        FROM runs r
        JOIN run_resources rr USING (run_id)
        WHERE r.run_id = ?
      `,
      )
      .get(runId) as {
      state: string;
      owner_state: string;
      tmux_session_name: string | null;
      codex_thread_id: string;
    };
    const history = verify
      .prepare(
        `
        SELECT reason, to_state
        FROM run_state_history
        WHERE run_id = ?
        ORDER BY sequence DESC
        LIMIT 1
      `,
      )
      .get(runId) as { reason: string; to_state: string };
    verify.close();

    assert(
      row.state === "remote_owned" && row.owner_state === "remote",
      "Durable handoff state is not remote_owned/remote",
    );
    assert(row.tmux_session_name === null, "tmux mapping was not cleared");
    assert(row.codex_thread_id === threadId, "Codex thread ID was lost");
    assert(
      history.reason === "codex_cli_handoff_completed" &&
        history.to_state === "remote_owned",
      "Handoff history did not record the normalized state",
    );
    assert(
      (await readFile(fakeTmuxLog, "utf8")).includes("Escape"),
      "Handoff did not request the normal Codex interrupt",
    );
    assert(
      (await readFile(fakeTmuxLog, "utf8")).includes("C-d"),
      "Handoff did not close the managed CLI session after interruption",
    );

    process.stdout.write(
      `${JSON.stringify({ ok: true, isolated: true, reviewRaceNormalized: true, boundedInterrupt: true, remoteOwned: true, tmuxReleased: true })}\n`,
    );
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
}

await main();
