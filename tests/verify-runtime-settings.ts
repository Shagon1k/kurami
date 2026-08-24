import { execFileSync, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse, stringify } from "yaml";
import {
  currentRuntimeSettings,
  effectiveOrchestratorConfig,
  loadRuntimeSettingsInputs,
} from "../src/runtime-settings.ts";

const root = await mkdtemp(resolve(tmpdir(), "kurami-runtime-settings-test-"));
const app = resolve(import.meta.dirname, "..");
const settingsCli = resolve(app, "src/orchestrator-settings.ts");

function fail(message: string): never {
  throw new Error(message);
}

function run(
  args: string[],
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const output = execFileSync(process.execPath, [settingsCli, ...args], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return JSON.parse(output.split("\n").at(-1) ?? "{}") as Record<string, unknown>;
}

function rejected(args: string[], env: NodeJS.ProcessEnv, pattern: RegExp): void {
  const result = spawnSync(process.execPath, [settingsCli, ...args], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const detail = `${result.stdout}\n${result.stderr}`;
  if (result.status === 0 || !pattern.test(detail)) {
    fail(`Expected settings rejection ${pattern}, received: ${detail}`);
  }
}

try {
  await mkdir(resolve(root, "config"), { recursive: true, mode: 0o700 });
  await mkdir(resolve(root, "state"), { recursive: true, mode: 0o700 });
  await mkdir(resolve(root, "bin"), { recursive: true, mode: 0o700 });
  await copyFile(
    resolve(app, "deploy/config/orchestrator.yaml"),
    resolve(root, "config/orchestrator.yaml"),
  );
  await copyFile(
    resolve(app, "deploy/config/projects.yaml"),
    resolve(root, "config/projects.yaml"),
  );
  const fakeTmux = resolve(root, "bin/tmux");
  await writeFile(fakeTmux, "#!/bin/sh\necho 'no server running' >&2\nexit 1\n", {
    mode: 0o700,
  });
  await chmod(fakeTmux, 0o700);
  const oldMigrations = resolve(root, "migrations-v29");
  await mkdir(oldMigrations, { recursive: true, mode: 0o700 });
  for (const migration of await readdir(resolve(app, "migrations"))) {
    if (/^\d+_.*\.sql$/u.test(migration) && migration < "030_") {
      await copyFile(resolve(app, "migrations", migration), resolve(oldMigrations, migration));
    }
  }
  const env = {
    ...process.env,
    ORCHESTRATOR_HOME: root,
    ORCHESTRATOR_MIGRATIONS_DIR: resolve(app, "migrations"),
    KURAMI_TMUX_BIN: fakeTmux,
  };
  execFileSync(process.execPath, [resolve(app, "src/init-run-store.ts")], {
    env: { ...env, ORCHESTRATOR_MIGRATIONS_DIR: oldMigrations },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let upgrade = new DatabaseSync(resolve(root, "state/orchestrator.db"));
  upgrade
    .prepare(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_type, payload_json,
        processing_state
      ) VALUES ('settings-upgrade-sentinel','2026-08-21T15:00:00.000Z',
        'tailortales','settings-upgrade-sentinel','Issue','{}','ignored')
    `)
    .run();
  upgrade.close();
  execFileSync(process.execPath, [resolve(app, "src/init-run-store.ts")], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  upgrade = new DatabaseSync(resolve(root, "state/orchestrator.db"), { readOnly: true });
  const upgradeEvidence = upgrade
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM schema_migrations) AS schema_version,
        (SELECT COUNT(*) FROM project_events
         WHERE event_id='settings-upgrade-sentinel') AS sentinel
    `)
    .get() as { schema_version: number; sentinel: number };
  upgrade.close();
  if (upgradeEvidence.schema_version !== 30 || upgradeEvidence.sentinel !== 1) {
    fail(`Populated v29 upgrade failed: ${JSON.stringify(upgradeEvidence)}`);
  }

  const initial = run(["status"], env);
  if (
    initial.revision !== 0 ||
    initial.source !== "defaults" ||
    (initial.idle as { idle?: boolean }).idle !== true
  ) {
    fail(`Unexpected initial settings: ${JSON.stringify(initial)}`);
  }

  const sharedPool = run(
    [
      "apply",
      "--expected-revision",
      "0",
      "--actor-id",
      "234723725168082944",
      "--via",
      "discord",
      "--max-llm",
      "3",
      "--ai-triage-daily",
      "40",
      "--global-wip",
      "3",
      "--project-wip",
      "tailortales=3",
      "--project-wip",
      "pickflick=3",
      "--max-previews",
      "4",
      "--max-preview-builds",
      "2",
      "--preview-ttl-hours",
      "36",
    ],
    env,
  );
  const applied = sharedPool.settings as {
    max_llm_running_global?: number;
    ai_triage_daily?: number;
    max_active_global?: number;
    project_wip?: Record<string, number>;
  };
  if (
    sharedPool.action !== "applied" ||
    sharedPool.revision !== 1 ||
    applied.max_llm_running_global !== 3 ||
    applied.ai_triage_daily !== 40 ||
    applied.max_active_global !== 3 ||
    applied.project_wip?.tailortales !== 3 ||
    applied.project_wip?.pickflick !== 3
  ) {
    fail(`Shared WIP pool was not applied: ${JSON.stringify(sharedPool)}`);
  }

  const databasePath = resolve(root, "state/orchestrator.db");
  let database = new DatabaseSync(databasePath, { timeout: 5_000 });
  const { base, projects } = await loadRuntimeSettingsInputs(root);
  const effective = effectiveOrchestratorConfig(
    database,
    base,
    Object.keys(projects.projects),
  );
  if (
    effective.limits.max_llm_running_global !== 3 ||
    effective.limits.ai_triage_daily !== 40 ||
    effective.limits.max_active_by_project.tailortales !== 3 ||
    effective.limits.max_preview_builds_global !== 2 ||
    effective.limits.preview_ttl_hours !== 36
  ) {
    fail("Effective runtime config did not merge the latest revision");
  }

  rejected(
    [
      "apply",
      "--expected-revision",
      "1",
      "--actor-id",
      "234723725168082944",
      "--via",
      "discord",
      "--global-wip",
      "2",
    ],
    env,
    /Project WIP for (tailortales|pickflick) cannot exceed Global WIP/u,
  );
  rejected(
    [
      "apply",
      "--expected-revision",
      "1",
      "--actor-id",
      "234723725168082944",
      "--via",
      "discord",
      "--ai-triage-daily",
      "41",
    ],
    env,
    /ai_triage_daily must be an integer between 0 and 40/u,
  );
  if (currentRuntimeSettings(database, base, Object.keys(projects.projects)).revision !== 1) {
    fail("Invalid settings created a revision");
  }

  database
    .prepare(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_type, payload_json,
        processing_state
      ) VALUES ('event-settings-lock','2026-08-21T16:00:00.000Z','tailortales',
        'item-settings-lock','Issue','{}','pending')
    `)
    .run();
  database.close();
  rejected(
    [
      "apply",
      "--expected-revision",
      "1",
      "--actor-id",
      "234723725168082944",
      "--via",
      "discord",
      "--preview-ttl-hours",
      "24",
    ],
    env,
    /locked until the orchestrator is idle.*pending project events: 1/u,
  );
  database = new DatabaseSync(databasePath, { timeout: 5_000 });
  database.prepare("UPDATE project_events SET processing_state='ignored' WHERE event_id='event-settings-lock'").run();
  database.close();

  rejected(
    [
      "apply",
      "--expected-revision",
      "0",
      "--actor-id",
      "234723725168082944",
      "--via",
      "discord",
      "--preview-ttl-hours",
      "24",
    ],
    env,
    /Settings changed since this panel opened/u,
  );

  const rollback = run(
    [
      "rollback",
      "--expected-revision",
      "1",
      "--actor-id",
      "234723725168082944",
      "--via",
      "discord",
    ],
    env,
  );
  if (
    rollback.action !== "rolled_back" ||
    rollback.revision !== 2 ||
    (rollback.settings as { max_llm_running_global?: number }).max_llm_running_global !== 1 ||
    (rollback.settings as { ai_triage_daily?: number }).ai_triage_daily !== 12
  ) {
    fail(`Rollback did not restore defaults: ${JSON.stringify(rollback)}`);
  }
  const resetNoop = run(
    [
      "reset",
      "--expected-revision",
      "2",
      "--actor-id",
      "234723725168082944",
      "--via",
      "discord",
    ],
    env,
  );
  if (resetNoop.action !== "unchanged" || resetNoop.revision !== 2) {
    fail("Reset to existing defaults created a redundant revision");
  }

  database = new DatabaseSync(databasePath, { timeout: 5_000 });
  const previousRow = database
    .prepare("SELECT previous_settings_json FROM orchestrator_setting_revisions WHERE revision=2")
    .get() as { previous_settings_json: string };
  database
    .prepare("UPDATE orchestrator_setting_revisions SET previous_settings_json=? WHERE revision=2")
    .run(
      previousRow.previous_settings_json.replace(
        '"max_llm_running_global":3',
        '"max_llm_running_global":2',
      ),
    );
  database.close();
  rejected(
    [
      "rollback",
      "--expected-revision",
      "2",
      "--actor-id",
      "234723725168082944",
      "--via",
      "discord",
    ],
    env,
    /Previous runtime settings checksum does not match/u,
  );

  const admissionSettings = run(
    [
      "apply",
      "--expected-revision",
      "2",
      "--actor-id",
      "234723725168082944",
      "--via",
      "discord",
      "--global-wip",
      "3",
      "--project-wip",
      "tailortales=3",
      "--project-wip",
      "pickflick=3",
    ],
    env,
  );
  if (admissionSettings.revision !== 3) fail("Admission settings revision was not created");
  database = new DatabaseSync(databasePath, { timeout: 5_000 });
  const insertEvent = database.prepare(`
    INSERT INTO project_events (
      event_id, observed_at, project, item_id, content_id, content_type,
      repository, issue_number, title, url, from_status, to_status, payload_json
    ) VALUES (?, ?, ?, ?, ?, 'Issue', ?, ?, ?, ?, 'Backlog', 'In progress', ?)
  `);
  const admissionProjects = ["tailortales", "pickflick", "tailortales", "pickflick"];
  for (const [index, project] of admissionProjects.entries()) {
    const number = 9701 + index;
    const repository = project === "tailortales" ? "Shagon1k/TailorTales" : "Shagon1k/PickFlick";
    insertEvent.run(
      `settings-admission-${index}`,
      `2026-08-21T17:00:0${index}.000Z`,
      project,
      `settings-item-${index}`,
      `settings-content-${index}`,
      repository,
      number,
      `[Test]: Shared pool ${number}`,
      `https://example.invalid/issues/${number}`,
      JSON.stringify({ issueState: "OPEN", labels: [], hasDescription: true }),
    );
  }
  database.close();
  const admissionOutput = execFileSync(
    process.execPath,
    [resolve(app, "src/process-project-events.ts")],
    { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  const admission = JSON.parse(admissionOutput) as {
    activeGlobal: number;
    results: Array<{ action: string }>;
  };
  if (
    admission.activeGlobal !== 3 ||
    admission.results.map(({ action }) => action).join(",") !==
      "created,created,created,rejected"
  ) {
    fail(`Actual shared WIP pool was not enforced: ${admissionOutput}`);
  }

  const projectsPath = resolve(root, "config/projects.yaml");
  const expandedRegistry = parse(await readFile(projectsPath, "utf8")) as {
    projects: Record<string, unknown>;
  };
  expandedRegistry.projects["ahurynovich-cv"] = {};
  await writeFile(projectsPath, stringify(expandedRegistry), { mode: 0o600 });

  const expandedStatus = run(["status"], env);
  const expandedStatusWip = (expandedStatus.settings as {
    project_wip?: Record<string, number>;
  }).project_wip;
  if (
    expandedStatus.revision !== 3 ||
    expandedStatusWip?.["ahurynovich-cv"] !== 2 ||
    expandedStatusWip?.tailortales !== 3 ||
    expandedStatusWip?.pickflick !== 3
  ) {
    fail(`Historical settings did not expand safely: ${JSON.stringify(expandedStatus)}`);
  }

  rejected(
    [
      "apply",
      "--expected-revision",
      "3",
      "--actor-id",
      "234723725168082944",
      "--via",
      "discord",
      "--project-wip",
      "ahurynovich-cv=1",
    ],
    env,
    /locked until the orchestrator is idle.*non-terminal runs: 3/u,
  );
  database = new DatabaseSync(databasePath, { timeout: 5_000 });
  database.exec("BEGIN IMMEDIATE");
  database
    .prepare("UPDATE run_resources SET resource_state='released' WHERE resource_state='planned'")
    .run();
  database
    .prepare(`
      UPDATE runs
      SET state='archived', owner_state='none', archived_at='2026-08-21T17:01:00.000Z'
      WHERE state NOT IN ('rejected','cancelled','archived')
    `)
    .run();
  database.exec("COMMIT");
  database.close();

  const expandedApply = run(
    [
      "apply",
      "--expected-revision",
      "3",
      "--actor-id",
      "234723725168082944",
      "--via",
      "discord",
      "--project-wip",
      "ahurynovich-cv=1",
    ],
    env,
  );
  if (
    expandedApply.action !== "applied" ||
    expandedApply.revision !== 4 ||
    (expandedApply.settings as { project_wip?: Record<string, number> }).project_wip?.[
      "ahurynovich-cv"
    ] !== 1
  ) {
    fail(`Expanded project WIP was not persisted: ${JSON.stringify(expandedApply)}`);
  }

  database = new DatabaseSync(databasePath, { timeout: 5_000 });
  const row = database
    .prepare("SELECT settings_json FROM orchestrator_setting_revisions WHERE revision=4")
    .get() as { settings_json: string };
  database
    .prepare("UPDATE orchestrator_setting_revisions SET settings_json=? WHERE revision=4")
    .run(row.settings_json.replace('"max_llm_running_global":1', '"max_llm_running_global":2'));
  let checksumRejected = false;
  try {
    currentRuntimeSettings(database, base, Object.keys(projects.projects));
  } catch (error) {
    checksumRejected = /checksum does not match/u.test(
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!checksumRejected) fail("Tampered settings revision did not fail closed");

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      schema: 30,
      populatedV29UpgradePreserved: true,
      sharedPool: true,
      llmRange: "1-3",
      projectWipRange: "1-3",
      idleGate: true,
      staleRevision: true,
      rollback: true,
      previousChecksum: true,
      newProjectExpansion: true,
      checksum: true,
      noExternalWrites: true,
    })}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
