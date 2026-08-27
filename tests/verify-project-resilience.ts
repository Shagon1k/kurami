import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as legacyProjectPoller from "../src/poll-projects.ts";
import * as canonicalProjectPoller from "../src/orchestrator/projects/poll-projects.ts";
import * as legacyController from "../src/controller.ts";
import * as canonicalController from "../src/orchestrator/runtime/controller.ts";

type ControllerResult = {
  ok: boolean;
  apply: boolean;
  plans: Array<{ runId: string; action: string }>;
  results?: Array<{ runId: string; action: string; status: string }>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  legacyProjectPoller.runProjectPollerCli === canonicalProjectPoller.runProjectPollerCli,
  "Legacy poller CLI does not delegate to the canonical implementation",
);
assert(
  legacyController.runOrchestratorControllerCli ===
    canonicalController.runOrchestratorControllerCli,
  "Legacy controller CLI does not delegate to the canonical implementation",
);

function runController(
  appDirectory: string,
  testHome: string,
  apply = false,
): ControllerResult {
  const output = execFileSync(
    process.execPath,
    [
      resolve(appDirectory, "src/orchestrator/runtime/controller.ts"),
      ...(apply ? ["--apply"] : []),
    ],
    {
      encoding: "utf8",
      env: { ...process.env, KURAMI_HOME: testHome },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(output) as ControllerResult;
}

async function main(): Promise<void> {
  const appDirectory = resolve(import.meta.dirname, "..");
  const testHome = await mkdtemp(resolve(tmpdir(), "kurami-project-resilience-"));

  try {
    await mkdir(resolve(testHome, "config"), { recursive: true, mode: 0o700 });
    await copyFile(
      resolve(appDirectory, "deploy/config/orchestrator.yaml"),
      resolve(testHome, "config/orchestrator.yaml"),
    );
    await copyFile(
      resolve(appDirectory, "deploy/config/projects.yaml"),
      resolve(testHome, "config/projects.yaml"),
    );
    execFileSync(
      process.execPath,
      [resolve(appDirectory, "src/init-run-store.ts")],
      {
        env: {
          ...process.env,
          KURAMI_HOME: testHome,
          ORCHESTRATOR_MIGRATIONS_DIR: resolve(appDirectory, "migrations"),
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    execFileSync("bash", ["-n", resolve(appDirectory, "run-project-poller.sh")]);
    const pollerWrapper = await readFile(resolve(appDirectory, "run-project-poller.sh"), "utf8");
    assert(
      pollerWrapper.includes("tailortales|pickflick|ahurynovich-cv") &&
        pollerWrapper.includes("<tailortales|pickflick|ahurynovich-cv>"),
      "Production poller does not allowlist every configured project",
    );

    const fakeBin = resolve(testHome, "fake-bin");
    await mkdir(fakeBin, { recursive: true, mode: 0o700 });
    const fakeGh = resolve(fakeBin, "gh");
    await writeFile(
      fakeGh,
      `#!/bin/sh\nprintf '%s\\n' '{"errors":[{"message":"No server is currently available"}]}'\n`,
      { mode: 0o700 },
    );
    await chmod(fakeGh, 0o700);

    const databasePath = resolve(testHome, "state/orchestrator.db");
    const database = new DatabaseSync(databasePath);
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO project_poll_state (
           project, initialized_at, last_captured_at, item_count,
           last_attempt_at, last_attempt_state, last_error
         ) VALUES ('tailortales', ?, ?, 1, ?, 'succeeded', NULL)`,
      )
      .run(now, now, now);
    database
      .prepare(
        `INSERT INTO project_events (
           event_id, observed_at, project, item_id, content_id, content_type,
           repository, issue_number, title, url, from_status, to_status,
           payload_json, processing_state
         ) VALUES (
           'event-starting', ?, 'tailortales', 'item-starting',
           'content-starting', 'Issue', 'Shagon1k/TailorTales', 9901,
           '[Test]: Discovery outage', 'https://example.invalid/issues/9901',
           'Backlog', 'In progress',
           '{"issueState":"OPEN","labels":[],"hasDescription":true}',
           'processed'
         )`,
      )
      .run(now);
    database
      .prepare(
        `INSERT INTO runs (
           run_id, trigger_event_id, project, item_id, content_id, repository,
           issue_number, interaction_policy, state, owner_state, execution_mode
         ) VALUES (
           'r_waiting_github', 'event-starting', 'tailortales', 'item-starting',
           'content-starting', 'Shagon1k/TailorTales', 9901, 'autonomous',
           'starting', 'none', 'live'
         )`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO run_resources (
           run_id, resource_state, worktree_path, branch_name
         ) VALUES (
           'r_waiting_github', 'provisioned',
           '/tmp/worktrees/9901/TailorTales', 'TT-9901_discovery-outage'
         )`,
      )
      .run();
    database.close();

    let pollFailed = false;
    try {
      execFileSync(process.execPath, [resolve(appDirectory, "src/poll-projects.ts")], {
        env: {
          ...process.env,
          KURAMI_HOME: testHome,
          POLLER_PROJECT: "tailortales",
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch {
      pollFailed = true;
    }
    assert(pollFailed, "The synthetic GitHub Project failure was not surfaced");
    const failureDatabase = new DatabaseSync(databasePath);
    const recordedFailure = failureDatabase
      .prepare(
        `SELECT last_attempt_state, last_error
         FROM project_poll_state WHERE project = 'tailortales'`,
      )
      .get() as { last_attempt_state: string; last_error: string };
    failureDatabase.close();
    assert(
      recordedFailure.last_attempt_state === "failed" &&
        recordedFailure.last_error.includes("No server is currently available"),
      "The failed GitHub Project attempt was not stored durably",
    );

    const failedPoll = runController(appDirectory, testHome);
    assert(
      !failedPoll.plans.some(
        ({ runId, action }) => runId === "r_waiting_github" && action === "start",
      ),
      "A failed latest project poll did not block the primary Codex start",
    );

    const applied = runController(appDirectory, testHome, true);
    assert(
      applied.results?.length === 0,
      "Failed discovery unexpectedly produced a mutating controller action",
    );
    const waitingDatabase = new DatabaseSync(databasePath);
    const waitingCard = waitingDatabase
      .prepare(
        `SELECT stage, detail FROM run_progress_cards
         WHERE run_id = 'r_waiting_github'`,
      )
      .get() as { stage: string; detail: string };
    assert(
      waitingCard.stage === "waiting_github" &&
        waitingCard.detail.includes("fresh status snapshot"),
      "The live card does not explain the GitHub discovery wait",
    );

    waitingDatabase
      .prepare(
        `UPDATE project_poll_state
         SET last_captured_at = ?, last_attempt_at = ?,
             last_attempt_state = 'succeeded', last_error = NULL
         WHERE project = 'tailortales'`,
      )
      .run(new Date().toISOString(), new Date().toISOString());
    waitingDatabase.close();

    const recovered = runController(appDirectory, testHome);
    assert(
      recovered.plans.some(
        ({ runId, action }) => runId === "r_waiting_github" && action === "start",
      ),
      "A fresh successful project snapshot did not resume the primary Codex start",
    );

    const staleDatabase = new DatabaseSync(databasePath);
    const stale = new Date(Date.now() - 5 * 60 * 1_000).toISOString();
    staleDatabase
      .prepare(
        `UPDATE project_poll_state
         SET last_captured_at = ?, last_attempt_at = ?,
             last_attempt_state = 'succeeded'
         WHERE project = 'tailortales'`,
      )
      .run(stale, stale);
    staleDatabase.close();
    const stalePoll = runController(appDirectory, testHome);
    assert(
      !stalePoll.plans.some(
        ({ runId, action }) => runId === "r_waiting_github" && action === "start",
      ),
      "An old project snapshot was treated as fresh",
    );

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        pollFailureRecorded: true,
        latestFailureBlocksNewWriter: true,
        staleSuccessBlocksNewWriter: true,
        reconciliationContinues: true,
        liveCardStage: waitingCard.stage,
        freshSuccessResumes: true,
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
