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

async function initializeThroughV23(
  appDirectory: string,
  home: string,
): Promise<void> {
  const oldMigrations = resolve(home, "migrations-v23");
  await mkdir(oldMigrations, { recursive: true, mode: 0o700 });
  for (const name of await readdir(resolve(appDirectory, "migrations"))) {
    const number = Number(name.slice(0, 3));
    if (/^\d{3}_[a-z0-9_]+\.sql$/u.test(name) && number <= 23) {
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
}

function seed(database: DatabaseSync): void {
  database
    .prepare(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, from_status, to_status,
        payload_json, processing_state
      ) VALUES (
        'event-preview-reviewed', '2026-08-20T12:00:00.000Z', 'tailortales',
        'item-preview-reviewed', 'content-preview-reviewed', 'Issue',
        'Shagon1k/TailorTales', 9902, '[Test]: Preview reviewed',
        'https://example.invalid/issues/9902', 'In progress', 'Human Review',
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
        'r_preview_reviewed', 'event-preview-reviewed', 'tailortales',
        'item-preview-reviewed', 'content-preview-reviewed',
        'Shagon1k/TailorTales', 9902, 'autonomous', 'parked_review',
        'none', 'live'
      )
    `)
    .run();
  database
    .prepare(`
      INSERT INTO run_resources (
        run_id, resource_state, worktree_path, branch_name, codex_thread_id,
        preview_id
      ) VALUES (
        'r_preview_reviewed', 'provisioned',
        '/tmp/worktrees/reviewed/TailorTales', 'TT-9902_preview-reviewed',
        'thread-preview-reviewed', 'preview-1'
      )
    `)
    .run();
  database
    .prepare(`
      INSERT INTO run_ci_snapshots (
        run_id, repository, pull_request_number, pull_request_url,
        pull_request_title, head_sha, aggregate_state, checks_json,
        content_digest, first_observed_at, last_observed_at, completed_at
      ) VALUES (
        'r_preview_reviewed', 'Shagon1k/TailorTales', 9902,
        'https://example.invalid/pulls/9902', 'Preview reviewed',
        'preview-reviewed-sha', 'passed', '[]', 'preview-reviewed-ci',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
    `)
    .run();
  database
    .prepare(`
      INSERT INTO preview_leases (
        lease_id, run_id, slot_number, state, compose_project_name, expires_at
      ) VALUES (
        'pv_preview_reviewed', 'r_preview_reviewed', 1, 'running',
        'kurami-pv1-previewreviewed',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+2 hours')
      )
    `)
    .run();
}

async function main(): Promise<void> {
  const appDirectory = resolve(import.meta.dirname, "..");
  const home = await mkdtemp(resolve(tmpdir(), "kurami-preview-reviewed-test-"));
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
    await initializeThroughV23(appDirectory, home);
    const databasePath = resolve(home, "state/orchestrator.db");
    const v23 = new DatabaseSync(databasePath);
    seed(v23);
    v23.close();

    runNode(appDirectory, home, "src/orchestrator/state/init-run-store.ts", []);
    const enrolled = new DatabaseSync(databasePath);
    enrolled
      .prepare(`
        UPDATE runs
        SET preview_required=1, preview_required_label='preview-required'
        WHERE run_id='r_preview_reviewed'
      `)
      .run();
    enrolled
      .prepare(`
        UPDATE preview_leases
        SET verified_head_sha='preview-reviewed-sha'
        WHERE lease_id='pv_preview_reviewed'
      `)
      .run();
    enrolled.close();
    const migrated = new DatabaseSync(databasePath, { readOnly: true });
    const initial = migrated
      .prepare(`
        SELECT state, expires_at, reviewed_at, reviewed_by, reviewed_via
        FROM preview_leases WHERE lease_id='pv_preview_reviewed'
      `)
      .get() as Record<string, string | null>;
    migrated.close();
    assert(initial.state === "running", "Populated v23 lease was not preserved");
    assert(
      initial.reviewed_at === null &&
        initial.reviewed_by === null &&
        initial.reviewed_via === null,
      "Migration invented an owner acknowledgement",
    );
    const invalidProvenance = new DatabaseSync(databasePath);
    let provenanceRejected = false;
    try {
      invalidProvenance
        .prepare(`
          UPDATE preview_leases SET reviewed_at=?
          WHERE lease_id='pv_preview_reviewed'
        `)
        .run("2026-08-20T12:01:00.000Z");
    } catch {
      provenanceRejected = true;
    } finally {
      invalidProvenance.close();
    }
    assert(provenanceRejected, "Partial review provenance was accepted");

    const dry = runNode(appDirectory, home, "src/orchestrator/projects/previews/manager.ts", [
      "review",
      "--run-id",
      "r_preview_reviewed",
      "--reviewed-by",
      "discord:123456789",
    ]);
    assert(dry.action === "review", "Review dry plan was not produced");
    const applied = runNode(appDirectory, home, "src/orchestrator/projects/previews/manager.ts", [
      "review",
      "--run-id",
      "r_preview_reviewed",
      "--reviewed-by",
      "discord:123456789",
      "--apply",
    ]);
    assert(applied.action === "reviewed", "Preview acknowledgement was not applied");
    assert(
      applied.reviewedBy === "discord:123456789" &&
        applied.reviewedVia === "discord",
      "Owner provenance was not preserved",
    );
    const repeated = runNode(appDirectory, home, "src/orchestrator/projects/previews/manager.ts", [
      "review",
      "--run-id",
      "r_preview_reviewed",
      "--reviewed-by",
      "cli:owner",
      "--apply",
    ]);
    assert(repeated.action === "already_reviewed", "Acknowledgement is not idempotent");

    const verified = new DatabaseSync(databasePath);
    const after = verified
      .prepare(`
        SELECT state, expires_at, reviewed_at, reviewed_by, reviewed_via
        FROM preview_leases WHERE lease_id='pv_preview_reviewed'
      `)
      .get() as Record<string, string | null>;
    const audit = verified
      .prepare(`
        SELECT COUNT(*) AS count FROM run_state_history
        WHERE run_id='r_preview_reviewed' AND reason='preview_reviewed'
      `)
      .get() as { count: number };
    const evidence = verified
      .prepare(`
        SELECT preview_requirement_satisfied_at, preview_requirement_lease_id
        FROM runs WHERE run_id='r_preview_reviewed'
      `)
      .get() as Record<string, string | null>;
    assert(after.state === initial.state, "Acknowledgement changed preview state");
    assert(after.expires_at === initial.expires_at, "Acknowledgement changed TTL");
    assert(after.reviewed_by === "discord:123456789", "First owner provenance drifted");
    assert(
      evidence.preview_requirement_satisfied_at !== null &&
        evidence.preview_requirement_lease_id === "pv_preview_reviewed",
      "Exact reviewed preview did not persist durable policy evidence",
    );
    assert(audit.count === 1, "Acknowledgement audit is missing or duplicated");
    verified
      .prepare(`
        UPDATE preview_leases
        SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute')
        WHERE lease_id='pv_preview_reviewed'
      `)
      .run();
    verified.close();
    const expired = nodeFails(appDirectory, home, "src/orchestrator/projects/previews/manager.ts", [
      "review",
      "--run-id",
      "r_preview_reviewed",
      "--reviewed-by",
      "cli:owner",
      "--apply",
    ]);
    assert(expired.includes("expired"), "Expired preview was reviewable");
    const invalidActor = nodeFails(appDirectory, home, "src/orchestrator/projects/previews/manager.ts", [
      "review",
      "--run-id",
      "r_preview_reviewed",
      "--reviewed-by",
      "discord:not-a-user",
    ]);
    assert(invalidActor.includes("numeric-id"), "Invalid actor was accepted");

    runNode(appDirectory, home, "src/orchestrator/projects/previews/manager.ts", [
      "release",
      "--run-id",
      "r_preview_reviewed",
      "--apply",
      "--runtime-absent",
    ]);
    runNode(appDirectory, home, "src/orchestrator/projects/previews/manager.ts", [
      "allocate",
      "--run-id",
      "r_preview_reviewed",
      "--apply",
    ]);
    const reset = new DatabaseSync(databasePath, { readOnly: true });
    const nextLease = reset
      .prepare(`
        SELECT state, reviewed_at, reviewed_by, reviewed_via
        FROM preview_leases
        WHERE run_id='r_preview_reviewed' AND state <> 'released'
      `)
      .get() as Record<string, string | null>;
    const persistedEvidence = reset
      .prepare(`
        SELECT preview_requirement_satisfied_at, preview_requirement_lease_id
        FROM runs WHERE run_id='r_preview_reviewed'
      `)
      .get() as Record<string, string | null>;
    const foreignKeys = reset.prepare("PRAGMA foreign_key_check").all();
    reset.close();
    assert(
      nextLease.state === "leased" &&
        nextLease.reviewed_at === null &&
        nextLease.reviewed_by === null &&
        nextLease.reviewed_via === null,
      "A new lease inherited the previous acknowledgement",
    );
    assert(
      persistedEvidence.preview_requirement_satisfied_at !== null &&
        persistedEvidence.preview_requirement_lease_id === "pv_preview_reviewed",
      "Stopping a reviewed preview erased durable policy evidence",
    );
    assert(foreignKeys.length === 0, "P5b migration introduced foreign-key drift");

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        populatedV23UpgradePreserved: true,
        exactLeaseAcknowledgement: true,
        ownerProvenance: true,
        partialProvenanceRejected: true,
        lifecycleUnchanged: true,
        ttlUnchanged: true,
        idempotent: true,
        expiredRejected: true,
        newLeaseRequiresReview: true,
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
