import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { request, type RequestOptions } from "node:http";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveKuramiHome } from "../../../../core/kurami-home.ts";
import { parse } from "yaml";
import {
  loadEffectiveOrchestratorConfig,
  type RuntimeSettingsBaseConfig,
} from "../../../settings/runtime-settings.ts";
import {
  assertPreviewSourceRevision,
  requireExactHeadSha,
} from "../runtime.ts";

process.umask(0o077);

type Command = "up" | "down" | "inspect";
type ReleaseReason = "preview_owner_stopped" | "preview_ttl_expired";
type Arguments = {
  command: Command;
  runId: string;
  apply: boolean;
  releaseReason: ReleaseReason;
};

type OrchestratorConfig = RuntimeSettingsBaseConfig & {
  limits: RuntimeSettingsBaseConfig["limits"] & {
    max_preview_builds_global: number;
    preview_ttl_hours: number;
  };
};

type StaticPreviewConfig = {
  adapter: "static";
  artifact_directory: string;
  index_file?: string;
  max_files?: number;
  max_bytes?: number;
};

type ProjectConfig = {
  repository: string;
  workspace: { worktree_root: string };
  preview?: StaticPreviewConfig | { adapter: string };
};

type ProjectsRegistry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};

type RuntimeRecord = {
  run_id: string;
  project: string;
  issue_number: number;
  run_state: string;
  execution_mode: string;
  worktree_path: string;
  preview_id: string;
  lease_id: string;
  lease_state: string;
  runtime_adapter: "compose" | "static";
  artifact_root: string | null;
  artifact_digest: string | null;
  artifact_file_count: number | null;
  artifact_total_bytes: number | null;
  slot_number: number;
  hostname: string;
  compose_project_name: string;
  ci_head_sha: string | null;
};

type ArtifactInventory = {
  digest: string;
  fileCount: number;
  totalBytes: number;
};

type StaticPlan = {
  runId: string;
  project: string;
  issueNumber: number;
  leaseState: string;
  slotNumber: number;
  previewUrl: string;
  worktreePath: string;
  sourceDirectory: string;
  indexFile: string;
  runtimeDirectory: string;
  snapshotDirectory: string;
  manifestPath: string;
  maxFiles: number;
  maxBytes: number;
};

const defaultMaxFiles = 5_000;
const defaultMaxBytes = 256 * 1024 * 1024;
const orchestratorHome = resolveKuramiHome(resolve(import.meta.dirname, "../../../../../.."));
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const projectsPath = resolve(orchestratorHome, "config/projects.yaml");
const runtimeRoot = resolve(orchestratorHome, "state/previews");
const previewManagerPath = resolve(import.meta.dirname, "../manager.ts");
const previewIngressPath = resolve(import.meta.dirname, "../ingress.ts");

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(): Arguments {
  const args = process.argv.slice(2);
  const command = args.shift() as Command | undefined;
  const runIndex = args.indexOf("--run-id");
  const runId = runIndex >= 0 ? args[runIndex + 1]?.trim() : undefined;
  const reasonIndex = args.indexOf("--release-reason");
  const releaseReason =
    reasonIndex >= 0 ? args[reasonIndex + 1]?.trim() : "preview_owner_stopped";
  const unknown = args.filter(
    (arg, index) =>
      arg !== "--apply" &&
      arg !== "--run-id" &&
      arg !== "--release-reason" &&
      index !== runIndex + 1 &&
      index !== reasonIndex + 1,
  );
  if (
    !command ||
    !["up", "down", "inspect"].includes(command) ||
    !runId ||
    !/^r_[a-zA-Z0-9_]+$/u.test(runId) ||
    unknown.length > 0 ||
    !["preview_owner_stopped", "preview_ttl_expired"].includes(releaseReason)
  ) {
    fail(
      "Usage: preview-static-runtime.ts <up|down|inspect> --run-id <id> [--apply]",
    );
  }
  if (command !== "down" && reasonIndex >= 0) {
    fail("--release-reason is valid only for down");
  }
  if (command === "inspect" && args.includes("--apply")) {
    fail("inspect does not accept --apply");
  }
  return {
    command,
    runId,
    apply: args.includes("--apply"),
    releaseReason: releaseReason as ReleaseReason,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function runFile(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      KURAMI_HOME: orchestratorHome,
      ORCHESTRATOR_HOME: orchestratorHome,
    },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  }).trim();
}

function loadRuntime(database: DatabaseSync, runId: string): RuntimeRecord {
  const row = database
    .prepare(`
      SELECT r.run_id, r.project, r.issue_number, r.state AS run_state,
             r.execution_mode, rr.worktree_path, rr.preview_id,
             pl.lease_id, pl.state AS lease_state, pl.runtime_adapter,
             pl.artifact_root, pl.artifact_digest, pl.artifact_file_count,
             pl.artifact_total_bytes, pl.slot_number,
             pl.compose_project_name, ps.hostname,
             ci.head_sha AS ci_head_sha
      FROM runs r
      JOIN run_resources rr USING (run_id)
      JOIN preview_leases pl ON pl.run_id=r.run_id AND pl.state <> 'released'
      JOIN preview_slots ps USING (slot_number)
      LEFT JOIN run_ci_snapshots ci USING (run_id)
      WHERE r.run_id=?
    `)
    .get(runId) as RuntimeRecord | undefined;
  if (!row) fail(`Active preview lease not found for run: ${runId}`);
  return row;
}

function validateRelativePath(value: string, label: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    !normalized ||
    isAbsolute(normalized) ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith(".") ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(segment),
    )
  ) {
    fail(`Unsafe ${label}: ${value}`);
  }
  return segments.join("/");
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    fail(`Invalid ${label}`);
  }
  return resolved;
}

async function buildPlan(
  record: RuntimeRecord,
  registry: ProjectsRegistry,
  requireSource: boolean,
  expectedHeadSha?: string,
): Promise<StaticPlan> {
  if (record.execution_mode !== "live") fail(`Run is not live: ${record.run_id}`);
  if (
    !["running", "remote_owned", "parked_review", "stopping", "needs_attention"].includes(
      record.run_state,
    )
  ) {
    fail(`Run is not preview-runtime eligible: ${record.run_state}`);
  }
  if (record.preview_id !== `preview-${record.slot_number}`) {
    fail(`Run/lease preview mapping mismatch: ${record.preview_id}`);
  }
  const project = registry.projects[record.project];
  if (!project) fail(`Unknown project: ${record.project}`);
  const preview = project.preview;
  if (requireSource && (!preview || preview.adapter !== "static")) {
    fail(`Static preview is not configured for project: ${record.project}`);
  }
  const staticPreview = preview as StaticPreviewConfig | undefined;
  const worktreeRoot = resolve(project.workspace.worktree_root);
  const worktreePath = resolve(record.worktree_path);
  const worktreeChild = relative(worktreeRoot, worktreePath);
  if (
    !worktreeChild ||
    worktreeChild.startsWith("..") ||
    resolve(worktreeRoot, worktreeChild) !== worktreePath
  ) {
    fail(`Worktree escapes configured root: ${worktreePath}`);
  }
  if (requireSource) {
    if (!(await pathExists(worktreePath))) fail(`Worktree is absent: ${worktreePath}`);
    if ((await realpath(worktreePath)) !== worktreePath) {
      fail(`Worktree path is not canonical: ${worktreePath}`);
    }
    const repositoryName = project.repository.split("/").at(-1);
    if (!repositoryName || basename(worktreePath) !== repositoryName) {
      fail("Worktree does not use the canonical repository basename");
    }
    if (!expectedHeadSha) fail("Static preview source SHA is absent");
    assertPreviewSourceRevision(worktreePath, expectedHeadSha);
  }
  const artifactDirectory = validateRelativePath(
    staticPreview?.artifact_directory ?? "artifact",
    "artifact_directory",
  );
  const indexFile = validateRelativePath(
    staticPreview?.index_file ?? "index.html",
    "index_file",
  );
  if (indexFile !== "index.html") {
    fail("Static preview index_file must be index.html");
  }
  const runtimeDirectory = resolve(runtimeRoot, record.run_id);
  const runtimeChild = relative(runtimeRoot, runtimeDirectory);
  if (
    !runtimeChild ||
    runtimeChild.startsWith("..") ||
    resolve(runtimeRoot, runtimeChild) !== runtimeDirectory
  ) {
    fail(`Runtime directory escapes managed root: ${runtimeDirectory}`);
  }
  return {
    runId: record.run_id,
    project: record.project,
    issueNumber: record.issue_number,
    leaseState: record.lease_state,
    slotNumber: record.slot_number,
    previewUrl: `https://${record.hostname}`,
    worktreePath,
    sourceDirectory: resolve(worktreePath, artifactDirectory),
    indexFile,
    runtimeDirectory,
    snapshotDirectory: resolve(runtimeDirectory, "artifact"),
    manifestPath: resolve(runtimeDirectory, "artifact-manifest.json"),
    maxFiles: boundedInteger(
      staticPreview?.max_files,
      defaultMaxFiles,
      1,
      20_000,
      "max_files",
    ),
    maxBytes: boundedInteger(
      staticPreview?.max_bytes,
      defaultMaxBytes,
      1_024,
      1024 * 1024 * 1024,
      "max_bytes",
    ),
  };
}

export async function inventoryArtifact(
  root: string,
  maxFiles: number,
  maxBytes: number,
): Promise<ArtifactInventory> {
  const canonicalRoot = resolve(root);
  if ((await realpath(canonicalRoot)) !== canonicalRoot) {
    fail(`Artifact root must be canonical: ${canonicalRoot}`);
  }
  const hash = createHash("sha256");
  let fileCount = 0;
  let totalBytes = 0;

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) fail(`Hidden artifact path is forbidden: ${entry.name}`);
      const path = resolve(directory, entry.name);
      const child = relative(canonicalRoot, path);
      if (!child || child.startsWith("..") || resolve(canonicalRoot, child) !== path) {
        fail(`Artifact path escapes root: ${path}`);
      }
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) fail(`Artifact symlink is forbidden: ${child}`);
      if (metadata.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!metadata.isFile()) fail(`Special artifact file is forbidden: ${child}`);
      fileCount += 1;
      totalBytes += metadata.size;
      if (fileCount > maxFiles) fail(`Static artifact exceeds ${maxFiles} files`);
      if (totalBytes > maxBytes) fail(`Static artifact exceeds ${maxBytes} bytes`);
      hash.update(child.replaceAll("\\", "/"));
      hash.update("\0");
      hash.update(await readFile(path));
      hash.update("\0");
    }
  };

  await visit(canonicalRoot);
  if (fileCount < 1) fail("Static artifact contains no files");
  return { digest: hash.digest("hex"), fileCount, totalBytes };
}

function claimBuild(
  database: DatabaseSync,
  record: RuntimeRecord,
  config: OrchestratorConfig,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const fresh = loadRuntime(database, record.run_id);
    if (!["leased", "failed"].includes(fresh.lease_state)) {
      fail(`Static preview cannot start from state: ${fresh.lease_state}`);
    }
    const building = Number(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM preview_leases WHERE state='provisioning'")
          .get() as { count: number }
      ).count,
    );
    if (building >= config.limits.max_preview_builds_global) {
      fail(
        `Preview build cap reached: ${building}/${config.limits.max_preview_builds_global}`,
      );
    }
    database
      .prepare(`
        UPDATE preview_leases
        SET state='provisioning', runtime_adapter='static',
            artifact_root=NULL, artifact_digest=NULL,
            artifact_file_count=NULL, artifact_total_bytes=NULL,
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE lease_id=?
      `)
      .run(record.lease_id);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function setLeaseState(
  database: DatabaseSync,
  leaseId: string,
  state: "running" | "releasing" | "failed",
): void {
  database
    .prepare(`
      UPDATE preview_leases
      SET state=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE lease_id=? AND state <> 'released'
    `)
    .run(state, leaseId);
}

function reconcileIngress(): void {
  runFile(process.execPath, [previewIngressPath, "reconcile", "--apply"]);
}

export function staticHealthRequest(
  previewUrl: string,
  indexFile: string,
): RequestOptions {
  return {
    hostname: "127.0.0.1",
    port: 9180,
    path: `/${indexFile}`,
    method: "GET",
    headers: { Host: new URL(previewUrl).hostname },
  };
}

async function requestHealth(options: RequestOptions): Promise<number> {
  return await new Promise<number>((resolvePromise, rejectPromise) => {
    const healthRequest = request(options, (response) => {
      const status = response.statusCode ?? 0;
      response.resume();
      resolvePromise(status);
    });
    healthRequest.setTimeout(5_000, () => {
      healthRequest.destroy(new Error("Static preview health request timed out"));
    });
    healthRequest.once("error", rejectPromise);
    healthRequest.end();
  });
}

async function waitForHealth(plan: StaticPlan): Promise<void> {
  const options = staticHealthRequest(plan.previewUrl, plan.indexFile);
  const deadline = Date.now() + 30_000;
  let lastError = "health check did not run";
  while (Date.now() < deadline) {
    try {
      const status = await requestHealth(options);
      if (status >= 200 && status < 300) return;
      lastError = `HTTP ${status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  fail(`Static preview health check timed out: ${lastError}`);
}

async function createSnapshot(
  plan: StaticPlan,
  source: ArtifactInventory,
): Promise<void> {
  if (await pathExists(plan.runtimeDirectory)) {
    fail("Static runtime directory already exists; cleanup is required before retry");
  }
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  await mkdir(plan.runtimeDirectory, { mode: 0o700 });
  await cp(plan.sourceDirectory, plan.snapshotDirectory, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const snapshot = await inventoryArtifact(
    plan.snapshotDirectory,
    plan.maxFiles,
    plan.maxBytes,
  );
  if (
    snapshot.digest !== source.digest ||
    snapshot.fileCount !== source.fileCount ||
    snapshot.totalBytes !== source.totalBytes
  ) {
    fail("Static artifact changed while the managed snapshot was being created");
  }
  await writeFile(
    plan.manifestPath,
    `${JSON.stringify({ version: 1, ...snapshot }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  await chmod(plan.runtimeDirectory, 0o700);
  await chmod(plan.snapshotDirectory, 0o700);
}

async function up(
  database: DatabaseSync,
  record: RuntimeRecord,
  plan: StaticPlan,
  config: OrchestratorConfig,
  apply: boolean,
): Promise<void> {
  if (!["running", "remote_owned", "parked_review"].includes(record.run_state)) {
    fail(`Run cannot start a static preview from state: ${record.run_state}`);
  }
  if (!(await pathExists(plan.sourceDirectory))) {
    fail(`Static artifact directory is absent: ${plan.sourceDirectory}`);
  }
  const source = await inventoryArtifact(
    plan.sourceDirectory,
    plan.maxFiles,
    plan.maxBytes,
  );
  if (!(await pathExists(resolve(plan.sourceDirectory, plan.indexFile)))) {
    fail(`Static artifact index is absent: ${plan.indexFile}`);
  }
  const view = { ...plan, artifact: source };
  if (!apply) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: false, action: "up", plan: view })}\n`,
    );
    return;
  }

  claimBuild(database, record, config);
  try {
    await createSnapshot(plan, source);
    database
      .prepare(`
        UPDATE preview_leases
        SET artifact_root=?, artifact_digest=?, artifact_file_count=?,
            artifact_total_bytes=?, state='running',
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE lease_id=? AND state='provisioning' AND runtime_adapter='static'
      `)
      .run(
        plan.snapshotDirectory,
        source.digest,
        source.fileCount,
        source.totalBytes,
        record.lease_id,
      );
    reconcileIngress();
    await waitForHealth(plan);
    database
      .prepare(`
        UPDATE preview_leases
        SET verified_head_sha=?,
            expires_at=strftime(
              '%Y-%m-%dT%H:%M:%fZ', 'now', '+' || ? || ' hours'
            ),
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE lease_id=? AND state='running' AND runtime_adapter='static'
      `)
      .run(record.ci_head_sha, config.limits.preview_ttl_hours, record.lease_id);
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        apply: true,
        action: "running",
        runId: plan.runId,
        adapter: "static",
        slotNumber: plan.slotNumber,
        previewUrl: plan.previewUrl,
        artifact: source,
        verifiedHeadSha: record.ci_head_sha,
      })}\n`,
    );
  } catch (error) {
    setLeaseState(database, record.lease_id, "failed");
    try {
      reconcileIngress();
    } catch {
      // Preserve the original snapshot or ingress failure.
    }
    throw error;
  }
}

async function down(
  database: DatabaseSync,
  record: RuntimeRecord,
  plan: StaticPlan,
  apply: boolean,
  releaseReason: ReleaseReason,
): Promise<void> {
  const runtimePresent = await pathExists(plan.runtimeDirectory);
  const view = { ...plan, runtimePresent };
  if (!apply) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: false, action: "down", plan: view })}\n`,
    );
    return;
  }
  if (record.runtime_adapter !== "static") {
    fail(`Lease is not owned by the static adapter: ${record.runtime_adapter}`);
  }
  if (
    record.artifact_root !== null &&
    resolve(record.artifact_root) !== plan.snapshotDirectory
  ) {
    fail(`Recorded artifact root is outside the exact managed runtime`);
  }
  setLeaseState(database, record.lease_id, "releasing");
  try {
    reconcileIngress();
    if (runtimePresent) {
      await rm(plan.runtimeDirectory, { recursive: true, force: false });
    }
    runFile(process.execPath, [
      previewManagerPath,
      "release",
      "--run-id",
      plan.runId,
      "--apply",
      "--runtime-absent",
      "--release-reason",
      releaseReason,
    ]);
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        apply: true,
        action: "removed",
        runId: plan.runId,
        adapter: "static",
        slotNumber: plan.slotNumber,
      })}\n`,
    );
  } catch (error) {
    setLeaseState(database, record.lease_id, "failed");
    throw error;
  }
}

function inspect(record: RuntimeRecord, plan: StaticPlan): void {
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      runId: plan.runId,
      adapter: record.runtime_adapter,
      leaseState: record.lease_state,
      slotNumber: plan.slotNumber,
      previewUrl: plan.previewUrl,
      artifactRoot: record.artifact_root,
      artifactDigest: record.artifact_digest,
      artifactFileCount: record.artifact_file_count,
      artifactTotalBytes: record.artifact_total_bytes,
    })}\n`,
  );
}

export async function runPreviewStaticRuntimeCli(): Promise<void> {
  const args = parseArguments();
  const config = await loadEffectiveOrchestratorConfig<OrchestratorConfig>(
    orchestratorHome,
  );
  const registry = parse(await readFile(projectsPath, "utf8")) as ProjectsRegistry;
  if (config.version !== 1 || registry.version !== 1) {
    fail("Unsupported config version");
  }
  if (args.apply && config.mode !== "live") {
    fail(`Refusing preview runtime mutation in mode=${config.mode}`);
  }
  if (
    !Number.isInteger(config.limits.max_preview_builds_global) ||
    config.limits.max_preview_builds_global < 1 ||
    !Number.isInteger(config.limits.preview_ttl_hours) ||
    config.limits.preview_ttl_hours < 1 ||
    config.limits.preview_ttl_hours > 168
  ) {
    fail("Invalid static preview limits");
  }
  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  try {
    database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    const record = loadRuntime(database, args.runId);
    const expectedHeadSha =
      args.command === "up" ? requireExactHeadSha(record.ci_head_sha) : undefined;
    const plan = await buildPlan(
      record,
      registry,
      args.command === "up",
      expectedHeadSha,
    );
    if (args.command === "up") {
      await up(database, record, plan, config, args.apply);
    } else if (args.command === "down") {
      await down(database, record, plan, args.apply, args.releaseReason);
    } else {
      inspect(record, plan);
    }
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  runPreviewStaticRuntimeCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
