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

function runFails(command: string, args: string[], env: NodeJS.ProcessEnv): string {
  try {
    execFileSync(command, args, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return (error as { stderr?: string }).stderr ?? String(error);
  }
  throw new Error("Expected command to fail");
}

async function main(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const home = await realpath(
    await mkdtemp(resolve(tmpdir(), "kurami-autonomous-successor-")),
  );
  const fakeBin = resolve(home, "fake-bin");
  const fakeTmuxState = resolve(home, "tmux-alive");
  const fakeTmuxLog = resolve(home, "tmux-calls.log");
  const worktreeRoot = resolve(home, "worktrees/tailortales");
  const worktree = resolve(worktreeRoot, "124/TailorTales");
  const ambiguousWorktree = resolve(worktreeRoot, "125/TailorTales");
  const canonical = resolve(home, "repositories/TailorTales");
  const successorPath = resolve(app, "src/autonomous-successor.ts");
  const controlsPath = resolve(app, "src/run-controls.ts");
  const controllerPath = resolve(app, "src/controller.ts");
  const injectedCredential = `github_pat_${"Y".repeat(32)}`;

  try {
    await mkdir(resolve(home, "config"), { recursive: true, mode: 0o700 });
    await mkdir(fakeBin, { recursive: true, mode: 0o700 });
    await mkdir(worktree, { recursive: true, mode: 0o700 });
    await mkdir(ambiguousWorktree, { recursive: true, mode: 0o700 });
    await mkdir(canonical, { recursive: true, mode: 0o700 });
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

    for (const directory of [worktree, ambiguousWorktree]) {
      git(directory, ["init", "-b", "TT-124_successor"]);
      git(directory, ["config", "user.email", "successor-test@example.invalid"]);
      git(directory, ["config", "user.name", "Successor Test"]);
      await writeFile(resolve(directory, "README.md"), "base\n");
      git(directory, ["add", "README.md"]);
      git(directory, ["commit", "-m", "fixture"]);
    }
    await writeFile(
      resolve(worktree, "README.md"),
      `base\nowner edit\nGH_TOKEN=${injectedCredential}\n`,
    );
    await writeFile(resolve(worktree, "notes.txt"), "staged owner note\n");
    git(worktree, ["add", "notes.txt"]);

    const fakeTmux = resolve(fakeBin, "tmux");
    await writeFile(
      fakeTmux,
      `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FAKE_TMUX_LOG"
case "$1" in
  list-sessions)
    test -f "$FAKE_TMUX_STATE" || exit 1
    printf '%s\n' 'cx-tt-124-test-a1'
    ;;
  has-session)
    test -f "$FAKE_TMUX_STATE"
    ;;
  capture-pane)
    printf '%s\n' '› Write tests for @filename'
    ;;
  send-keys)
    case "$*" in
      *C-d*) /bin/rm -f "$FAKE_TMUX_STATE" ;;
    esac
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
    const insertFixture = (
      suffix: string,
      issue: number,
      fixtureWorktree: string,
      branchName: string,
      requestId?: string,
      interactionPolicy: "autonomous" | "human_control" = "autonomous",
    ): void => {
      database
        .prepare(
          `INSERT INTO project_events (
             event_id, observed_at, project, item_id, content_id, content_type,
             repository, issue_number, title, url, from_status, to_status,
             payload_json, processing_state
           ) VALUES (?, '2026-08-21T00:00:00.000Z', 'tailortales', ?, ?, 'Issue',
             'Shagon1k/TailorTales', ?, ?, ?, 'In progress', 'Human Review',
             '{"issueState":"OPEN","labels":[],"hasDescription":true}', 'processed')`,
        )
        .run(
          `event-${suffix}`,
          `item-${suffix}`,
          `content-${suffix}`,
          issue,
          `[Test]: Successor ${issue}`,
          `https://example.invalid/issues/${issue}`,
        );
      database
        .prepare(
          `INSERT INTO project_items (
             project, item_id, content_id, content_type, repository,
             issue_number, title, url, status, first_seen_at, last_seen_at
           ) VALUES ('tailortales', ?, ?, 'Issue', 'Shagon1k/TailorTales',
             ?, ?, ?, 'Human Review', '2026-08-21T00:00:00.000Z',
             '2026-08-21T00:00:00.000Z')`,
        )
        .run(
          `item-${suffix}`,
          `content-${suffix}`,
          issue,
          `[Test]: Successor ${issue}`,
          `https://example.invalid/issues/${issue}`,
        );
      database
        .prepare(
          `INSERT INTO runs (
             run_id, trigger_event_id, project, item_id, content_id, repository,
             issue_number, interaction_policy, state, owner_state, execution_mode
           ) VALUES (?, ?, 'tailortales', ?, ?, 'Shagon1k/TailorTales', ?,
             ?, 'remote_owned', 'remote', 'live')`,
        )
        .run(
          `r_${suffix}`,
          `event-${suffix}`,
          `item-${suffix}`,
          `content-${suffix}`,
          issue,
          interactionPolicy,
        );
      database
        .prepare(
          `INSERT INTO run_resources (
             run_id, resource_state, worktree_path, branch_name, base_sha,
             codex_thread_id, previous_codex_thread_id, tmux_session_name
           ) VALUES (?, 'provisioned', ?, ?, ?, ?, NULL, NULL)`,
        )
        .run(
          `r_${suffix}`,
          fixtureWorktree,
          branchName,
          git(fixtureWorktree, ["rev-parse", "HEAD"]),
          `thread-${suffix}-predecessor`,
        );
      if (requestId) {
        database
          .prepare(
            `INSERT INTO run_control_requests (
               request_id, run_id, action, requested_via, idempotency_key,
               request_state
             ) VALUES (?, ?, 'take_control', 'discord', ?, 'pending')`,
          )
          .run(requestId, `r_${suffix}`, `successor:${suffix}`);
      }
    };
    insertFixture(
      "successor",
      124,
      worktree,
      "TT-124_successor",
      undefined,
      "human_control",
    );
    insertFixture("ambiguous", 125, ambiguousWorktree, "TT-125_wrong");
    database.close();

    const queuedOutput = execFileSync(
      process.execPath,
      [
        controlsPath,
        "request",
        "--run-id",
        "r_successor",
        "--action",
        "take_control",
        "--via",
        "discord",
        "--apply",
      ],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const queued = JSON.parse(queuedOutput) as {
      action: string;
      intent: string;
      requestId: string;
    };
    assert(
      queued.action === "created" &&
        queued.intent === "autonomous_successor" &&
        Boolean(queued.requestId),
      "Remote continuation control did not record explicit successor intent",
    );
    const controllerOutput = execFileSync(
      process.execPath,
      [controllerPath, "--apply"],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const controller = JSON.parse(controllerOutput) as {
      results: Array<{ action: string; status: string; result?: unknown }>;
    };
    const successorEntry = controller.results.find(
      (entry) =>
        entry.action === "successor_start" &&
        (entry as { runId?: string }).runId === "r_successor",
    );
    assert(
      successorEntry,
      `Controller did not plan an autonomous successor: ${controllerOutput}`,
    );
    assert(
      successorEntry.status === "applied" && successorEntry.result,
      `Controller did not apply the autonomous successor: ${controllerOutput}`,
    );
    const result = successorEntry.result as {
      ok: boolean;
      action: string;
      predecessorThreadId: string;
    };
    assert(
      result.ok &&
        result.action === "autonomous_successor_started" &&
        result.predecessorThreadId === "thread-successor-predecessor",
      "Fresh autonomous successor did not start",
    );

    const verify = new DatabaseSync(databasePath, { readOnly: true });
    const row = verify
      .prepare(
        `SELECT r.state, r.owner_state, r.interaction_policy,
                rr.tmux_session_name,
                rr.codex_thread_id, s.succession_state,
                s.predecessor_thread_id, s.handoff_context_json,
                q.request_state
         FROM runs r JOIN run_resources rr USING (run_id)
         JOIN run_autonomous_successions s USING (run_id)
         JOIN run_control_requests q ON q.request_id=s.request_id
         WHERE r.run_id='r_successor'`,
      )
      .get() as {
      state: string;
      owner_state: string;
      interaction_policy: string;
      tmux_session_name: string;
      codex_thread_id: string | null;
      succession_state: string;
      predecessor_thread_id: string;
      handoff_context_json: string;
      request_state: string;
    };
    const context = JSON.parse(row.handoff_context_json) as {
      previous_thread_id: string;
      git: { status: string; unstagedDiff: string; stagedDiff: string };
      explicitOwnerConfirmation: string;
      instructions: string[];
    };
    verify.close();
    assert(
      row.state === "running" &&
        row.owner_state === "cli" &&
        row.interaction_policy === "human_control" &&
        row.tmux_session_name.endsWith("-a1") &&
        row.codex_thread_id === null &&
        row.succession_state === "running" &&
        row.request_state === "applied" &&
        row.predecessor_thread_id === "thread-successor-predecessor",
      "Successor claim did not establish one managed writer",
    );

    const synchronized = new DatabaseSync(databasePath);
    synchronized
      .prepare(
        `UPDATE run_resources
         SET codex_thread_id='thread-successor-managed'
         WHERE run_id='r_successor'`,
      )
      .run();
    synchronized.close();
    const postSyncOutput = execFileSync(process.execPath, [controllerPath], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const postSync = JSON.parse(postSyncOutput) as {
      plans: Array<{ runId: string; action: string }>;
    };
    assert(
      !postSync.plans.some(
        (plan) =>
          plan.runId === "r_successor" && plan.action === "handoff",
      ),
      "Explicitly approved human-control successor was handed back immediately",
    );
    assert(
      postSync.plans.some(
        (plan) => plan.runId === "r_successor" && plan.action === "park",
      ),
      "Idle successor on an existing Human Review item was not scheduled to park",
    );
    const parkedOutput = execFileSync(
      process.execPath,
      [controllerPath, "--apply"],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const parkedController = JSON.parse(parkedOutput) as {
      results: Array<{ runId: string; action: string; status: string }>;
    };
    assert(
      parkedController.results.some(
        (entry) =>
          entry.runId === "r_successor" &&
          entry.action === "park" &&
          entry.status === "applied",
      ),
      `Controller did not park the completed successor: ${parkedOutput}`,
    );
    const parkedDatabase = new DatabaseSync(databasePath, { readOnly: true });
    const parkedRun = parkedDatabase
      .prepare(
        `SELECT r.state, r.owner_state, rr.tmux_session_name,
                s.succession_state
         FROM runs r JOIN run_resources rr USING (run_id)
         JOIN run_autonomous_successions s USING (run_id)
         WHERE r.run_id='r_successor'`,
      )
      .get() as {
      state: string;
      owner_state: string;
      tmux_session_name: string | null;
      succession_state: string;
    };
    parkedDatabase.close();
    assert(
      parkedRun.state === "parked_review" &&
        parkedRun.owner_state === "none" &&
        parkedRun.tmux_session_name === null &&
        parkedRun.succession_state === "parked",
      "Completed no-op successor did not release its managed writer",
    );
    assert(
      context.previous_thread_id === "thread-successor-predecessor" &&
        context.git.status.includes("README.md") &&
        context.git.unstagedDiff.includes("owner edit") &&
        context.git.unstagedDiff.includes("[REDACTED_CREDENTIAL]") &&
        !JSON.stringify(context).includes(injectedCredential) &&
        context.git.stagedDiff.includes("staged owner note") &&
        context.explicitOwnerConfirmation.includes("will not be continued") &&
        context.instructions.some(
          (value) =>
            value.includes("do not invent changes") &&
            value.includes("finish the turn immediately"),
        ),
      "Bounded handoff omitted predecessor or dirty-worktree evidence",
    );
    assert(
      (await readFile(resolve(worktree, "README.md"), "utf8")).includes(
        "owner edit",
      ) &&
        (await readFile(resolve(worktree, "notes.txt"), "utf8")) ===
          "staged owner note\n",
      "Successor startup changed owner work",
    );

    const repeated = runFails(
      process.execPath,
      [
        successorPath,
        "start",
        "--run-id",
        "r_successor",
        "--request-id",
        "rq_successor",
        "--apply",
      ],
      env,
    );
    assert(
      repeated.includes("Run is not Remote-owned"),
      "Repeated successor start did not fail closed",
    );

    const ambiguousRequest = new DatabaseSync(databasePath);
    ambiguousRequest
      .prepare(
        `INSERT INTO run_control_requests (
           request_id, run_id, action, requested_via, idempotency_key,
           request_state
         ) VALUES ('rq_ambiguous', 'r_ambiguous', 'take_control', 'discord',
                   'successor:ambiguous', 'pending')`,
      )
      .run();
    ambiguousRequest.close();

    const ambiguous = runFails(
      process.execPath,
      [
        successorPath,
        "start",
        "--run-id",
        "r_ambiguous",
        "--request-id",
        "rq_ambiguous",
        "--apply",
      ],
      env,
    );
    assert(
      ambiguous.includes("Branch mismatch"),
      "Ambiguous worktree/branch mapping was not rejected",
    );
    const final = new DatabaseSync(databasePath, { readOnly: true });
    const ambiguousState = final
      .prepare(
        `SELECT state, owner_state FROM runs WHERE run_id='r_ambiguous'`,
      )
      .get() as { state: string; owner_state: string };
    const successorCount = final
      .prepare(
        `SELECT COUNT(*) AS count FROM run_autonomous_successions
         WHERE run_id='r_successor'`,
      )
      .get() as { count: number };
    final.close();
    assert(
      ambiguousState.state === "needs_attention" &&
        ambiguousState.owner_state === "none",
      "Ambiguous successor boundary did not surface needs_attention",
    );
    assert(successorCount.count === 1, "Repeated request created a second writer");

    const tmuxCalls = await readFile(fakeTmuxLog, "utf8");
    assert(
      tmuxCalls.includes("HERMES_INITIAL_PROMPT_B64=") &&
        tmuxCalls.includes(`HERMES_WORKTREE_PATH=${worktree}`),
      "Managed successor launcher missed the exact worktree handoff",
    );

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        freshManagedTask: true,
        predecessorFrozen: true,
        explicitOwnerBoundary: true,
        humanControlOneShotOverride: true,
        exactWorktreeAndBranch: true,
        dirtyDiffPreserved: true,
        boundedHandoff: true,
        noOpSuccessorParks: true,
        singleWriter: true,
        repeatedRequestFailClosed: true,
        ambiguityNeedsAttention: true,
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
