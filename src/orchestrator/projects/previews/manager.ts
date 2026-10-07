import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, readdir, rmdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveKuramiHome } from "../../../core/kurami-home.ts";
import {
  loadEffectiveOrchestratorConfig,
  type RuntimeSettingsBaseConfig,
} from "../../settings/runtime-settings.ts";
import { openOrchestratorDatabase } from "../../state/database.ts";

process.umask(0o077);

type Command =
  | "allocate"
  | "inspect"
  | "release"
  | "extend"
  | "review"
  | "reconcile-orphan-runtime";

type Arguments = {
  command: Command;
  runId?: string;
  apply: boolean;
  runtimeAbsent: boolean;
  releaseReason: "runtime_absence_confirmed" | "preview_owner_stopped" | "preview_ttl_expired";
  reviewedBy?: string;
};

type OrchestratorConfig = RuntimeSettingsBaseConfig & {
  limits: RuntimeSettingsBaseConfig["limits"] & {
    max_previews_global: number;
    max_preview_builds_global: number;
    preview_expiry_warning_hours: number;
    preview_extension_hours: number;
  };
};

type RunRecord = {
  run_id: string;
  project: string;
  issue_number: number;
  state: string;
  execution_mode: string;
  preview_id: string | null;
  preview_required: number;
  ci_head_sha: string | null;
};

type SlotRecord = {
  slot_number: number;
  hostname: string;
  assets_hostname: string;
  frontend_port: number;
  backend_port: number;
  postgres_port: number;
  redis_port: number;
  minio_api_port: number;
  minio_console_port: number;
};

type LeaseRecord = SlotRecord & {
  lease_id: string;
  run_id: string;
  state: string;
  compose_project_name: string;
  leased_at: string;
  updated_at: string;
  released_at: string | null;
  release_reason: string | null;
  expires_at: string | null;
  extension_count: number;
  reviewed_at: string | null;
  reviewed_by: string | null;
  reviewed_via: string | null;
  verified_head_sha: string | null;
  runtime_adapter: "compose" | "static";
  artifact_root: string | null;
  artifact_digest: string | null;
  artifact_file_count: number | null;
  artifact_total_bytes: number | null;
};

const orchestratorHome = resolveKuramiHome(resolve(import.meta.dirname, "../../../../.."));
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(): Arguments {
  const args = process.argv.slice(2);
  const command = args.shift() as Command | undefined;
  if (
    !command ||
    !["allocate", "inspect", "release", "extend", "review", "reconcile-orphan-runtime"].includes(command)
  ) {
    fail(
      "Usage: preview-manager.ts <allocate|inspect|release|extend|review|reconcile-orphan-runtime> [--run-id <id>] [--reviewed-by <discord:id|cli:owner>] [--apply] [--runtime-absent]",
    );
  }

  let runId: string | undefined;
  let apply = false;
  let runtimeAbsent = false;
  let releaseReason: Arguments["releaseReason"] = "runtime_absence_confirmed";
  let reviewedBy: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--run-id") {
      runId = args[index + 1];
      if (!runId) fail("--run-id requires a value");
      index += 1;
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--runtime-absent") {
      runtimeAbsent = true;
    } else if (arg === "--release-reason") {
      const value = args[index + 1] as Arguments["releaseReason"] | undefined;
      if (
        !value ||
        ![
          "runtime_absence_confirmed",
          "preview_owner_stopped",
          "preview_ttl_expired",
        ].includes(value)
      )
        fail("--release-reason requires an allowlisted value");
      releaseReason = value;
      index += 1;
    } else if (arg === "--reviewed-by") {
      reviewedBy = args[index + 1]?.trim();
      if (
        !reviewedBy ||
        !/^(?:discord:\d{1,30}|cli:owner)$/u.test(reviewedBy)
      )
        fail("--reviewed-by requires discord:<numeric-id> or cli:owner");
      index += 1;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  if (
    ["allocate", "release", "extend", "review", "reconcile-orphan-runtime"].includes(command) &&
    !runId
  ) {
    fail(`${command} requires --run-id`);
  }
  if (command === "inspect" && (apply || runtimeAbsent)) {
    fail("inspect does not accept mutation flags");
  }
  if (command !== "release" && runtimeAbsent) {
    fail("--runtime-absent is valid only for release");
  }
  if (command !== "release" && releaseReason !== "runtime_absence_confirmed") {
    fail("--release-reason is valid only for release");
  }
  if (command === "review" && !reviewedBy)
    fail("review requires --reviewed-by");
  if (command !== "review" && reviewedBy)
    fail("--reviewed-by is valid only for review");
  return { command, runId, apply, runtimeAbsent, releaseReason, reviewedBy };
}

function activeLeaseForRun(
  database: DatabaseSync,
  runId: string,
): LeaseRecord | undefined {
  return database
    .prepare(`
      SELECT pl.*, ps.hostname, ps.assets_hostname,
             ps.frontend_port, ps.backend_port, ps.postgres_port, ps.redis_port,
             ps.minio_api_port, ps.minio_console_port
      FROM preview_leases pl
      JOIN preview_slots ps USING (slot_number)
      WHERE pl.run_id = ? AND pl.state <> 'released'
      ORDER BY pl.leased_at DESC
      LIMIT 1
    `)
    .get(runId) as LeaseRecord | undefined;
}

function runRecord(database: DatabaseSync, runId: string): RunRecord {
  const run = database
    .prepare(`
      SELECT r.run_id, r.project, r.issue_number, r.state, r.execution_mode,
             r.preview_required, ci.head_sha AS ci_head_sha, rr.preview_id
      FROM runs r
      JOIN run_resources rr USING (run_id)
      LEFT JOIN run_ci_snapshots ci USING (run_id)
      WHERE r.run_id = ?
    `)
    .get(runId) as RunRecord | undefined;
  if (!run) fail(`Run not found: ${runId}`);
  return run;
}

function firstFreeSlot(database: DatabaseSync): SlotRecord | undefined {
  return database
    .prepare(`
      SELECT ps.slot_number, ps.hostname, ps.assets_hostname,
             ps.frontend_port, ps.backend_port, ps.postgres_port, ps.redis_port,
             ps.minio_api_port, ps.minio_console_port
      FROM preview_slots ps
      WHERE ps.enabled = 1
        AND NOT EXISTS (
          SELECT 1 FROM preview_leases pl
          WHERE pl.slot_number = ps.slot_number AND pl.state <> 'released'
        )
      ORDER BY ps.slot_number
      LIMIT 1
    `)
    .get() as SlotRecord | undefined;
}

function activeLeaseCount(database: DatabaseSync): number {
  return Number(
    (
      database
        .prepare("SELECT COUNT(*) AS count FROM preview_leases WHERE state <> 'released'")
        .get() as { count: number }
    ).count,
  );
}

function composeProjectName(slotNumber: number, runId: string): string {
  const suffix = runId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-10);
  if (!suffix) fail(`Run ID cannot produce a Compose project name: ${runId}`);
  return `kurami-pv${slotNumber}-${suffix}`;
}

function leaseView(lease: LeaseRecord): Record<string, unknown> {
  return {
    leaseId: lease.lease_id,
    runId: lease.run_id,
    state: lease.state,
    slotNumber: lease.slot_number,
    hostname: lease.hostname,
    assetsHostname: lease.assets_hostname,
    composeProjectName: lease.compose_project_name,
    runtimeAdapter: lease.runtime_adapter,
    artifactRoot: lease.artifact_root,
    artifactDigest: lease.artifact_digest,
    artifactFileCount: lease.artifact_file_count,
    artifactTotalBytes: lease.artifact_total_bytes,
    expiresAt: lease.expires_at,
    extensionCount: lease.extension_count,
    reviewedAt: lease.reviewed_at,
    reviewedBy: lease.reviewed_by,
    reviewedVia: lease.reviewed_via,
    verifiedHeadSha: lease.verified_head_sha,
    ports: {
      frontend: lease.frontend_port,
      backend: lease.backend_port,
      postgres: lease.postgres_port,
      redis: lease.redis_port,
      minioApi: lease.minio_api_port,
      minioConsole: lease.minio_console_port,
    },
  };
}

export function acknowledgePreview(
  database: DatabaseSync,
  runId: string,
  reviewedBy: string,
  apply: boolean,
  options: { now?: number } = {},
): Record<string,unknown> {
  const ownsTransaction = !database.isTransaction;
  if (ownsTransaction) database.exec("BEGIN IMMEDIATE");
  try {
    const run = runRecord(database, runId);
    const lease = activeLeaseForRun(database, runId);
    if (!lease) fail(`Active preview lease not found for run: ${runId}`);
    if (lease.state !== "running" || !lease.expires_at) {
      fail(`Preview is not reviewable: state=${lease.state}`);
    }
    if (Date.parse(lease.expires_at) <= (options.now ?? Date.now())) {
      fail("Preview has expired and cannot be marked as reviewed");
    }
    if (lease.reviewed_at) {
      if (ownsTransaction) database.exec("COMMIT");
      return { ok: true, apply, action: "already_reviewed", ...leaseView(lease) };
    }
    if (!/^(?:discord:\d{1,30}|cli:owner|projects:[A-Za-z0-9_-]{1,200})$/.test(reviewedBy)) fail("Invalid preview review actor");
    const reviewedVia = reviewedBy.startsWith("discord:") ? "discord" : reviewedBy.startsWith("projects:") ? "projects" : "cli";
    const plan = {
      ...leaseView(lease),
      reviewedBy,
      reviewedVia,
    };
    if (!apply) {
      if (ownsTransaction) database.exec("ROLLBACK");
      return { ok: true, apply: false, action: "review", plan };
    }
    const changed = database
      .prepare(`
        UPDATE preview_leases
        SET reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            reviewed_by = ?, reviewed_via = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE lease_id = ? AND state = 'running' AND reviewed_at IS NULL
          AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      `)
      .run(reviewedBy, reviewedVia, lease.lease_id);
    if (changed.changes !== 1)
      fail("Preview changed before acknowledgement was applied");
    const updated = activeLeaseForRun(database, runId);
    if (!updated?.reviewed_at) fail("Preview acknowledgement was not persisted");
    const satisfiesRequiredPreview =
      run.preview_required === 1 &&
      run.ci_head_sha !== null &&
      updated.verified_head_sha === run.ci_head_sha;
    if (satisfiesRequiredPreview) {
      database
        .prepare(`
          UPDATE runs
          SET preview_requirement_satisfied_at = ?,
              preview_requirement_lease_id = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE run_id = ? AND preview_required = 1
        `)
        .run(updated.reviewed_at, updated.lease_id, runId);
    }
    database
      .prepare(`
        INSERT INTO run_state_history (
          run_id, from_state, to_state, reason, details_json
        ) VALUES (?, ?, ?, 'preview_reviewed', ?)
      `)
      .run(
        runId,
        run.state,
        run.state,
        JSON.stringify({
          leaseId: lease.lease_id,
          reviewedAt: updated.reviewed_at,
          reviewedBy,
          reviewedVia,
          verifiedHeadSha: updated.verified_head_sha,
        }),
      );
    if (ownsTransaction) database.exec("COMMIT");
    return { ok: true, apply: true, action: "reviewed", ...leaseView(updated) };
  } catch (error) {
    if (ownsTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

function extend(
  database: DatabaseSync,
  config: OrchestratorConfig,
  runId: string,
  apply: boolean,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const run = runRecord(database, runId);
    const lease = activeLeaseForRun(database, runId);
    if (!lease) fail(`Active preview lease not found for run: ${runId}`);
    if (lease.state !== "running" || !lease.expires_at) {
      fail(`Preview is not extendable: state=${lease.state}`);
    }
    if (Date.parse(lease.expires_at) <= Date.now()) {
      fail("Preview has already expired and is awaiting guarded cleanup");
    }
    if (
      Date.parse(lease.expires_at) - Date.now() >
      config.limits.preview_expiry_warning_hours * 60 * 60 * 1_000
    ) {
      fail("Preview extension is available only inside the expiry warning window");
    }
    const plan = {
      ...leaseView(lease),
      extensionHours: config.limits.preview_extension_hours,
      nextExpiresAt: new Date(
        Date.parse(lease.expires_at) +
          config.limits.preview_extension_hours * 60 * 60 * 1_000,
      ).toISOString(),
    };
    if (!apply) {
      database.exec("ROLLBACK");
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: false, action: "extend", plan })}\n`,
      );
      return;
    }
    const changed = database
      .prepare(`
        UPDATE preview_leases
        SET expires_at = strftime(
              '%Y-%m-%dT%H:%M:%fZ', expires_at,
              '+' || ? || ' hours'
            ),
            extension_count = extension_count + 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE lease_id = ? AND state = 'running'
          AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      `)
      .run(config.limits.preview_extension_hours, lease.lease_id);
    if (changed.changes !== 1) fail("Preview changed before extension was applied");
    const updated = activeLeaseForRun(database, runId);
    if (!updated) fail("Extended preview lease disappeared");
    database
      .prepare(`
        INSERT INTO run_state_history (
          run_id, from_state, to_state, reason, details_json
        ) VALUES (?, ?, ?, 'preview_ttl_extended', ?)
      `)
      .run(
        runId,
        run.state,
        run.state,
        JSON.stringify({
          leaseId: lease.lease_id,
          previousExpiresAt: lease.expires_at,
          expiresAt: updated.expires_at,
          extensionHours: config.limits.preview_extension_hours,
          extensionCount: updated.extension_count,
        }),
      );
    database.exec("COMMIT");
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: true, action: "extended", ...leaseView(updated) })}\n`,
    );
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function inspect(database: DatabaseSync): void {
  const leases = database
    .prepare(`
      SELECT pl.*, ps.hostname, ps.assets_hostname,
             ps.frontend_port, ps.backend_port, ps.postgres_port, ps.redis_port,
             ps.minio_api_port, ps.minio_console_port
      FROM preview_leases pl
      JOIN preview_slots ps USING (slot_number)
      WHERE pl.state <> 'released'
      ORDER BY ps.slot_number
    `)
    .all() as LeaseRecord[];
  const slots = database
    .prepare(`
      SELECT ps.slot_number, ps.hostname, ps.assets_hostname, ps.enabled,
             CASE WHEN pl.lease_id IS NULL THEN 'free' ELSE pl.state END AS state,
             pl.run_id
      FROM preview_slots ps
      LEFT JOIN preview_leases pl
        ON pl.slot_number = ps.slot_number AND pl.state <> 'released'
      ORDER BY ps.slot_number
    `)
    .all();
  process.stdout.write(
    `${JSON.stringify({ ok: true, active: leases.length, slots, leases: leases.map(leaseView) })}\n`,
  );
}

function allocate(
  database: DatabaseSync,
  config: OrchestratorConfig,
  runId: string,
  apply: boolean,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const run = runRecord(database, runId);
    if (run.execution_mode !== "live") fail(`Run is not live: ${runId}`);
    if (!["running", "remote_owned", "parked_review"].includes(run.state)) {
      fail(`Run state is not preview-eligible: ${run.state}`);
    }

    const existing = activeLeaseForRun(database, runId);
    if (existing) {
      database.exec("COMMIT");
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply, action: "existing", ...leaseView(existing) })}\n`,
      );
      return;
    }
    if (run.preview_id !== null) {
      fail(`Run has preview_id without an active lease: ${run.preview_id}`);
    }

    const active = activeLeaseCount(database);
    if (active >= config.limits.max_previews_global) {
      fail(`Preview cap reached: ${active}/${config.limits.max_previews_global}`);
    }
    const slot = firstFreeSlot(database);
    if (!slot) fail("No enabled preview slot is free");

    const planned = {
      runId,
      slotNumber: slot.slot_number,
      hostname: slot.hostname,
      assetsHostname: slot.assets_hostname,
      composeProjectName: composeProjectName(slot.slot_number, runId),
      ports: {
        frontend: slot.frontend_port,
        backend: slot.backend_port,
        postgres: slot.postgres_port,
        redis: slot.redis_port,
        minioApi: slot.minio_api_port,
        minioConsole: slot.minio_console_port,
      },
    };
    if (!apply) {
      database.exec("ROLLBACK");
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: false, action: "allocate", plan: planned })}\n`,
      );
      return;
    }

    const leaseId = `pv_${randomUUID().replaceAll("-", "")}`;
    database
      .prepare(`
        INSERT INTO preview_leases (
          lease_id, run_id, slot_number, state, compose_project_name
        ) VALUES (?, ?, ?, 'leased', ?)
      `)
      .run(leaseId, runId, slot.slot_number, planned.composeProjectName);
    database
      .prepare(`
        UPDATE run_resources
        SET preview_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `)
      .run(`preview-${slot.slot_number}`, runId);
    database
      .prepare(`
        INSERT INTO run_state_history (
          run_id, from_state, to_state, reason, details_json
        ) VALUES (?, ?, ?, 'preview_slot_leased', ?)
      `)
      .run(runId, run.state, run.state, JSON.stringify(planned));
    database.exec("COMMIT");
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: true, action: "allocated", leaseId, ...planned })}\n`,
    );
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function release(
  database: DatabaseSync,
  runId: string,
  apply: boolean,
  runtimeAbsent: boolean,
  releaseReason: Arguments["releaseReason"],
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const run = runRecord(database, runId);
    const lease = activeLeaseForRun(database, runId);
    if (!lease) {
      if (run.preview_id !== null) {
        fail(`Run has preview_id without an active lease: ${run.preview_id}`);
      }
      database.exec("COMMIT");
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply, action: "not_leased", runId })}\n`,
      );
      return;
    }

    const plan = { ...leaseView(lease), requiresRuntimeAbsent: true };
    if (!apply) {
      database.exec("ROLLBACK");
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: false, action: "release", plan })}\n`,
      );
      return;
    }
    if (!runtimeAbsent) {
      fail("Refusing lease release without --runtime-absent");
    }

    database
      .prepare(`
        UPDATE preview_leases
        SET state = 'released',
            released_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            release_reason = ?
        WHERE lease_id = ? AND state <> 'released'
      `)
      .run(releaseReason, lease.lease_id);
    database
      .prepare(`
        UPDATE run_resources
        SET preview_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ? AND preview_id = ?
      `)
      .run(runId, `preview-${lease.slot_number}`);
    database
      .prepare(`
        INSERT INTO run_state_history (
          run_id, from_state, to_state, reason, details_json
        ) VALUES (?, ?, ?, 'preview_slot_released', ?)
      `)
      .run(
        runId,
        run.state,
        run.state,
        JSON.stringify({ ...leaseView(lease), releaseReason }),
      );
    database.exec("COMMIT");
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: true, action: "released", ...leaseView(lease), releaseReason })}\n`,
    );
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function reconcileOrphanRuntime(
  database: DatabaseSync,
  runId: string,
  apply: boolean,
): Promise<void> {
  if (!/^r_[A-Za-z0-9_]+$/u.test(runId)) fail("Invalid run ID");
  const run = runRecord(database, runId);
  if (run.preview_id !== null) fail(`Run still owns preview_id: ${run.preview_id}`);
  const activeCount = Number(
    (database
      .prepare("SELECT COUNT(*) AS count FROM preview_leases WHERE run_id=? AND state <> 'released'")
      .get(runId) as { count: number }).count,
  );
  if (activeCount !== 0) fail(`Run still has ${activeCount} active preview lease(s)`);
  const lease = database
    .prepare(`SELECT compose_project_name, runtime_adapter FROM preview_leases
              WHERE run_id=? ORDER BY updated_at DESC LIMIT 1`)
    .get(runId) as { compose_project_name: string; runtime_adapter: string } | undefined;
  if (!lease || lease.runtime_adapter !== "compose") {
    fail("No released Compose preview lease found for run");
  }

  const runtimeDirectory = resolve(orchestratorHome, "state/previews", runId);
  const runtimeRoot = resolve(orchestratorHome, "state/previews");
  if (!runtimeDirectory.startsWith(`${runtimeRoot}/`)) fail("Unsafe runtime directory path");
  const allowedRuntimeArtifactSets = [
    ["runtime.env", "compose.preview.yaml"],
    ["runtime.env", "compose.preview.yaml", "source.compose.yaml"],
  ];
  const entries = await readdir(runtimeDirectory, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  const expectedFiles = allowedRuntimeArtifactSets.find(
    (allowed) => names.join("\0") === [...allowed].sort().join("\0"),
  );
  if (!expectedFiles) {
    fail(`Runtime directory has unexpected entries: ${names.join(",")}`);
  }
  for (const name of expectedFiles) {
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry || !entry.isFile() || entry.isSymbolicLink()) {
      fail(`Runtime artifact is not a regular file: ${name}`);
    }
    const metadata = await lstat(resolve(runtimeDirectory, name));
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail(`Runtime artifact changed during inspection: ${name}`);
    }
  }

  const dockerArgs = [
    ["ps", "-aq", "--filter", `label=com.docker.compose.project=${lease.compose_project_name}`],
    ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${lease.compose_project_name}`],
    ["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${lease.compose_project_name}`],
  ];
  const resources = dockerArgs.map((args) => {
    const result = spawnSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (result.status !== 0) fail(result.stderr.trim() || `Cannot inspect Docker ${args[0]} resources`);
    return result.stdout.split("\n").filter(Boolean);
  });
  if (resources.some((resource) => resource.length > 0)) {
    fail("Refusing orphan runtime cleanup while Compose resources still exist");
  }

  const plan = {
    runId,
    composeProjectName: lease.compose_project_name,
    runtimeDirectory,
    files: expectedFiles,
    dockerResources: { containers: 0, volumes: 0, networks: 0 },
  };
  if (!apply) {
    process.stdout.write(`${JSON.stringify({ ok: true, apply: false, action: "reconcile_orphan_runtime", plan })}\n`);
    return;
  }

  for (const name of expectedFiles) await unlink(resolve(runtimeDirectory, name));
  await rmdir(runtimeDirectory);
  database
    .prepare(`INSERT INTO run_state_history (run_id, from_state, to_state, reason, details_json)
              VALUES (?, ?, ?, 'orphan_runtime_reconciled', ?)`)
    .run(runId, run.state, run.state, JSON.stringify(plan));
  process.stdout.write(`${JSON.stringify({ ok: true, apply: true, action: "orphan_runtime_reconciled", plan })}\n`);
}

export async function runPreviewManagerCli(): Promise<void> {
  const args = parseArguments();
  const config = await loadEffectiveOrchestratorConfig<OrchestratorConfig>(
    orchestratorHome,
  );
  if (config.version !== 1) fail("Unsupported orchestrator config version");
  if (
    !Number.isInteger(config.limits.max_previews_global) ||
    config.limits.max_previews_global < 1 ||
    config.limits.max_previews_global > 6
  ) {
    fail("Invalid max_previews_global");
  }
  if (
    !Number.isInteger(config.limits.max_preview_builds_global) ||
    config.limits.max_preview_builds_global < 1 ||
    config.limits.max_preview_builds_global > config.limits.max_previews_global
  ) {
    fail("Invalid max_preview_builds_global");
  }
  if (
    !Number.isInteger(config.limits.preview_expiry_warning_hours) ||
    config.limits.preview_expiry_warning_hours < 1 ||
    config.limits.preview_expiry_warning_hours > 168
  ) {
    fail("Invalid preview_expiry_warning_hours");
  }
  if (
    !Number.isInteger(config.limits.preview_extension_hours) ||
    config.limits.preview_extension_hours < 1 ||
    config.limits.preview_extension_hours > 168
  ) {
    fail("Invalid preview_extension_hours");
  }
  if (
    config.limits.preview_expiry_warning_hours >=
    config.limits.preview_extension_hours
  ) {
    fail("preview_expiry_warning_hours must be less than preview_extension_hours");
  }
  if (args.apply && config.mode !== "live") {
    fail(`Refusing preview mutation in mode=${config.mode}`);
  }

  const database = openOrchestratorDatabase(databasePath);
  try {
    if (args.command === "inspect") inspect(database);
    else if (args.command === "allocate") {
      allocate(database, config, args.runId!, args.apply);
    } else if (args.command === "release") {
      release(
        database,
        args.runId!,
        args.apply,
        args.runtimeAbsent,
        args.releaseReason,
      );
    } else if (args.command === "extend") {
      extend(database, config, args.runId!, args.apply);
    } else if (args.command === "reconcile-orphan-runtime") {
      await reconcileOrphanRuntime(database, args.runId!, args.apply);
    } else {
      const result = acknowledgePreview(database, args.runId!, args.reviewedBy!, args.apply);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  runPreviewManagerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
