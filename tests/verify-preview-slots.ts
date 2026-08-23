import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

process.umask(0o077);

type ManagerResult = {
  ok: boolean;
  action: string;
  slotNumber?: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runManager(
  appDirectory: string,
  testHome: string,
  args: string[],
): ManagerResult {
  const stdout = execFileSync(
    process.execPath,
    [resolve(appDirectory, "src/preview-manager.ts"), ...args],
    {
      encoding: "utf8",
      env: { ...process.env, ORCHESTRATOR_HOME: testHome },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(stdout) as ManagerResult;
}

async function main(): Promise<void> {
  const appDirectory = resolve(import.meta.dirname, "..");
  const testHome = await mkdtemp(resolve(tmpdir(), "kurami-preview-slots-test-"));

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
    execFileSync(process.execPath, [resolve(appDirectory, "src/init-run-store.ts")], {
      env: {
        ...process.env,
        ORCHESTRATOR_HOME: testHome,
        ORCHESTRATOR_MIGRATIONS_DIR: resolve(appDirectory, "migrations"),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });

    const databasePath = resolve(testHome, "state/orchestrator.db");
    const database = new DatabaseSync(databasePath);
    const insertEvent = database.prepare(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, from_status, to_status, payload_json,
        processing_state
      ) VALUES (?, '2026-08-14T12:00:00.000Z', 'tailortales', ?, ?, 'Issue',
                'Shagon1k/TailorTales', ?, ?, ?, 'In progress', 'Human Review',
                '{"issueState":"OPEN","labels":[],"hasDescription":true}', 'processed')
    `);
    const insertRun = database.prepare(`
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode
      ) VALUES (?, ?, 'tailortales', ?, ?, 'Shagon1k/TailorTales', ?,
                'autonomous', 'parked_review', 'remote', 'live')
    `);
    const insertResource = database.prepare(`
      INSERT INTO run_resources (run_id, resource_state, worktree_path, branch_name)
      VALUES (?, 'provisioned', ?, ?)
    `);
    for (let index = 1; index <= 7; index += 1) {
      const runId = `r_preview_test_${index}`;
      const eventId = `preview-event-${index}`;
      const itemId = `preview-item-${index}`;
      const contentId = `preview-content-${index}`;
      const issueNumber = 9100 + index;
      insertEvent.run(
        eventId,
        itemId,
        contentId,
        issueNumber,
        `[Test]: Preview ${index}`,
        `https://example.invalid/issues/${issueNumber}`,
      );
      insertRun.run(runId, eventId, itemId, contentId, issueNumber);
      insertResource.run(
        runId,
        `/tmp/worktrees/preview-${index}/TailorTales`,
        `TT-${issueNumber}_preview-${index}`,
      );
    }
    database.close();

    const allocations = [];
    for (let index = 1; index <= 6; index += 1) {
      allocations.push(
        runManager(appDirectory, testHome, [
          "allocate",
          "--run-id",
          `r_preview_test_${index}`,
          "--apply",
        ]),
      );
    }
    assert(
      allocations.map(({ slotNumber }) => slotNumber).join(",") === "1,2,3,4,5,6",
      `Unexpected slot order: ${JSON.stringify(allocations)}`,
    );

    const repeated = runManager(appDirectory, testHome, [
      "allocate",
      "--run-id",
      "r_preview_test_1",
      "--apply",
    ]);
    assert(repeated.action === "existing", "Repeated allocation was not idempotent");

    const exhausted = spawnSync(
      process.execPath,
      [
        resolve(appDirectory, "src/preview-manager.ts"),
        "allocate",
        "--run-id",
        "r_preview_test_7",
        "--apply",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, ORCHESTRATOR_HOME: testHome },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    assert(exhausted.status !== 0, "Seventh active preview was unexpectedly allocated");
    assert(
      exhausted.stderr.includes("Preview cap reached"),
      `Unexpected exhaustion error: ${exhausted.stderr}`,
    );

    const release = runManager(appDirectory, testHome, [
      "release",
      "--run-id",
      "r_preview_test_1",
      "--apply",
      "--runtime-absent",
    ]);
    assert(release.action === "released", "Lease release did not apply");
    const replacement = runManager(appDirectory, testHome, [
      "allocate",
      "--run-id",
      "r_preview_test_7",
      "--apply",
    ]);
    assert(replacement.slotNumber === 1, "Released slot 1 was not reused first");

    const verification = new DatabaseSync(databasePath, { readOnly: true });
    const active = verification
      .prepare("SELECT COUNT(*) AS count FROM preview_leases WHERE state <> 'released'")
      .get() as { count: number };
    const released = verification
      .prepare("SELECT COUNT(*) AS count FROM preview_leases WHERE state = 'released'")
      .get() as { count: number };
    const mapped = verification
      .prepare("SELECT COUNT(*) AS count FROM run_resources WHERE preview_id IS NOT NULL")
      .get() as { count: number };
    verification.close();

    assert(active.count === 6, `Expected 6 active leases, got ${active.count}`);
    assert(released.count === 1, `Expected 1 released lease, got ${released.count}`);
    assert(mapped.count === 6, `Expected 6 mapped resources, got ${mapped.count}`);

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        isolated: true,
        allocatedSlots: allocations.map(({ slotNumber }) => slotNumber),
        repeated: repeated.action,
        exhausted: exhausted.status !== 0,
        released: release.slotNumber,
        reused: replacement.slotNumber,
        active: active.count,
        historicalReleased: released.count,
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
