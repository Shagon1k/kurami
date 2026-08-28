import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse, stringify } from "yaml";

type ProjectsRegistry = {
  projects: Record<
    string,
    { workspace: { worktree_root: string } }
  >;
};

process.umask(0o077);

type ConsumerResult = {
  ok: boolean;
  mode: string;
  processed: number;
  results: Array<{ action: string }>;
  activeGlobal: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runConsumer(appDirectory: string, testHome: string): ConsumerResult {
  const stdout = execFileSync(
    process.execPath,
    [resolve(appDirectory, "src/orchestrator/projects/process-project-events.ts")],
    {
      encoding: "utf8",
      env: { ...process.env, KURAMI_HOME: testHome },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(stdout) as ConsumerResult;
}

async function main(): Promise<void> {
  const appDirectory = resolve(import.meta.dirname, "..");
  const testHome = await mkdtemp(resolve(tmpdir(), "kurami-admission-test-"));

  try {
    await mkdir(resolve(testHome, "config"), { recursive: true, mode: 0o700 });
    const projectsPath = resolve(testHome, "config/projects.yaml");
    await copyFile(
      resolve(appDirectory, "deploy/config/projects.yaml"),
      projectsPath,
    );
    const projects = parse(await readFile(projectsPath, "utf8")) as ProjectsRegistry;
    for (const [project, config] of Object.entries(projects.projects)) {
      const worktreeRoot = resolve(testHome, "worktrees", project);
      await mkdir(worktreeRoot, { recursive: true, mode: 0o700 });
      config.workspace.worktree_root = worktreeRoot;
    }
    await writeFile(projectsPath, stringify(projects), { mode: 0o600 });
    await copyFile(
      resolve(appDirectory, "deploy/config/orchestrator.yaml"),
      resolve(testHome, "config/orchestrator.yaml"),
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
    const insert = database.prepare(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, from_status, to_status,
        payload_json
      ) VALUES (?, ?, 'tailortales', ?, ?, 'Issue', 'Shagon1k/TailorTales',
                ?, ?, ?, 'Backlog', 'In progress', ?)
    `);

    for (const [index, title] of [
      "[Test]: First synthetic run",
      "[Test]: Second synthetic run",
      "Unstructured fallback title",
    ].entries()) {
      const number = 9001 + index;
      insert.run(
        `synthetic-event-${index + 1}`,
        `2026-08-13T20:00:0${index}.000Z`,
        `synthetic-item-${index + 1}`,
        `synthetic-content-${index + 1}`,
        number,
        title,
        `https://example.invalid/issues/${number}`,
        JSON.stringify({
          issueState: "OPEN",
          labels: index === 0 ? ["human-control"] : [],
          hasDescription: true,
        }),
      );
    }
    database.close();

    const first = runConsumer(appDirectory, testHome);
    assert(first.processed === 3, `Expected 3 processed events, got ${first.processed}`);
    assert(
      first.results.map(({ action }) => action).join(",") ===
        "created,created,rejected",
      `Unexpected actions: ${JSON.stringify(first.results)}`,
    );
    assert(first.activeGlobal === 2, `Expected activeGlobal 2, got ${first.activeGlobal}`);

    const second = runConsumer(appDirectory, testHome);
    assert(second.processed === 0, `Repeat run processed ${second.processed} events`);

    const lifecycle = new DatabaseSync(databasePath);
    const transition = lifecycle.prepare(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, from_status, to_status,
        payload_json
      ) VALUES (?, ?, 'tailortales', 'synthetic-item-1', 'synthetic-content-1',
                'Issue', 'Shagon1k/TailorTales', 9001,
                '[Test]: First synthetic run',
                'https://example.invalid/issues/9001', ?, ?, ?)
    `);
    transition.run(
      "synthetic-review-event",
      "2026-08-13T20:01:00.000Z",
      "In progress",
      "Human Review",
      JSON.stringify({ issueState: "OPEN", labels: ["human-control"], hasDescription: true }),
    );
    lifecycle.close();
    const review = runConsumer(appDirectory, testHome);
    assert(review.processed === 1, "Human Review transition was not processed");

    const completion = new DatabaseSync(databasePath);
    completion
      .prepare(`
        INSERT INTO project_events (
          event_id, observed_at, project, item_id, content_id, content_type,
          repository, issue_number, title, url, from_status, to_status,
          payload_json
        ) VALUES (
          'synthetic-done-event', '2026-08-13T20:02:00.000Z',
          'tailortales', 'synthetic-item-1', 'synthetic-content-1', 'Issue',
          'Shagon1k/TailorTales', 9001, '[Test]: First synthetic run',
          'https://example.invalid/issues/9001', 'Human Review', 'Done', ?
        )
      `)
      .run(
        JSON.stringify({ issueState: "OPEN", labels: ["human-control"], hasDescription: true }),
      );
    completion.close();
    const done = runConsumer(appDirectory, testHome);
    assert(done.processed === 1, "Done transition was not processed");

    const verification = new DatabaseSync(databasePath, { readOnly: true });
    const runs = verification
      .prepare(`
        SELECT r.issue_number, r.state, r.interaction_policy, r.stop_reason,
               rr.branch_name, rr.worktree_path, rr.resource_state
        FROM runs r
        LEFT JOIN run_resources rr USING (run_id)
        ORDER BY r.issue_number
      `)
      .all();
    verification.close();

    assert(runs.length === 3, `Expected 3 run records, got ${runs.length}`);
    assert(
      (runs[0] as { interaction_policy: string }).interaction_policy === "human_control",
      "human-control label was not preserved",
    );
    assert(
      (runs[0] as { state: string; stop_reason: string }).state === "archived" &&
        (runs[0] as { stop_reason: string }).stop_reason === "completed",
      "Human Review -> Done did not archive the dry-run with completed intent",
    );
    assert(
      (runs[0] as { branch_name: string }).branch_name ===
        "TT-9001_first-synthetic-run",
      "Structured title did not produce the expected branch name",
    );
    assert(
      (runs[1] as { branch_name: string }).branch_name ===
        "TT-9002_second-synthetic-run",
      "Second structured title did not produce the expected branch name",
    );
    assert(
      (runs[0] as { worktree_path: string }).worktree_path.endsWith(
        "/TT-9001_first-synthetic-run/TailorTales",
      ),
      "Worktree path did not preserve the canonical repository basename",
    );
    assert(
      (runs[2] as { state: string; branch_name: string | null }).state === "rejected" &&
        (runs[2] as { branch_name: string | null }).branch_name === null,
      "WIP-rejected run unexpectedly received resources",
    );

    const cancellationRace = new DatabaseSync(databasePath);
    cancellationRace
      .prepare(
        `
        INSERT INTO project_events (
          event_id, observed_at, project, item_id, content_id, content_type,
          repository, issue_number, title, url, from_status, to_status,
          payload_json, processing_state
        ) VALUES (
          'cancel-race-trigger', '2026-08-13T21:00:00.000Z',
          'tailortales', 'cancel-race-item', 'cancel-race-content', 'Issue',
          'Shagon1k/TailorTales', 9010, '[Test]: Cancellation race',
          'https://example.invalid/issues/9010', 'Backlog', 'In progress',
          '{}', 'processed'
        )
      `,
      )
      .run();
    cancellationRace
      .prepare(
        `
        INSERT INTO runs (
          run_id, trigger_event_id, project, item_id, content_id, repository,
          issue_number, interaction_policy, state, owner_state, execution_mode,
          stop_reason
        ) VALUES (
          'r_cancel_race', 'cancel-race-trigger', 'tailortales',
          'cancel-race-item', 'cancel-race-content', 'Shagon1k/TailorTales',
          9010, 'autonomous', 'stopping', 'cli', 'live', 'cancelled'
        )
      `,
      )
      .run();
    cancellationRace
      .prepare(
        `
        INSERT INTO run_resources (
          run_id, resource_state, worktree_path, branch_name,
          tmux_session_name
        ) VALUES (
          'r_cancel_race', 'provisioned',
          '/tmp/worktrees/TT-9010_cancel-race/TailorTales',
          'TT-9010_cancel-race', 'cx-tt-9010-race'
        )
      `,
      )
      .run();
    cancellationRace
      .prepare(
        `
        INSERT INTO project_events (
          event_id, observed_at, project, item_id, content_id, content_type,
          repository, issue_number, title, url, from_status, to_status,
          payload_json
        ) VALUES (
          'cancel-race-review', '2026-08-13T21:01:00.000Z',
          'tailortales', 'cancel-race-item', 'cancel-race-content', 'Issue',
          'Shagon1k/TailorTales', 9010, '[Test]: Cancellation race',
          'https://example.invalid/issues/9010', 'In progress', 'Human Review',
          '{}'
        )
      `,
      )
      .run();
    cancellationRace.close();

    const raceResult = runConsumer(appDirectory, testHome);
    assert(
      raceResult.processed === 1 && raceResult.results[0]?.action === "ignored",
      "Human Review cancellation race was not ignored",
    );
    const raceCheck = new DatabaseSync(databasePath, { readOnly: true });
    const preservedCancellation = raceCheck
      .prepare(
        `SELECT state, stop_reason FROM runs WHERE run_id = 'r_cancel_race'`,
      )
      .get() as { state: string; stop_reason: string };
    raceCheck.close();
    assert(
      preservedCancellation.state === "stopping" &&
        preservedCancellation.stop_reason === "cancelled",
      "Human Review revived a run after cancellation intent was recorded",
    );

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        isolated: true,
        actions: first.results.map(({ action }) => action),
        activeGlobal: first.activeGlobal,
        repeatProcessed: second.processed,
        cancellationRacePreserved: true,
        runs,
      })}\n`,
    );
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
