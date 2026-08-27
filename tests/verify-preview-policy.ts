import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runNode(
  appDirectory: string,
  home: string,
  relativePath: string,
  args: string[] = [],
): Record<string, unknown> {
  const stdout = execFileSync(
    process.execPath,
    [resolve(appDirectory, relativePath), ...args],
    {
      encoding: "utf8",
      env: { ...process.env, ORCHESTRATOR_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function initializeThroughV24(
  appDirectory: string,
  home: string,
): Promise<void> {
  const oldMigrations = resolve(home, "migrations-v24");
  await mkdir(oldMigrations, { recursive: true, mode: 0o700 });
  for (const name of await readdir(resolve(appDirectory, "migrations"))) {
    const number = Number(name.slice(0, 3));
    if (/^\d{3}_[a-z0-9_]+\.sql$/u.test(name) && number <= 24) {
      await copyFile(
        resolve(appDirectory, "migrations", name),
        resolve(oldMigrations, name),
      );
    }
  }
  execFileSync(process.execPath, [resolve(appDirectory, "src/init-run-store.ts")], {
    env: {
      ...process.env,
      ORCHESTRATOR_HOME: home,
      ORCHESTRATOR_MIGRATIONS_DIR: oldMigrations,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function insertEvent(
  database: DatabaseSync,
  values: {
    id: string;
    item: string;
    content: string;
    issue: number;
    from: string;
    to: string;
    labels: string[];
    observedAt: string;
  },
  processed = false,
): void {
  database
    .prepare(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, from_status, to_status,
        payload_json, processing_state
      ) VALUES (?, ?, 'tailortales', ?, ?, 'Issue', 'Shagon1k/TailorTales',
                ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      values.id,
      values.observedAt,
      values.item,
      values.content,
      values.issue,
      `[Test]: Preview policy ${values.issue}`,
      `https://example.invalid/issues/${values.issue}`,
      values.from,
      values.to,
      JSON.stringify({
        issueState: "OPEN",
        labels: values.labels,
        hasDescription: true,
      }),
      processed ? "processed" : "pending",
    );
}

async function main(): Promise<void> {
  const appDirectory = resolve(import.meta.dirname, "..");
  const home = await mkdtemp(resolve(tmpdir(), "kurami-preview-policy-test-"));
  try {
    await mkdir(resolve(home, "config"), { recursive: true, mode: 0o700 });
    await copyFile(
      resolve(appDirectory, "deploy/config/orchestrator.yaml"),
      resolve(home, "config/orchestrator.yaml"),
    );
    const projectsPath = resolve(home, "config/projects.yaml");
    await copyFile(
      resolve(appDirectory, "deploy/config/projects.yaml"),
      projectsPath,
    );
    const projects = parse(await readFile(projectsPath, "utf8")) as ProjectsRegistry;
    for (const [project, config] of Object.entries(projects.projects)) {
      const worktreeRoot = resolve(home, "worktrees", project);
      await mkdir(worktreeRoot, { recursive: true, mode: 0o700 });
      config.workspace.worktree_root = worktreeRoot;
    }
    await writeFile(projectsPath, stringify(projects), { mode: 0o600 });
    await initializeThroughV24(appDirectory, home);
    const databasePath = resolve(home, "state/orchestrator.db");
    const old = new DatabaseSync(databasePath);
    insertEvent(
      old,
      {
        id: "legacy-preview-policy-event",
        item: "legacy-preview-policy-item",
        content: "legacy-preview-policy-content",
        issue: 9949,
        from: "Backlog",
        to: "In progress",
        labels: [],
        observedAt: "2026-08-20T15:00:00.000Z",
      },
      true,
    );
    old
      .prepare(`
        INSERT INTO runs (
          run_id, trigger_event_id, project, item_id, content_id, repository,
          issue_number, interaction_policy, state, owner_state, execution_mode
        ) VALUES (
          'r_preview_policy_legacy', 'legacy-preview-policy-event',
          'tailortales', 'legacy-preview-policy-item',
          'legacy-preview-policy-content', 'Shagon1k/TailorTales', 9949,
          'autonomous', 'archived', 'none', 'live'
        )
      `)
      .run();
    old.close();

    runNode(appDirectory, home, "src/init-run-store.ts");
    const migrated = new DatabaseSync(databasePath, { readOnly: true });
    const legacy = migrated
      .prepare(`
        SELECT preview_required, preview_required_label,
               completion_requested_at, preview_requirement_satisfied_at
        FROM runs WHERE run_id='r_preview_policy_legacy'
      `)
      .get() as Record<string, string | number | null>;
    migrated.close();
    assert(
      legacy.preview_required === 0 && legacy.preview_required_label === null,
      "Populated v24 run was unexpectedly enrolled in preview policy",
    );

    const seed = new DatabaseSync(databasePath);
    insertEvent(seed, {
      id: "preview-policy-activation",
      item: "preview-policy-item",
      content: "preview-policy-content",
      issue: 9950,
      from: "Backlog",
      to: "In progress",
      labels: ["preview-required"],
      observedAt: "2026-08-20T15:01:00.000Z",
    });
    insertEvent(seed, {
      id: "ordinary-policy-activation",
      item: "ordinary-policy-item",
      content: "ordinary-policy-content",
      issue: 9951,
      from: "Backlog",
      to: "In progress",
      labels: [],
      observedAt: "2026-08-20T15:01:01.000Z",
    });
    seed.close();
    runNode(appDirectory, home, "src/process-project-events.ts");

    const prepare = new DatabaseSync(databasePath);
    const requiredRun = prepare
      .prepare(`SELECT run_id FROM runs WHERE issue_number=9950`)
      .get() as { run_id: string };
    const ordinaryRun = prepare
      .prepare(`SELECT run_id FROM runs WHERE issue_number=9951`)
      .get() as { run_id: string };
    const admission = prepare
      .prepare(`
        SELECT preview_required, preview_required_label
        FROM runs WHERE run_id=?
      `)
      .get(requiredRun.run_id) as {
      preview_required: number;
      preview_required_label: string | null;
    };
    assert(
      admission.preview_required === 1 &&
        admission.preview_required_label === "preview-required",
      "Exact admission label did not enroll the run",
    );
    prepare
      .prepare(`UPDATE runs SET state='parked_review' WHERE run_id=?`)
      .run(requiredRun.run_id);
    prepare
      .prepare(`
        UPDATE run_resources
        SET resource_state='provisioned',
            worktree_path='/tmp/worktrees/TT-9950_preview-policy/TailorTales',
            branch_name='TT-9950_preview-policy'
        WHERE run_id=?
      `)
      .run(requiredRun.run_id);
    prepare
      .prepare(`
        INSERT INTO run_ci_snapshots (
          run_id, repository, pull_request_number, pull_request_url,
          pull_request_title, head_sha, aggregate_state, checks_json,
          content_digest, first_observed_at, last_observed_at, completed_at
        ) VALUES (?, 'Shagon1k/TailorTales', 9950,
                  'https://example.invalid/pulls/9950', 'Preview policy',
                  'abcdef1234567890', 'passed', '[]', 'ci-policy',
                  '2026-08-20T15:02:00.000Z', '2026-08-20T15:02:00.000Z',
                  '2026-08-20T15:02:00.000Z')
      `)
      .run(requiredRun.run_id);
    insertEvent(prepare, {
      id: "preview-policy-done",
      item: "preview-policy-item",
      content: "preview-policy-content",
      issue: 9950,
      from: "Human Review",
      to: "Done",
      labels: ["preview-required"],
      observedAt: "2026-08-20T15:03:00.000Z",
    });
    insertEvent(prepare, {
      id: "ordinary-policy-done",
      item: "ordinary-policy-item",
      content: "ordinary-policy-content",
      issue: 9951,
      from: "In progress",
      to: "Done",
      labels: [],
      observedAt: "2026-08-20T15:03:01.000Z",
    });
    prepare.close();

    const completion = runNode(
      appDirectory,
      home,
      "src/process-project-events.ts",
    ) as { results: Array<{ reason?: string }> };
    assert(
      completion.results.some(({ reason }) => reason === "preview_required"),
      "Required completion was not deferred",
    );
    const deferred = new DatabaseSync(databasePath);
    const requiredAfterDone = deferred
      .prepare(`
        SELECT state, stop_reason, completion_requested_at,
               preview_requirement_satisfied_at
        FROM runs WHERE run_id=?
      `)
      .get(requiredRun.run_id) as Record<string, string | null>;
    const ordinaryAfterDone = deferred
      .prepare(`SELECT state, stop_reason FROM runs WHERE run_id=?`)
      .get(ordinaryRun.run_id) as { state: string; stop_reason: string | null };
    assert(
      requiredAfterDone.state === "parked_review" &&
        requiredAfterDone.stop_reason === null &&
        requiredAfterDone.completion_requested_at !== null,
      "Required run did not preserve pending completion",
    );
    assert(
      ordinaryAfterDone.state === "archived" &&
        ordinaryAfterDone.stop_reason === "completed",
      "Unlabelled run was affected by preview policy",
    );
    deferred.close();
    runNode(appDirectory, home, "src/controller.ts", ["--apply"]);
    const ownerVisible = new DatabaseSync(databasePath, { readOnly: true });
    const ownerVisibleCard = ownerVisible
      .prepare(`SELECT stage FROM run_progress_cards WHERE run_id=?`)
      .get(requiredRun.run_id) as { stage: string };
    ownerVisible.close();
    assert(
      ownerVisibleCard.stage === "preview_required",
      "Deferred completion was not presented as Preview required",
    );
    const previewSeed = new DatabaseSync(databasePath);
    previewSeed
      .prepare(`
        UPDATE run_resources SET preview_id='preview-1' WHERE run_id=?
      `)
      .run(requiredRun.run_id);
    previewSeed
      .prepare(`
        INSERT INTO preview_leases (
          lease_id, run_id, slot_number, state, compose_project_name,
          expires_at, verified_head_sha,
          reviewed_at, reviewed_by, reviewed_via
        ) VALUES (
          'pv_preview_policy', ?, 1, 'running', 'kurami-pv1-policysmoke',
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+4 hours'),
          'oldhead1234567', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          'cli:owner', 'cli'
        )
      `)
      .run(requiredRun.run_id);
    previewSeed.close();

    const stalePlan = runNode(appDirectory, home, "src/controller.ts") as {
      plans: Array<{ action: string }>;
    };
    assert(
      !stalePlan.plans.some(
        ({ action }) => action === "preview_requirement_complete",
      ),
      "Stale preview satisfied the exact-SHA gate",
    );
    const exact = new DatabaseSync(databasePath);
    exact
      .prepare(`
        UPDATE preview_leases SET verified_head_sha='abcdef1234567890'
        WHERE lease_id='pv_preview_policy'
      `)
      .run();
    exact
      .prepare(`
        UPDATE runs SET state='remote_owned', owner_state='remote'
        WHERE run_id=?
      `)
      .run(requiredRun.run_id);
    exact.close();
    const exactPlan = runNode(appDirectory, home, "src/controller.ts") as {
      plans: Array<{ action: string }>;
    };
    assert(
      exactPlan.plans.some(
        ({ action }) => action === "preview_requirement_complete",
      ),
      "Exact reviewed preview did not queue guarded completion",
    );
    runNode(appDirectory, home, "src/controller.ts", ["--apply"]);

    const final = new DatabaseSync(databasePath, { readOnly: true });
    const completed = final
      .prepare(`
        SELECT state, owner_state, stop_reason, preview_requirement_satisfied_at,
               preview_requirement_lease_id
        FROM runs WHERE run_id=?
      `)
      .get(requiredRun.run_id) as Record<string, string | null>;
    const audit = final
      .prepare(`
        SELECT COUNT(*) AS count FROM run_state_history
        WHERE run_id=? AND reason='preview_requirement_satisfied'
      `)
      .get(requiredRun.run_id) as { count: number };
    const foreignKeys = final.prepare("PRAGMA foreign_key_check").all();
    final.close();
    assert(
      completed.state === "stopping" &&
        completed.owner_state === "none" &&
        completed.stop_reason === "completed",
      "Remote-owned guarded completion did not resume and release ownership",
    );
    assert(
      completed.preview_requirement_satisfied_at !== null &&
        completed.preview_requirement_lease_id === "pv_preview_policy",
      "Exact preview evidence provenance was not retained",
    );
    assert(audit.count === 1, "Preview requirement audit is missing");
    assert(foreignKeys.length === 0, "Preview policy test left foreign-key errors");

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        populatedV24UpgradePreserved: true,
        exactLabelAdmission: true,
        unlabelledUnaffected: true,
        completionDeferred: true,
        ownerVisibleStage: true,
        stalePreviewRejected: true,
        exactShaReviewed: true,
        remoteOwnedCompletionResumed: true,
        guardedCompletionResumed: true,
        appendOnlyAudit: true,
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
