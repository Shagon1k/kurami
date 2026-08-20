import { execFileSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function git(directory: string, args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function main(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const home = await realpath(
    await mkdtemp(resolve(tmpdir(), "kurami-session-start-")),
  );
  const fakeBin = resolve(home, "fake-bin");
  const fakeTmuxState = resolve(home, "tmux-alive");
  const fakeTmuxLog = resolve(home, "tmux-calls.log");
  const worktreeRoot = resolve(home, "worktrees/tailortales");
  const worktree = resolve(worktreeRoot, "117/TailorTales");
  const canonical = resolve(home, "repositories/TailorTales");
  const runId = "r_initial_start";

  try {
    await mkdir(resolve(home, "config"), { recursive: true, mode: 0o700 });
    await mkdir(fakeBin, { recursive: true, mode: 0o700 });
    await mkdir(worktree, { recursive: true, mode: 0o700 });
    await copyFile(
      resolve(app, "deploy/config/orchestrator.yaml"),
      resolve(home, "config/orchestrator.yaml"),
    );
    let projects = await readFile(
      resolve(app, "deploy/config/projects.yaml"),
      "utf8",
    );
    projects = projects
      .replace("/home/shagon1k/_projects/TailorTales", canonical)
      .replace(
        "/home/shagon1k/_projects/.worktrees/tailortales",
        worktreeRoot,
      );
    await writeFile(resolve(home, "config/projects.yaml"), projects, {
      mode: 0o600,
    });

    git(worktree, ["init", "-b", "TT-117_initial-start"]);
    git(worktree, ["config", "user.email", "start-test@example.invalid"]);
    git(worktree, ["config", "user.name", "Initial Start Test"]);
    await writeFile(resolve(worktree, "README.md"), "initial start fixture\n");
    git(worktree, ["add", "README.md"]);
    git(worktree, ["commit", "-m", "fixture"]);
    const baseSha = git(worktree, ["rev-parse", "HEAD"]);

    const fakeTmux = resolve(fakeBin, "tmux");
    await writeFile(
      fakeTmux,
      `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FAKE_TMUX_LOG"
case "$1" in
  list-sessions)
    test -f "$FAKE_TMUX_STATE" || exit 1
    printf '%s\n' 'cx-tt-117-initial'
    ;;
  has-session)
    test -f "$FAKE_TMUX_STATE"
    ;;
  new-session)
    : > "$FAKE_TMUX_STATE"
    ;;
  kill-session)
    /bin/rm -f "$FAKE_TMUX_STATE"
    ;;
  *)
    exit 64
    ;;
esac
`,
      { mode: 0o700 },
    );
    await chmod(fakeTmux, 0o700);

    const env = {
      ...process.env,
      ORCHESTRATOR_HOME: home,
      ORCHESTRATOR_MIGRATIONS_DIR: resolve(app, "migrations"),
      CODEX_BIN: process.execPath,
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_TMUX_STATE: fakeTmuxState,
      FAKE_TMUX_LOG: fakeTmuxLog,
    };
    execFileSync(process.execPath, [resolve(app, "src/init-run-store.ts")], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });

    const databasePath = resolve(home, "state/orchestrator.db");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, from_status, to_status,
        payload_json, processing_state
      ) VALUES (
        'event-initial-start', '2026-08-19T12:00:00.000Z', 'tailortales',
        'item-initial-start', 'content-initial-start', 'Issue',
        'Shagon1k/TailorTales', 117, '[Test]: Initial start',
        'https://example.invalid/issues/117', 'Backlog', 'In progress',
        '{"issueState":"OPEN","labels":[],"hasDescription":true}',
        'processed'
      );
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode
      ) VALUES (
        'r_initial_start', 'event-initial-start', 'tailortales',
        'item-initial-start', 'content-initial-start', 'Shagon1k/TailorTales',
        117, 'autonomous', 'starting', 'none', 'live'
      );
    `);
    database
      .prepare(
        `INSERT INTO run_resources (
           run_id, resource_state, worktree_path, branch_name, base_sha,
           codex_thread_id, previous_codex_thread_id, tmux_session_name
         ) VALUES (?, 'provisioned', ?, 'TT-117_initial-start', ?,
                   NULL, NULL, NULL)`,
      )
      .run(runId, worktree, baseSha);
    database.close();

    const output = execFileSync(
      process.execPath,
      [
        resolve(app, "src/session-manager.ts"),
        "start",
        "--run-id",
        runId,
        "--apply",
      ],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const result = JSON.parse(output) as {
      ok: boolean;
      action: string;
      runState: string;
      ownerState: string;
    };
    assert(
      result.ok &&
        result.action === "started" &&
        result.runState === "running" &&
        result.ownerState === "cli",
      "Initial session start did not complete",
    );

    const verify = new DatabaseSync(databasePath, { readOnly: true });
    const row = verify
      .prepare(
        `SELECT r.state, r.owner_state, rr.tmux_session_name,
                rr.codex_thread_id, rr.previous_codex_thread_id
         FROM runs r JOIN run_resources rr USING (run_id)
         WHERE r.run_id = ?`,
      )
      .get(runId) as {
      state: string;
      owner_state: string;
      tmux_session_name: string | null;
      codex_thread_id: string | null;
      previous_codex_thread_id: string | null;
    };
    const history = verify
      .prepare(
        `SELECT reason FROM run_state_history
         WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`,
      )
      .get(runId) as { reason: string };
    verify.close();
    assert(
      row.state === "running" &&
        row.owner_state === "cli" &&
        row.tmux_session_name === "cx-tt-117-initia" &&
        row.codex_thread_id === null &&
        row.previous_codex_thread_id === null,
      "Initial session claim did not preserve the expected resource mapping",
    );
    assert(
      history.reason === "codex_initial_turn_started",
      "Initial session start history was not recorded",
    );
    const tmuxCalls = await readFile(fakeTmuxLog, "utf8");
    assert(
      tmuxCalls.includes(`HERMES_CANONICAL_REPOSITORY=${canonical}`),
      "Managed launcher did not receive the allowlisted canonical repository",
    );

    await rm(fakeTmuxState, { force: true });
    const existing = new DatabaseSync(databasePath);
    existing.exec(`
      UPDATE runs
      SET state = 'starting', owner_state = 'none'
      WHERE run_id = 'r_initial_start';
      UPDATE run_resources
      SET tmux_session_name = NULL,
          codex_thread_id = 'thread-must-not-be-reused'
      WHERE run_id = 'r_initial_start';
    `);
    existing.close();
    let existingThreadRejected = false;
    try {
      execFileSync(
        process.execPath,
        [
          resolve(app, "src/session-manager.ts"),
          "start",
          "--run-id",
          runId,
          "--apply",
        ],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? String(error);
      existingThreadRejected = stderr.includes("not session-startable");
    }
    assert(
      existingThreadRejected,
      "Initial start accepted a pre-existing Codex thread mapping",
    );

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        initialNullThreadAccepted: true,
        existingThreadRejectedByContract: existingThreadRejected,
        tmuxClaimed: true,
        canonicalTrustContext: true,
        state: row.state,
        owner: row.owner_state,
      })}\n`,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
