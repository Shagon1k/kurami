import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runNode(
  appDirectory: string,
  home: string,
  relativePath: string,
  args: string[],
): Record<string, unknown> {
  const stdout = execFileSync(
    process.execPath,
    [resolve(appDirectory, relativePath), ...args],
    {
      encoding: "utf8",
      env: { ...process.env, KURAMI_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(stdout) as Record<string, unknown>;
}

function nodeFails(
  appDirectory: string,
  home: string,
  relativePath: string,
  args: string[],
): string {
  const result = spawnSync(
    process.execPath,
    [resolve(appDirectory, relativePath), ...args],
    {
      encoding: "utf8",
      env: { ...process.env, KURAMI_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assert(result.status !== 0, `Expected ${relativePath} to fail`);
  return result.stderr;
}

async function initializeThroughV22(
  appDirectory: string,
  home: string,
): Promise<string> {
  const oldMigrations = resolve(home, "migrations-v22");
  await mkdir(oldMigrations, { recursive: true, mode: 0o700 });
  for (const name of await readdir(resolve(appDirectory, "migrations"))) {
    const number = Number(name.slice(0, 3));
    if (/^\d{3}_[a-z0-9_]+\.sql$/u.test(name) && number <= 22) {
      await copyFile(
        resolve(appDirectory, "migrations", name),
        resolve(oldMigrations, name),
      );
    }
  }
  execFileSync(process.execPath, [resolve(appDirectory, "src/orchestrator/state/init-run-store.ts")], {
    env: {
      ...process.env,
      KURAMI_HOME: home,
      ORCHESTRATOR_MIGRATIONS_DIR: oldMigrations,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  return oldMigrations;
}

function seedRun(database: DatabaseSync): void {
  database
    .prepare(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, from_status, to_status,
        payload_json, processing_state
      ) VALUES (
        'event-preview-ttl', '2026-08-20T10:00:00.000Z', 'tailortales',
        'item-preview-ttl', 'content-preview-ttl', 'Issue',
        'Shagon1k/TailorTales', 9901, '[Test]: Preview TTL',
        'https://example.invalid/issues/9901', 'In progress', 'Human Review',
        '{"issueState":"OPEN","labels":[],"hasDescription":true}', 'processed'
      )
    `)
    .run();
  database
    .prepare(`
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode
      ) VALUES (
        'r_preview_ttl', 'event-preview-ttl', 'tailortales',
        'item-preview-ttl', 'content-preview-ttl', 'Shagon1k/TailorTales',
        9901, 'autonomous', 'parked_review', 'none', 'live'
      )
    `)
    .run();
  database
    .prepare(`
      INSERT INTO run_resources (
        run_id, resource_state, worktree_path, branch_name, codex_thread_id,
        preview_id
      ) VALUES (
        'r_preview_ttl', 'provisioned', '/tmp/worktrees/ttl/TailorTales',
        'TT-9901_preview-ttl', 'thread-preview-ttl', 'preview-1'
      )
    `)
    .run();
  database
    .prepare(`
      INSERT INTO preview_leases (
        lease_id, run_id, slot_number, state, compose_project_name
      ) VALUES (
        'pv_preview_ttl', 'r_preview_ttl', 1, 'running',
        'kurami-pv1-previewttl'
      )
    `)
    .run();
}

async function main(): Promise<void> {
  const appDirectory = resolve(import.meta.dirname, "..");
  const home = await mkdtemp(resolve(tmpdir(), "kurami-preview-ttl-test-"));
  try {
    await mkdir(resolve(home, "config"), { recursive: true, mode: 0o700 });
    await copyFile(
      resolve(appDirectory, "deploy/config/orchestrator.yaml"),
      resolve(home, "config/orchestrator.yaml"),
    );
    await copyFile(
      resolve(appDirectory, "deploy/config/projects.yaml"),
      resolve(home, "config/projects.yaml"),
    );
    await initializeThroughV22(appDirectory, home);
    const databasePath = resolve(home, "state/orchestrator.db");
    const v22 = new DatabaseSync(databasePath);
    seedRun(v22);
    v22.close();

    runNode(appDirectory, home, "src/orchestrator/state/init-run-store.ts", []);
    const migrated = new DatabaseSync(databasePath);
    const grace = migrated
      .prepare(`SELECT expires_at FROM preview_leases WHERE lease_id='pv_preview_ttl'`)
      .get() as { expires_at: string | null };
    assert(
      grace.expires_at && Date.parse(grace.expires_at) > Date.now() + 23 * 60 * 60 * 1_000,
      "Existing active preview did not receive a safe rollout grace period",
    );

    migrated
      .prepare(`
        UPDATE preview_leases
        SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour')
        WHERE lease_id='pv_preview_ttl'
      `)
      .run();
    migrated.close();

    const controls = runNode(appDirectory, home, "src/orchestrator/controls/run.ts", [
      "controls",
      "--project",
      "tailortales",
      "--issue",
      "9901",
    ]);
    assert(
      (controls.available_actions as string[]).includes("preview_start") &&
        (controls.available_actions as string[]).includes("preview_stop"),
      "Warning window did not expose both extend and stop controls",
    );

    const planned = runNode(appDirectory, home, "src/orchestrator/projects/previews/manager.ts", [
      "extend",
      "--run-id",
      "r_preview_ttl",
    ]);
    assert(planned.action === "extend", "Extension dry plan was not produced");
    const extended = runNode(appDirectory, home, "src/orchestrator/projects/previews/manager.ts", [
      "extend",
      "--run-id",
      "r_preview_ttl",
      "--apply",
    ]);
    assert(extended.action === "extended", "Extension was not applied");
    assert(extended.extensionCount === 1, "Extension count was not recorded");

    const earlyFailure = nodeFails(
      appDirectory,
      home,
      "src/orchestrator/projects/previews/manager.ts",
      ["extend", "--run-id", "r_preview_ttl", "--apply"],
    );
    assert(
      earlyFailure.includes("expiry warning window"),
      "An early repeated extension was not rejected",
    );

    const expired = new DatabaseSync(databasePath);
    expired
      .prepare(`
        UPDATE preview_leases
        SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute')
        WHERE lease_id='pv_preview_ttl'
      `)
      .run();
    expired
      .prepare(`UPDATE runs SET state='needs_attention' WHERE run_id='r_preview_ttl'`)
      .run();
    expired
      .prepare(`
        INSERT INTO run_control_requests (
          request_id, run_id, action, requested_via, idempotency_key
        ) VALUES (
          'rq_preview_ttl_pending', 'r_preview_ttl', 'take_control', 'discord',
          'preview-ttl-pending-request'
        )
      `)
      .run();
    expired.close();
    const controller = runNode(appDirectory, home, "src/orchestrator/runtime/controller.ts", []);
    const expiryPlan = (controller.plans as Array<Record<string, unknown>>).find(
      (plan) => plan.runId === "r_preview_ttl",
    );
    assert(
      expiryPlan?.action === "preview_expire" &&
        expiryPlan.reason === "preview_ttl_expired" &&
        expiryPlan.requestId === undefined,
      "Expired preview did not plan guarded cleanup",
    );
    const pendingExtension = new DatabaseSync(databasePath);
    pendingExtension
      .prepare(`
        UPDATE run_control_requests
        SET action='preview_start'
        WHERE request_id='rq_preview_ttl_pending'
      `)
      .run();
    pendingExtension.close();
    const extensionRace = runNode(appDirectory, home, "src/orchestrator/runtime/controller.ts", []);
    const extensionRacePlan = (
      extensionRace.plans as Array<Record<string, unknown>>
    ).find((plan) => plan.runId === "r_preview_ttl");
    assert(
      extensionRacePlan?.action === "preview_expire" &&
        extensionRacePlan.requestId === "rq_preview_ttl_pending" &&
        extensionRacePlan.requestOutcome === "rejected",
      "Expired extension request could survive cleanup and restart the preview",
    );
    const expiredFailure = nodeFails(
      appDirectory,
      home,
      "src/orchestrator/projects/previews/manager.ts",
      ["extend", "--run-id", "r_preview_ttl", "--apply"],
    );
    assert(
      expiredFailure.includes("already expired"),
      "Expired preview was unexpectedly extendable",
    );
    const released = runNode(appDirectory, home, "src/orchestrator/projects/previews/manager.ts", [
      "release",
      "--run-id",
      "r_preview_ttl",
      "--apply",
      "--runtime-absent",
      "--release-reason",
      "preview_ttl_expired",
    ]);
    assert(released.action === "released", "Expired lease was not releasable after proof");
    const reallocate = new DatabaseSync(databasePath);
    reallocate
      .prepare(`UPDATE runs SET state='parked_review' WHERE run_id='r_preview_ttl'`)
      .run();
    reallocate.close();
    runNode(appDirectory, home, "src/orchestrator/projects/previews/manager.ts", [
      "allocate",
      "--run-id",
      "r_preview_ttl",
      "--apply",
    ]);

    const verification = new DatabaseSync(databasePath, { readOnly: true });
    const history = verification
      .prepare(`
        SELECT COUNT(*) AS count FROM run_state_history
        WHERE run_id='r_preview_ttl' AND reason='preview_ttl_extended'
      `)
      .get() as { count: number };
    const releaseAudit = verification
      .prepare(`
        SELECT release_reason FROM preview_leases
        WHERE lease_id='pv_preview_ttl'
      `)
      .get() as { release_reason: string | null };
    const unbuiltLease = verification
      .prepare(`
        SELECT expires_at FROM preview_leases
        WHERE run_id='r_preview_ttl' AND state='leased'
      `)
      .get() as { expires_at: string | null };
    const foreignKeys = verification.prepare("PRAGMA foreign_key_check").all();
    verification.close();
    assert(history.count === 1, "Extension provenance was not appended");
    assert(
      releaseAudit.release_reason === "preview_ttl_expired",
      "TTL cleanup reason was not preserved in lease history",
    );
    assert(
      unbuiltLease.expires_at === null,
      "TTL started during allocation instead of after successful health checks",
    );
    assert(foreignKeys.length === 0, "P5a migration introduced foreign-key drift");

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        populatedV22UpgradePreserved: true,
        existingPreviewGraceHours: 24,
        allocationDoesNotStartTtl: true,
        warningHours: 2,
        extensionHours: 24,
        ownerExtensionRecorded: true,
        earlyRepeatRejected: true,
        expiredExtensionRejected: true,
        expiredCleanupPlanned: "revoke_first_guarded_down",
        expiredExtensionRaceRejected: true,
        ttlReleaseAudited: true,
      })}\n`,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
