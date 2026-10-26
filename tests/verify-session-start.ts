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
import { initialPrompt } from "../src/orchestrator/projects/sessions/prompts.ts";
import { protocolRepository } from "./fixtures/protocol-repository.ts";

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
  const promptRun = {
    repository: "Shagon1k/TailorTales",
    issue_number: 117,
    issue_url: "https://example.invalid/issues/117",
    run_id: "r_initial_start",
  };
  const autonomousPrompt = initialPrompt({
    ...promptRun,
    interaction_policy: "autonomous",
  } as Parameters<typeof initialPrompt>[0]);
  const humanControlPrompt = initialPrompt({
    ...promptRun,
    interaction_policy: "human_control",
  } as Parameters<typeof initialPrompt>[0]);
  assert(
    autonomousPrompt.includes("Do not ask for or wait for a separate interactive commit confirmation") &&
      !humanControlPrompt.includes("Do not ask for or wait for a separate interactive commit confirmation"),
    "Only autonomous primary runs should receive explicit commit authorization",
  );
  assert(
    autonomousPrompt.includes(
      "After verifying the focused commit is pushed normally to the managed branch, create exactly one matching open Draft PR",
    ) &&
      autonomousPrompt.includes("link issue #117 in its body") &&
      autonomousPrompt.includes("If an exact matching PR already exists, do not create another") &&
      autonomousPrompt.includes(
        "does not authorize merge, force-push, rebase, or deployment",
      ) &&
      !humanControlPrompt.includes("create exactly one matching open Draft PR"),
    "Autonomous initial writer prompt did not authorize exactly one linked Draft PR while preserving prohibited operations",
  );
  assert(autonomousPrompt.includes("Closes #117"),"Whole-issue PRs use the repository closing keyword");
  assert(autonomousPrompt.includes("pending before merge do not by themselves require a non-closing reference"),"Pending pre-merge review is not partial delivery");
  assert(autonomousPrompt.includes("explicit post-merge acceptance gate"),"Explicit post-merge gates retain non-closing linkage");
  assert(autonomousPrompt.includes("compare the rendered result with those sources"),"UI delivery compares implementation with references");
  assert(humanControlPrompt.includes("canonical design as a specification"),"Human-control preparation identifies design authority");
  const app = resolve(import.meta.dirname, "..");
  const launcher = await readFile(resolve(app, "bin/launch-codex-session.sh"), "utf8");
  assert(
    launcher.includes("--ask-for-approval never") &&
      !launcher.includes("--ask-for-approval on-request"),
    "Managed Codex launcher must not wait for an interactive approval",
  );
  assert(
    launcher.includes("sandbox_workspace_write.network_access=true"),
    "Managed Codex launcher must allow GitHub reads and pushes while retaining workspace-write isolation",
  );
  assert(
    launcher.includes('worktree_git_dir="$(git -C "${HERMES_WORKTREE_PATH}" rev-parse --path-format=absolute --git-dir)"') &&
      launcher.includes('"${worktree_git_dir}" != "${worktree_common_dir}"/worktrees/*') &&
      launcher.includes('--add-dir "${worktree_git_dir}"') &&
      launcher.includes('--add-dir "${worktree_common_dir}"'),
    "Managed Codex launcher must grant write access only to the linked worktree Git directory",
  );
  assert(
    launcher.includes('export pnpm_config_store_dir="${HERMES_WORKTREE_PATH}/node_modules/.pnpm-store"') &&
      !launcher.includes('--add-dir "${HOME}') &&
      !launcher.includes('danger-full-access'),
    "Managed pnpm store must remain inside the existing sandbox workspace",
  );
  for (const prompt of [autonomousPrompt, humanControlPrompt]) {
    assert(prompt.includes("use `gh api graphql`") && prompt.includes("Do not expand token scopes"),
      "Project reads must avoid unnecessary CLI scopes without changing credentials");
  }
  const environmentFixture = protocolRepository();
  try {
    await mkdir(resolve(environmentFixture.root, "secrets"));
    await writeFile(resolve(environmentFixture.root, "secrets/github.env"), "GH_TOKEN=synthetic-fixture-token\n", {mode: 0o600});
    const fakeCodex = resolve(environmentFixture.root, "environment-codex");
    await writeFile(fakeCodex, `#!/usr/bin/env node\nconsole.log(JSON.stringify({store:process.env.pnpm_config_store_dir,writerToken:Boolean(process.env.GH_TOKEN),args:process.argv.slice(2)}));\n`, {mode: 0o700});
    const launched = JSON.parse(execFileSync("bash", [resolve(app, "bin/launch-codex-session.sh")], {
      encoding: "utf8", env: {...process.env,
        KURAMI_HOME: environmentFixture.root, HERMES_RUN_ID: "r_environment",
        HERMES_REPOSITORY: "Fixture/Repo", HERMES_ISSUE_NUMBER: "1",
        HERMES_WORKTREE_PATH: environmentFixture.worktree,
        HERMES_CANONICAL_REPOSITORY: environmentFixture.canonical, CODEX_BIN: fakeCodex,
        HERMES_CODEX_TASK_ID: "", HERMES_INITIAL_PROMPT_FILE: "",
        HERMES_INITIAL_PROMPT_B64: Buffer.from("Environment fixture").toString("base64"),
        pnpm_config_store_dir: "/not-the-workspace-store",
      }, stdio: ["ignore", "pipe", "pipe"],
    })) as {store: string; writerToken: boolean; args: string[]};
    assert(launched.store === resolve(environmentFixture.worktree, "node_modules/.pnpm-store"),
      "The real primary launcher did not replace the inherited package store");
    assert(launched.writerToken && launched.args.includes("workspace-write") &&
      launched.args.includes("sandbox_workspace_write.network_access=true") &&
      !launched.args.includes(launched.store),
      "Primary launcher changed authentication or broadened sandbox writable roots");
  } finally {
    environmentFixture.database.close();
    await rm(environmentFixture.root, {recursive: true, force: true});
  }
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
      KURAMI_HOME: home,
      ORCHESTRATOR_MIGRATIONS_DIR: resolve(app, "migrations"),
      CODEX_BIN: process.execPath,
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_TMUX_STATE: fakeTmuxState,
      FAKE_TMUX_LOG: fakeTmuxLog,
    };
    execFileSync(process.execPath, [resolve(app, "src/orchestrator/state/init-run-store.ts")], {
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
        resolve(app, "src/orchestrator/projects/sessions/manager.ts"),
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
    assert(!tmuxCalls.includes("HERMES_CODEX_TASK_ID="), "Primary writer must retain TUI execution");
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
          resolve(app, "src/orchestrator/projects/sessions/manager.ts"),
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

    const preparation = new DatabaseSync(databasePath);
    preparation.prepare("UPDATE run_resources SET codex_thread_id = NULL WHERE run_id = ?").run(runId);
    preparation.close();
    const promptDirectory = resolve(home, "state/session-prompts");
    await rm(promptDirectory, { recursive: true, force: true });
    await writeFile(promptDirectory, "blocks prompt directory creation\n");
    let preparationFailed = false;
    try {
      execFileSync(
        process.execPath,
        [resolve(app, "src/orchestrator/projects/sessions/manager.ts"), "start", "--run-id", runId, "--apply"],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      preparationFailed = true;
    }
    assert(preparationFailed, "Prompt directory failure did not stop session startup");
    const failedStart = new DatabaseSync(databasePath, { readOnly: true });
    const failedRow = failedStart.prepare(`
      SELECT r.state, r.owner_state, rr.tmux_session_name
      FROM runs r JOIN run_resources rr USING (run_id)
      WHERE r.run_id = ?
    `).get(runId) as { state: string; owner_state: string; tmux_session_name: string | null };
    failedStart.close();
    assert(
      failedRow.state === "needs_attention" &&
        failedRow.owner_state === "none" &&
        failedRow.tmux_session_name === null,
      "Prompt preparation failure left a claimed tmux mapping or an unreported run",
    );
    let failedRetryRejected = false;
    try {
      execFileSync(
        process.execPath,
        [resolve(app, "src/orchestrator/projects/sessions/manager.ts"), "start", "--run-id", runId, "--apply"],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? String(error);
      failedRetryRejected = stderr.includes("not ready for session start");
    }
    assert(failedRetryRejected, "A failed start was retried without recovery from needs_attention");
    const newSessionCalls = (await readFile(fakeTmuxLog, "utf8"))
      .split("\n")
      .filter((line) => line.startsWith("new-session "));
    assert(newSessionCalls.length === 1, "Failed start retry attempted a second tmux session");

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        initialNullThreadAccepted: true,
        existingThreadRejectedByContract: existingThreadRejected,
        promptPreparationFailureReconciled: true,
        failedRetryRejected,
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
