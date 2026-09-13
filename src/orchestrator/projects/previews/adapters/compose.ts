import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
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
    min_preview_available_memory_mib: number;
    min_preview_available_disk_gib: number;
  };
};

type PreviewHealth = { service: string; path: string };
type PreviewConfig = {
  adapter: "compose";
  compose_file: string;
  secrets_file?: string;
  services: Record<string, string>;
  health: { frontend: PreviewHealth; backend: PreviewHealth; minio: PreviewHealth };
  required_secret_keys?: string[];
  runtime_variables?: Record<string, string>;
  runtime_environment?: Record<string, Record<string, string>>;
  runtime_build_args?: Record<string, Record<string, string>>;
};

type ProjectConfig = {
  repository: string;
  workspace: {
    worktree_root: string;
  };
  preview?: PreviewConfig;
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
  slot_number: number;
  hostname: string;
  assets_hostname: string;
  frontend_port: number;
  backend_port: number;
  postgres_port: number;
  redis_port: number;
  minio_api_port: number;
  minio_console_port: number;
  compose_project_name: string;
  ci_head_sha: string | null;
};

type RuntimePlan = {
  runId: string;
  project: string;
  issueNumber: number;
  leaseState: string;
  slotNumber: number;
  previewUrl: string;
  assetsUrl: string;
  composeProjectName: string;
  worktreePath: string;
  composeFile: string;
  runtimeDirectory: string;
  runtimeEnvPath: string;
  overridePath: string;
  sourceComposePath: string;
  sourceRevision: string;
  ports: {
    frontend: number;
    backend: number;
    postgres: number;
    redis: number;
    minioApi: number;
    minioConsole: number;
  };
};

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
  if (!command || !["up", "down", "inspect"].includes(command)) {
    fail("Usage: preview-runtime.ts <up|down|inspect> --run-id <id> [--apply]");
  }
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
    !runId ||
    unknown.length > 0 ||
    !["preview_owner_stopped", "preview_ttl_expired"].includes(releaseReason)
  ) {
    fail("Usage: preview-runtime.ts <up|down|inspect> --run-id <id> [--apply]");
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

function runFile(command: string, args: string[], env = process.env): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30 * 60_000,
  }).trim();
}

function loadRuntime(database: DatabaseSync, runId: string): RuntimeRecord {
  const row = database
    .prepare(`
      SELECT r.run_id, r.project, r.issue_number, r.state AS run_state,
             r.execution_mode, rr.worktree_path, rr.preview_id,
             pl.lease_id, pl.state AS lease_state, pl.slot_number,
             pl.compose_project_name, ci.head_sha AS ci_head_sha,
             ps.hostname, ps.assets_hostname,
             ps.frontend_port, ps.backend_port, ps.postgres_port, ps.redis_port,
             ps.minio_api_port, ps.minio_console_port
      FROM runs r
      JOIN run_resources rr USING (run_id)
      JOIN preview_leases pl ON pl.run_id = r.run_id AND pl.state <> 'released'
      JOIN preview_slots ps USING (slot_number)
      LEFT JOIN run_ci_snapshots ci USING (run_id)
      WHERE r.run_id = ?
    `)
    .get(runId) as RuntimeRecord | undefined;
  if (!row) fail(`Active preview lease not found for run: ${runId}`);
  return row;
}

function validateRuntimeDirectory(runId: string): string {
  if (!/^r_[a-zA-Z0-9_]+$/.test(runId)) {
    fail(`Unsafe run ID for runtime path: ${runId}`);
  }
  const directory = resolve(runtimeRoot, runId);
  const child = relative(runtimeRoot, directory);
  if (!child || child.startsWith("..") || resolve(runtimeRoot, child) !== directory) {
    fail(`Runtime directory escapes configured root: ${directory}`);
  }
  return directory;
}

async function buildPlan(
  record: RuntimeRecord,
  registry: ProjectsRegistry,
  requireSource: boolean,
  expectedHeadSha?: string,
): Promise<{ plan: RuntimePlan; preview: PreviewConfig }> {
  if (record.execution_mode !== "live") fail(`Run is not live: ${record.run_id}`);
  if (
    ![
      "running",
      "remote_owned",
      "parked_review",
      "stopping",
      "needs_attention",
    ].includes(record.run_state)
  ) {
    fail(`Run is not preview-runtime eligible: ${record.run_state}`);
  }
  if (!record.worktree_path) fail("Run has no worktree path");
  if (record.preview_id !== `preview-${record.slot_number}`) {
    fail(`Run/lease preview mapping mismatch: ${record.preview_id}`);
  }

  const project = registry.projects[record.project];
  if (!project) fail(`Unknown project: ${record.project}`);
  const preview = project.preview;
  if (requireSource && (!preview || preview.adapter !== "compose")) {
    fail(`Compose preview is not configured for project: ${record.project}`);
  }
  const composePreview = preview as PreviewConfig | undefined;
  const worktreeRoot = resolve(project.workspace.worktree_root);
  const worktreePath = resolve(record.worktree_path);
  const child = relative(worktreeRoot, worktreePath);
  if (!child || child.startsWith("..") || resolve(worktreeRoot, child) !== worktreePath) {
    fail(`Worktree escapes configured root: ${worktreePath}`);
  }
  if (requireSource) {
    if (!(await pathExists(worktreePath))) fail(`Worktree is absent: ${worktreePath}`);
    if ((await realpath(worktreePath)) !== worktreePath) {
      fail(`Worktree path is not canonical: ${worktreePath}`);
    }
    const repositoryName = project.repository.split("/").at(-1);
    if (!repositoryName || basename(worktreePath) !== repositoryName) {
      fail(`Worktree does not use the canonical repository basename`);
    }
    if (!expectedHeadSha) fail("Compose preview source SHA is absent");
    assertPreviewSourceRevision(worktreePath, expectedHeadSha);
  }
  const runtimeDirectory = validateRuntimeDirectory(record.run_id);
  const sourceComposePath = resolve(runtimeDirectory, "source.compose.yaml");
  const sourceComposeFile = composePreview
    ? resolve(worktreePath, composePreview.compose_file)
    : sourceComposePath;
  if (requireSource) {
    const composeChild = relative(worktreePath, sourceComposeFile);
    if (composeChild.startsWith("..") || !(await pathExists(sourceComposeFile))) {
      fail(`Compose file is absent or escapes worktree: ${sourceComposeFile}`);
    }
  }
  const composeFile = requireSource ? sourceComposeFile : sourceComposePath;
  return {
    preview: composePreview as PreviewConfig,
    plan: {
      runId: record.run_id,
      project: record.project,
      issueNumber: record.issue_number,
      leaseState: record.lease_state,
      slotNumber: record.slot_number,
      previewUrl: `https://${record.hostname}`,
      assetsUrl: `https://${record.assets_hostname}`,
      composeProjectName: record.compose_project_name,
      worktreePath,
      composeFile,
      runtimeDirectory,
      runtimeEnvPath: resolve(runtimeDirectory, "runtime.env"),
      overridePath: resolve(runtimeDirectory, "compose.preview.yaml"),
      sourceComposePath,
      sourceRevision: expectedHeadSha ?? "",
      ports: {
        frontend: record.frontend_port,
        backend: record.backend_port,
        postgres: record.postgres_port,
        redis: record.redis_port,
        minioApi: record.minio_api_port,
        minioConsole: record.minio_console_port,
      },
    },
  };
}

function parseSecretFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) fail("Preview secret file contains an invalid line");
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function envLine(key: string, value: string | number): string {
  return `${key}=${JSON.stringify(String(value))}`;
}

async function writeRuntimeFiles(
  plan: RuntimePlan,
  preview: PreviewConfig,
): Promise<void> {
  const requiredSecretKeys = preview.required_secret_keys ?? [];
  const secretValues = requiredSecretKeys.length > 0
    ? parseSecretFile(await readFile(preview.secrets_file ?? "", "utf8"))
    : {};
  for (const key of requiredSecretKeys) {
    if (!secretValues[key]) fail(`Missing required preview credential: ${key}`);
  }
  if (!plan.sourceRevision) fail("Preview runtime requires the exact CI head SHA");

  const postgresPassword = randomBytes(32).toString("base64url");
  const runtimeValues: Record<string, string | number> = {
    FRONTEND_PORT: plan.ports.frontend,
    BACKEND_PORT: plan.ports.backend,
    POSTGRES_PORT: plan.ports.postgres,
    REDIS_PORT: plan.ports.redis,
    MINIO_API_PORT: plan.ports.minioApi,
    MINIO_CONSOLE_PORT: plan.ports.minioConsole,
    SOURCE_REVISION: plan.sourceRevision,
    PREVIEW_URL: plan.previewUrl,
    PREVIEW_API_URL: `${plan.previewUrl}/api`,
    PREVIEW_ASSETS_URL: plan.assetsUrl,
    ...secretValues,
    ...(preview.runtime_variables ?? {}),
    JWT_SECRET: randomBytes(48).toString("base64url"),
    E2E_TEST_SECRET: randomBytes(48).toString("base64url"),
    POSTGRES_PASSWORD: postgresPassword,
    DATABASE_URL: `postgresql://pickflick:${postgresPassword}@postgres:5432/pickflick`,
    MINIO_ROOT_USER: `kurami${plan.slotNumber}`,
    MINIO_ROOT_PASSWORD: randomBytes(32).toString("base64url"),
  };
  // Docker Compose requires `services` to be a mapping. PickFlick's preview
  // topology is self-contained, so it may not need any generated override.
  const overrideLines = ["services: {}"];
  let hasOverrides = false;
  for (const [role, environment] of Object.entries(preview.runtime_environment ?? {})) {
    if (!hasOverrides) {
      overrideLines[0] = "services:";
      hasOverrides = true;
    }
    const service = preview.services[role];
    if (!service) fail(`Preview runtime environment references unknown service role: ${role}`);
    overrideLines.push(`  ${service}:`, "    environment:");
    for (const [key, value] of Object.entries(environment)) overrideLines.push(`      ${key}: ${value}`);
  }
  for (const [role, args] of Object.entries(preview.runtime_build_args ?? {})) {
    if (!hasOverrides) {
      overrideLines[0] = "services:";
      hasOverrides = true;
    }
    const service = preview.services[role];
    if (!service) fail(`Preview runtime build args reference unknown service role: ${role}`);
    overrideLines.push(`  ${service}:`, "    build:", "      args:");
    for (const [key, value] of Object.entries(args)) overrideLines.push(`        ${key}: ${value}`);
  }
  const override = `${overrideLines.join("\n")}\n`;

  await mkdir(plan.runtimeDirectory, { recursive: false, mode: 0o700 });
  await writeFile(
    plan.runtimeEnvPath,
    `${Object.entries(runtimeValues).map(([key, value]) => envLine(key, value)).join("\n")}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  await copyFile(plan.composeFile, plan.sourceComposePath, 0);
  await writeFile(plan.overridePath, override, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(plan.runtimeDirectory, 0o700);
  await chmod(plan.runtimeEnvPath, 0o600);
  await chmod(plan.overridePath, 0o600);
  await chmod(plan.sourceComposePath, 0o600);
}
function composeArguments(plan: RuntimePlan): string[] {
  return [
    "compose",
    "--env-file",
    plan.runtimeEnvPath,
    "-f",
    plan.composeFile,
    "-f",
    plan.overridePath,
    "-p",
    plan.composeProjectName,
  ];
}

function assertRootlessDocker(): void {
  const securityOptions = runFile("docker", [
    "info",
    "--format",
    "{{json .SecurityOptions}}",
  ]);
  if (!securityOptions.includes("name=rootless")) {
    fail("Preview runtime requires the rootless Docker daemon");
  }
}

async function assertCapacity(config: OrchestratorConfig): Promise<void> {
  const memory = await readFile("/proc/meminfo", "utf8");
  const availableKiB = Number(/^MemAvailable:\s+(\d+)\s+kB$/m.exec(memory)?.[1]);
  if (!Number.isFinite(availableKiB)) fail("Cannot read MemAvailable");
  const availableMiB = Math.floor(availableKiB / 1024);
  if (availableMiB < config.limits.min_preview_available_memory_mib) {
    fail(
      `Insufficient available memory: ${availableMiB} MiB < ${config.limits.min_preview_available_memory_mib} MiB`,
    );
  }

  const filesystem = await statfs(orchestratorHome, { bigint: true });
  const availableGiB = Number(
    (filesystem.bavail * filesystem.bsize) / (1024n * 1024n * 1024n),
  );
  if (availableGiB < config.limits.min_preview_available_disk_gib) {
    fail(
      `Insufficient available disk: ${availableGiB} GiB < ${config.limits.min_preview_available_disk_gib} GiB`,
    );
  }
}

function assertPortsFree(plan: RuntimePlan): void {
  const output = runFile("ss", ["-H", "-ltn"]);
  const listeningPorts = new Set(
    output
      .split("\n")
      .map((line) => /:(\d+)\s*$/.exec(line.trim())?.[1])
      .filter((port): port is string => Boolean(port))
      .map(Number),
  );
  const occupied = Object.values(plan.ports).filter((port) => listeningPorts.has(port));
  if (occupied.length > 0) {
    fail(`Preview ports are already occupied: ${occupied.join(", ")}`);
  }
}

function claimBuild(
  database: DatabaseSync,
  record: RuntimeRecord,
  config: OrchestratorConfig,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const fresh = loadRuntime(database, record.run_id);
    if (fresh.lease_state === "running") {
      fail(`Preview is already running for run: ${record.run_id}`);
    }
    if (fresh.lease_state !== "leased") {
      fail(`Preview lease cannot start from state: ${fresh.lease_state}`);
    }
    const building = Number(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM preview_leases WHERE state = 'provisioning'")
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
        SET state = 'provisioning',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE lease_id = ?
      `)
      .run(record.lease_id);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function markLeaseState(
  database: DatabaseSync,
  leaseId: string,
  state: "running" | "releasing" | "failed",
  ttlHours?: number,
  verifiedHeadSha?: string | null,
): void {
  if (state === "running" && (!ttlHours || !Number.isInteger(ttlHours))) {
    fail("Running preview requires a valid TTL");
  }
  database
    .prepare(`
      UPDATE preview_leases
      SET state = ?,
          verified_head_sha = CASE
            WHEN ? = 'running' THEN ?
            ELSE verified_head_sha
          END,
          expires_at = CASE
            WHEN ? = 'running' THEN strftime(
              '%Y-%m-%dT%H:%M:%fZ', 'now', '+' || ? || ' hours'
            )
            ELSE expires_at
          END,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE lease_id = ? AND state <> 'released'
    `)
    .run(state, state, verifiedHeadSha ?? null, state, ttlHours ?? 0, leaseId);
}

function reconcileIngress(): void {
  runFile(
    process.execPath,
    [previewIngressPath, "reconcile", "--apply"],
    {
      ...process.env,
      KURAMI_HOME: orchestratorHome,
    },
  );
}

async function waitForHealth(plan: RuntimePlan, preview: PreviewConfig): Promise<void> {
  const checks = [
    `http://127.0.0.1:${plan.ports.frontend}${preview.health.frontend.path}`,
    `http://127.0.0.1:${plan.ports.backend}${preview.health.backend.path}`,
    `http://127.0.0.1:${plan.ports.minioApi}${preview.health.minio.path}`,
  ];
  const deadline = Date.now() + 180_000;
  let lastError = "health check did not run";
  while (Date.now() < deadline) {
    try {
      const responses = await Promise.all(checks.map((url) => fetch(url)));
      if (responses.every((response) => response.ok)) return;
      lastError = responses.map((response) => response.status).join(",");
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000));
  }
  fail(`Preview health check timed out: ${lastError}`);
}

function composeContainers(composeProjectName: string): string[] {
  const result = spawnSync(
    "docker",
    [
      "ps",
      "-aq",
      "--filter",
      `label=com.docker.compose.project=${composeProjectName}`,
    ],
    { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status !== 0) fail(result.stderr.trim() || "Cannot inspect Compose containers");
  return result.stdout.split("\n").filter(Boolean);
}

async function up(
  database: DatabaseSync,
  record: RuntimeRecord,
  plan: RuntimePlan,
  preview: PreviewConfig,
  config: OrchestratorConfig,
  apply: boolean,
): Promise<void> {
  if (!["running", "remote_owned", "parked_review"].includes(record.run_state)) {
    fail(`Run cannot start a preview from state: ${record.run_state}`);
  }
  if (!apply) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: false, action: "up", plan })}
`,
    );
    return;
  }
  assertRootlessDocker();
  await assertCapacity(config);
  if (composeContainers(plan.composeProjectName).length === 0) {
    assertPortsFree(plan);
  }
  claimBuild(database, record, config);

  try {
    if (!(await pathExists(plan.runtimeDirectory))) {
      await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
      await writeRuntimeFiles(plan, preview);
    }
    if (
      !(await pathExists(plan.runtimeEnvPath)) ||
      !(await pathExists(plan.overridePath)) ||
      !(await pathExists(plan.sourceComposePath))
    ) {
      fail("Preview runtime directory is incomplete; manual reconciliation required");
    }
    runFile("docker", [...composeArguments(plan), "up", "--build", "-d"]);
    await waitForHealth(plan, preview);
    markLeaseState(
      database,
      record.lease_id,
      "running",
      config.limits.preview_ttl_hours,
      record.ci_head_sha,
    );
    reconcileIngress();
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        apply: true,
        action: "running",
        runId: plan.runId,
        slotNumber: plan.slotNumber,
        previewUrl: plan.previewUrl,
        assetsUrl: plan.assetsUrl,
        composeProjectName: plan.composeProjectName,
        verifiedHeadSha: record.ci_head_sha,
      })}
`,
    );
  } catch (error) {
    markLeaseState(database, record.lease_id, "failed");
    try {
      reconcileIngress();
    } catch {
      // Preserve the original provisioning error. Reconciliation is retriable.
    }
    throw error;
  }
}

async function down(
  database: DatabaseSync,
  record: RuntimeRecord,
  plan: RuntimePlan,
  apply: boolean,
  releaseReason: ReleaseReason,
): Promise<void> {
  const containers = composeContainers(plan.composeProjectName);
  const runtimeFilesPresent =
    (await pathExists(plan.runtimeEnvPath)) && (await pathExists(plan.overridePath));
  const releasePlan = {
    ...plan,
    containers: containers.length,
    runtimeFilesPresent,
  };
  if (!apply) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: false, action: "down", plan: releasePlan })}
`,
    );
    return;
  }
  assertRootlessDocker();
  markLeaseState(database, record.lease_id, "releasing");
  try {
    // Remove public routing before stopping any runtime component.
    reconcileIngress();
    if (containers.length > 0) {
      if (!runtimeFilesPresent) {
        fail("Runtime files are missing while Compose containers still exist");
      }
      runFile("docker", [
        ...composeArguments(plan),
        "down",
        "-v",
        "--remove-orphans",
      ]);
    }
    const remaining = composeContainers(plan.composeProjectName);
    if (remaining.length > 0) {
      fail(`Compose cleanup left ${remaining.length} container(s)`);
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
    ], {
      ...process.env,
      KURAMI_HOME: orchestratorHome,
    });
    if (await pathExists(plan.runtimeDirectory)) {
      await rm(plan.runtimeDirectory, { recursive: true, force: false });
    }
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        apply: true,
        action: "removed",
        runId: plan.runId,
        slotNumber: plan.slotNumber,
        composeProjectName: plan.composeProjectName,
      })}
`,
    );
  } catch (error) {
    markLeaseState(database, record.lease_id, "failed");
    throw error;
  }
}

function inspect(record: RuntimeRecord, plan: RuntimePlan): void {
  const containers = composeContainers(plan.composeProjectName);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      runId: plan.runId,
      leaseState: record.lease_state,
      slotNumber: plan.slotNumber,
      previewUrl: plan.previewUrl,
      assetsUrl: plan.assetsUrl,
      composeProjectName: plan.composeProjectName,
      containerCount: containers.length,
      containerIds: containers,
    })}
`,
  );
}

export async function runPreviewComposeRuntimeCli(): Promise<void> {
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
  for (const [key, value] of Object.entries({
    max_preview_builds_global: config.limits.max_preview_builds_global,
    preview_ttl_hours: config.limits.preview_ttl_hours,
    min_preview_available_memory_mib: config.limits.min_preview_available_memory_mib,
    min_preview_available_disk_gib: config.limits.min_preview_available_disk_gib,
  })) {
    if (!Number.isInteger(value) || value < 1) fail(`Invalid ${key}`);
  }
  if (config.limits.preview_ttl_hours > 168) fail("Invalid preview_ttl_hours");

  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const record = loadRuntime(database, args.runId);
    const expectedHeadSha =
      args.command === "up" ? requireExactHeadSha(record.ci_head_sha) : undefined;
    const { plan, preview } = await buildPlan(
      record,
      registry,
      args.command === "up",
      expectedHeadSha,
    );
    if (args.command === "up") {
      await up(database, record, plan, preview, config, args.apply);
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
  runPreviewComposeRuntimeCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}
`);
    process.exitCode = 1;
  });
}
