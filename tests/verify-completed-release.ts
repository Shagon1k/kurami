import { execFileSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyInternal } from "../src/orchestrator/runtime/controller-execution.ts";
import { controlComponents } from "../src/orchestrator/controls/discord.ts";

process.umask(0o077);

function run(command: string, args: string[], cwd?: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function git(repository: string, args: string[]): string {
  return run("git", ["-C", repository, ...args]);
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const appDirectory = resolve(import.meta.dirname, "..");
  const testHome = await realpath(
    await mkdtemp(resolve(tmpdir(), "kurami-release-test-")),
  );
  const origin = resolve(testHome, "origin.git");
  const canonical = resolve(testHome, "projects/TailorTales");
  const worktreeRoot = resolve(testHome, "projects/.worktrees/tailortales");
  const fakeBin = resolve(testHome, "bin");
  const fakeGh = resolve(fakeBin, "gh");
  const branch = "TT-9901_release-test";
  const attemptDirectory = resolve(worktreeRoot, branch);
  const worktree = resolve(attemptDirectory, "TailorTales");
  const runId = "r_release_test";

  try {
    await mkdir(canonical, { recursive: true, mode: 0o700 });
    await mkdir(resolve(testHome, "config"), { recursive: true, mode: 0o700 });
    await copyFile(
      resolve(appDirectory, "deploy/config/orchestrator.yaml"),
      resolve(testHome, "config/orchestrator.yaml"),
    );
    await mkdir(fakeBin, { recursive: true, mode: 0o700 });
    await writeFile(fakeGh, "#!/bin/sh\nprintf '[]\\n'\n", "utf8");
    await chmod(fakeGh, 0o700);
    process.env.PATH = `${fakeBin}:${process.env.PATH ?? ""}`;
    run("git", ["init", "--bare", origin]);
    run("git", ["init", "-b", "main", canonical]);
    git(canonical, ["config", "user.name", "Kurami Test"]);
    git(canonical, ["config", "user.email", "kurami-test@example.invalid"]);
    await writeFile(resolve(canonical, "README.md"), "base\n", "utf8");
    git(canonical, ["add", "README.md"]);
    git(canonical, ["commit", "-m", "test: base"]);
    git(canonical, ["remote", "add", "origin", origin]);
    git(canonical, ["push", "-u", "origin", "main"]);
    const baseSha = git(canonical, ["rev-parse", "HEAD"]);

    await mkdir(attemptDirectory, { recursive: true, mode: 0o700 });
    git(canonical, ["worktree", "add", "-b", branch, worktree, baseSha]);
    await writeFile(resolve(worktree, "release.txt"), "merged work\n", "utf8");
    git(worktree, ["add", "release.txt"]);
    git(worktree, ["commit", "-m", "test: merged work"]);
    const headSha = git(worktree, ["rev-parse", "HEAD"]);

    await writeFile(
      resolve(testHome, "config/projects.yaml"),
      [
        "version: 1",
        "projects:",
        "  tailortales:",
        "    repository: Shagon1k/TailorTales",
        "    statuses:",
        "      backlog: Backlog",
        "      active: In progress",
        "      review: Human Review",
        "    workspace:",
        `      canonical_repository: ${canonical}`,
        `      worktree_root: ${worktreeRoot}`,
        "      base_branch: main",
        "",
      ].join("\n"),
      "utf8",
    );
    execFileSync(process.execPath, [resolve(appDirectory, "src/orchestrator/state/init-run-store.ts")], {
      env: {
        ...process.env,
        KURAMI_HOME: testHome,
        ORCHESTRATOR_MIGRATIONS_DIR: resolve(appDirectory, "migrations"),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });

    const databasePath = resolve(testHome, "state/orchestrator.db");
    const database = new DatabaseSync(databasePath);
    database
      .prepare(`
        INSERT INTO project_events (
          event_id, observed_at, project, item_id, content_id, content_type,
          repository, issue_number, title, url, from_status, to_status,
          payload_json, processing_state
        ) VALUES (
          'release-event', '2026-08-14T00:00:00.000Z', 'tailortales',
          'release-item', 'release-content', 'Issue', 'Shagon1k/TailorTales',
          9901, '[Test]: Completed release', 'https://example.invalid/9901',
          'Human Review', 'Done', '{}', 'processed'
        )
      `)
      .run();
    database
      .prepare(`
        INSERT INTO runs (
          run_id, trigger_event_id, project, item_id, content_id, repository,
          issue_number, interaction_policy, state, owner_state,
          execution_mode, stop_reason
        ) VALUES (
          ?, 'release-event', 'tailortales', 'release-item', 'release-content',
          'Shagon1k/TailorTales', 9901, 'autonomous', 'stopping', 'remote',
          'live', 'completed'
        )
      `)
      .run(runId);
    database
      .prepare(`
        INSERT INTO run_resources (
          run_id, resource_state, base_sha, worktree_path, branch_name
        ) VALUES (?, 'provisioned', ?, ?, ?)
      `)
      .run(runId, baseSha, worktree, branch);
    database.close();

    const environment = {
      ...process.env,
      KURAMI_HOME: testHome,
      ORCHESTRATOR_MIGRATIONS_DIR: resolve(appDirectory, "migrations"),
    };
    const release = (script: string, apply: boolean): Record<string, unknown> => {
      const args = [resolve(appDirectory, script), "--run-id", runId];
      if (apply) args.push("--apply");
      return JSON.parse(
        execFileSync(process.execPath, args, {
          encoding: "utf8",
          env: environment,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ) as Record<string, unknown>;
    };

    const beforeMerge = release(
      "src/orchestrator/projects/worktrees/release.ts",
      true,
    );
    assert(beforeMerge.action === "waiting_for_merge", "Unmerged work was released");
    assert(await exists(worktree), "Unmerged worktree was removed");

    const waitingDatabase = new DatabaseSync(databasePath);
    const waiting = waitingDatabase.prepare(
      "SELECT state, stop_reason FROM runs WHERE run_id = ?",
    ).get(runId) as { state: string; stop_reason: string };
    assert(waiting.state === "needs_attention" && waiting.stop_reason === "completed",
      "Done without merge remained stuck in stopping");
    const historyCount = (): number => (waitingDatabase.prepare(
      "SELECT COUNT(*) AS count FROM run_state_history WHERE run_id = ?",
    ).get(runId) as { count: number }).count;
    const firstHistoryCount = historyCount();
    release("src/orchestrator/projects/worktrees/release.ts", true);
    assert(historyCount() === firstHistoryCount, "Merge retries duplicated attention history");

    const planning = JSON.parse(execFileSync(process.execPath,
      [resolve(appDirectory, "src/orchestrator/runtime/controller.ts")],
      { encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "pipe"] },
    )) as { plans: Array<{ runId: string; action: string }> };
    assert(planning.plans.some(plan => plan.runId === runId && plan.action === "release"),
      "Controller stopped checking for a later merge");
    execFileSync(process.execPath,
      [resolve(appDirectory, "src/orchestrator/runtime/controller.ts"), "--apply"],
      { env: environment, stdio: ["ignore", "pipe", "pipe"] },
    );
    const progress = waitingDatabase.prepare(
      "SELECT stage, detail FROM run_progress_cards WHERE run_id = ?",
    ).get(runId) as { stage: string; detail: string };
    assert(progress.stage === "needs_attention" && progress.detail.includes("cancel the run"),
      "Merge wait did not explain how to resolve the run");

    for (const state of ["stopping", "needs_attention"]) {
      waitingDatabase.prepare("UPDATE runs SET state = ?, stop_reason = 'completed' WHERE run_id = ?")
        .run(state, runId);
      const controls = JSON.stringify(controlComponents({
        run_id: runId, run_state: state, stage: state, stop_reason: "completed",
        owner_state: "none", resource_state: "provisioned", previous_codex_thread_id: null,
      } as Parameters<typeof controlComponents>[0], {
        repository: "Shagon1k/TailorTales",
        workspace: { branch_prefix: "TT", worktree_root: worktreeRoot },
      }, null));
      assert(controls.includes(`kurami:stop:${runId}`), `${state} completion hid Cancel run`);
      const requestId = `rq_cancel_${state}`;
      waitingDatabase.prepare(`INSERT INTO run_control_requests (
        request_id, run_id, action, requested_via, idempotency_key
      ) VALUES (?, ?, 'stop', 'cli', ?)`).run(requestId, runId, requestId);
      applyInternal(waitingDatabase, {
        action: "request_stop", runId, project: "tailortales", issueNumber: 9901, requestId,
      });
      const cancelled = waitingDatabase.prepare(
        "SELECT state, stop_reason FROM runs WHERE run_id = ?",
      ).get(runId) as { state: string; stop_reason: string };
      assert(cancelled.state === "stopping" && cancelled.stop_reason === "cancelled",
        `Cancel did not override Done from ${state}`);
      assert(await exists(worktree), "Cancel discarded unmerged work");
    }
    waitingDatabase.prepare("UPDATE runs SET state = 'needs_attention', stop_reason = 'completed' WHERE run_id = ?")
      .run(runId);
    waitingDatabase.close();

    git(canonical, ["merge", "--squash", branch]);
    git(canonical, ["commit", "-m", "test: squash merge release branch"]);
    git(canonical, ["push", "origin", "main"]);
    await writeFile(
      fakeGh,
      [
        "#!/bin/sh",
        `printf '%s\\n' '[{"number":9902,"url":"https://example.invalid/pull/9902","headRefOid":"${headSha}","mergedAt":"2026-08-14T12:00:00Z"}]'`,
        "",
      ].join("\n"),
      "utf8",
    );
    const afterMerge = release("src/orchestrator/projects/worktrees/release.ts", true);
    assert(afterMerge.action === "released", "Merged worktree was not released");
    assert(
      afterMerge.mergeEvidence === "github_pr",
      `Expected GitHub PR merge evidence, got ${String(afterMerge.mergeEvidence)}`,
    );
    assert(!(await exists(worktree)), "Merged worktree still exists");

    const verification = new DatabaseSync(databasePath, { readOnly: true });
    const row = verification
      .prepare(`
        SELECT r.state, r.owner_state, rr.resource_state
        FROM runs r JOIN run_resources rr USING (run_id)
        WHERE r.run_id = ?
      `)
      .get(runId) as { state: string; owner_state: string; resource_state: string };
    verification.close();
    assert(
      row.state === "archived" &&
        row.owner_state === "none" &&
        row.resource_state === "released",
      `Unexpected final state: ${JSON.stringify(row)}`,
    );

    const cancelledRunId = "r_cancelled_release_test";
    const cancellationDatabase = new DatabaseSync(databasePath);
    cancellationDatabase
      .prepare(`
        INSERT INTO project_events (
          event_id, observed_at, project, item_id, content_id, content_type,
          repository, issue_number, title, url, from_status, to_status,
          payload_json, processing_state
        ) VALUES (
          'cancelled-release-event', '2026-08-15T00:00:00.000Z', 'tailortales',
          'cancelled-release-item', 'cancelled-release-content', 'Issue',
          'Shagon1k/TailorTales', 9903, '[Test]: Cancelled release',
          'https://example.invalid/9903', 'In progress', 'Backlog', '{}', 'processed'
        )
      `)
      .run();
    cancellationDatabase
      .prepare(`
        INSERT INTO runs (
          run_id, trigger_event_id, project, item_id, content_id, repository,
          issue_number, interaction_policy, state, owner_state,
          execution_mode, stop_reason
        ) VALUES (
          ?, 'cancelled-release-event', 'tailortales', 'cancelled-release-item',
          'cancelled-release-content', 'Shagon1k/TailorTales', 9903,
          'autonomous', 'stopping', 'none', 'live', 'cancelled'
        )
      `)
      .run(cancelledRunId);
    cancellationDatabase
      .prepare(`
        INSERT INTO run_resources (
          run_id, resource_state, base_sha, worktree_path, branch_name
        ) VALUES (?, 'provisioned', ?, ?, ?)
      `)
      .run(
        cancelledRunId,
        baseSha,
        resolve(worktreeRoot, "TT-9903_cancelled-release", "TailorTales"),
        "TT-9903_cancelled-release",
      );
    cancellationDatabase.close();

    const cancelledArgs = [
      resolve(appDirectory, "src/orchestrator/projects/worktrees/release.ts"),
      "--run-id",
      cancelledRunId,
      "--apply",
    ];
    const cancelledRelease = JSON.parse(
      execFileSync(process.execPath, cancelledArgs, {
        encoding: "utf8",
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ) as Record<string, unknown>;
    assert(
      cancelledRelease.action === "released" && cancelledRelease.finalState === "cancelled",
      `Cancellation was not released as cancelled: ${JSON.stringify(cancelledRelease)}`,
    );

    const cancelledVerification = new DatabaseSync(databasePath, { readOnly: true });
    const cancelledRow = cancelledVerification
      .prepare(`
        SELECT r.state, r.stop_reason, rr.resource_state
        FROM runs r JOIN run_resources rr USING (run_id)
        WHERE r.run_id = ?
      `)
      .get(cancelledRunId) as { state: string; stop_reason: string; resource_state: string };
    cancelledVerification.close();
    assert(
      cancelledRow.state === "cancelled" &&
        cancelledRow.stop_reason === "cancelled" &&
        cancelledRow.resource_state === "released",
      `Cancellation was incorrectly archived: ${JSON.stringify(cancelledRow)}`,
    );
    process.stdout.write(
      `${JSON.stringify({ ok: true, isolated: true, beforeMerge: beforeMerge.action, afterMerge: afterMerge.action, mergeEvidence: afterMerge.mergeEvidence, final: row, cancelledFinal: cancelledRow })}\n`,
    );
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
