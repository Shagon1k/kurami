import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function initializeThrough(
  appDirectory: string,
  home: string,
  maximum: number,
): Promise<void> {
  const migrations = resolve(home, `migrations-v${maximum}`);
  await mkdir(migrations, { recursive: true, mode: 0o700 });
  for (const name of await readdir(resolve(appDirectory, "migrations"))) {
    if (/^\d{3}_[a-z0-9_]+\.sql$/u.test(name) && Number(name.slice(0, 3)) <= maximum) {
      await copyFile(resolve(appDirectory, "migrations", name), resolve(migrations, name));
    }
  }
  execFileSync(process.execPath, [resolve(appDirectory, "src/init-run-store.ts")], {
    env: {
      ...process.env,
      ORCHESTRATOR_HOME: home,
      ORCHESTRATOR_MIGRATIONS_DIR: migrations,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

async function main(): Promise<void> {
  const appDirectory = resolve(import.meta.dirname, "..");
  const home = await mkdtemp(resolve(tmpdir(), "kurami-static-preview-test-"));
  process.env.ORCHESTRATOR_HOME = home;
  try {
    await mkdir(resolve(home, "config"), { recursive: true, mode: 0o700 });
    await copyFile(
      resolve(appDirectory, "deploy/config/orchestrator.yaml"),
      resolve(home, "config/orchestrator.yaml"),
    );
    await writeFile(
      resolve(home, "config/projects.yaml"),
      [
        "version: 1",
        "projects:",
        "  static_project:",
        "    preview:",
        "      adapter: static",
        "      artifact_directory: dist",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    await initializeThrough(appDirectory, home, 25);

    const databasePath = resolve(home, "state/orchestrator.db");
    const old = new DatabaseSync(databasePath);
    old.prepare(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, from_status, to_status,
        payload_json, processing_state
      ) VALUES (
        'event-static', '2026-08-20T18:00:00.000Z', 'static_project',
        'item-static', 'content-static', 'Issue', 'Example/Static', 1,
        'Static preview', 'https://example.invalid/1', 'Backlog', 'Human Review',
        '{"issueState":"OPEN","labels":[],"hasDescription":true}', 'processed'
      )
    `).run();
    old.prepare(`
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode
      ) VALUES (
        'r_static_test', 'event-static', 'static_project', 'item-static',
        'content-static', 'Example/Static', 1, 'autonomous', 'parked_review',
        'none', 'live'
      )
    `).run();
    old.prepare(`
      INSERT INTO run_resources (run_id, resource_state, worktree_path, branch_name)
      VALUES ('r_static_test', 'provisioned', '/tmp/static/Static', 'ST-1_static')
    `).run();
    old.prepare(`
      INSERT INTO preview_leases (
        lease_id, run_id, slot_number, state, compose_project_name
      ) VALUES ('lease-static', 'r_static_test', 1, 'leased', 'kurami-pv1-statictest')
    `).run();
    old.prepare(`UPDATE run_resources SET preview_id='preview-1' WHERE run_id='r_static_test'`).run();
    old.close();

    execFileSync(process.execPath, [resolve(appDirectory, "src/init-run-store.ts")], {
      env: { ...process.env, ORCHESTRATOR_HOME: home },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const migrated = new DatabaseSync(databasePath);
    const legacy = migrated.prepare(`
      SELECT runtime_adapter, artifact_root, artifact_digest
      FROM preview_leases WHERE lease_id='lease-static'
    `).get() as Record<string, unknown>;
    assert(
      legacy.runtime_adapter === "compose" &&
        legacy.artifact_root === null &&
        legacy.artifact_digest === null,
      "Populated v25 lease was not preserved as Compose",
    );

    const { selectAdapter } = await import("../src/preview-runtime.ts");
    assert(selectAdapter("r_static_test") === "static", "Leased adapter did not use project config");
    migrated.prepare(`
      UPDATE preview_leases SET state='provisioning', runtime_adapter='static'
      WHERE lease_id='lease-static'
    `).run();
    await writeFile(
      resolve(home, "config/projects.yaml"),
      "version: 1\nprojects:\n  static_project:\n    preview:\n      adapter: compose\n",
      { mode: 0o600 },
    );
    assert(
      selectAdapter("r_static_test") === "static",
      "Claimed lease did not retain its durable adapter",
    );

    let inconsistentRejected = false;
    try {
      migrated.prepare(`
        UPDATE preview_leases SET state='running' WHERE lease_id='lease-static'
      `).run();
    } catch {
      inconsistentRejected = true;
    }
    assert(inconsistentRejected, "Running static lease accepted incomplete provenance");
    migrated.close();

    const artifact = resolve(home, "artifact");
    await mkdir(resolve(artifact, "assets"), { recursive: true, mode: 0o700 });
    await writeFile(resolve(artifact, "index.html"), "<h1>Static</h1>\n");
    await writeFile(resolve(artifact, "assets/app.js"), "console.log('ok');\n");
    const { inventoryArtifact } = await import("../src/preview-static-runtime.ts");
    const canonicalArtifact = await realpath(artifact);
    const first = await inventoryArtifact(canonicalArtifact, 10, 10_000);
    const second = await inventoryArtifact(canonicalArtifact, 10, 10_000);
    assert(first.digest === second.digest && first.fileCount === 2, "Inventory is not deterministic");

    await symlink(resolve(artifact, "index.html"), resolve(artifact, "linked.html"));
    let symlinkRejected = false;
    try {
      await inventoryArtifact(canonicalArtifact, 10, 10_000);
    } catch {
      symlinkRejected = true;
    }
    assert(symlinkRejected, "Artifact symlink was accepted");
    await rm(resolve(artifact, "linked.html"));
    await writeFile(resolve(artifact, ".secret"), "hidden");
    let hiddenRejected = false;
    try {
      await inventoryArtifact(canonicalArtifact, 10, 10_000);
    } catch {
      hiddenRejected = true;
    }
    assert(hiddenRejected, "Hidden artifact path was accepted");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      populatedV25UpgradePreserved: true,
      configAdapterSelectedBeforeClaim: true,
      durableAdapterAfterClaim: true,
      incompleteProvenanceRejected: true,
      deterministicInventory: true,
      symlinkRejected: true,
      hiddenPathRejected: true,
      arbitraryBuildCommands: false,
      composeBackwardCompatible: true,
    })}\n`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
