import { spawnSync } from "node:child_process";
import { lstat, readFile, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

process.umask(0o077);

type LogCandidate = {
  path: string;
  bytes: number;
  ageDays: number;
};

type CommandOutput = {
  command: string[];
  stdout: string;
};

const allowedLogExtension = /\.(?:log|jsonl|txt)$/;
const defaultLogRetentionDays = 90;
const dockerRetentionHours = 720;
const defaultBuilderCacheMaxUsedGib = 8;

function fail(message: string): never {
  throw new Error(message);
}

function parseLogRetention(value: string | undefined): number {
  if (value === undefined) return defaultLogRetentionDays;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 30 || parsed > 365) {
    fail("KURAMI_LOG_RETENTION_DAYS must be an integer between 30 and 365");
  }
  return parsed;
}

export function parseBuilderCacheMaxUsedGib(value: unknown): number {
  if (value === undefined) return defaultBuilderCacheMaxUsedGib;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 256)
    fail("builder_cache_max_used_gib must be an integer between 1 and 256");
  return Number(value);
}

async function builderCacheMaxUsedGib(orchestratorHome: string): Promise<number> {
  const config = parse(
    await readFile(resolve(orchestratorHome, "config/orchestrator.yaml"), "utf8"),
  ) as { limits?: { builder_cache_max_used_gib?: unknown } };
  return parseBuilderCacheMaxUsedGib(config.limits?.builder_cache_max_used_gib);
}

export function builderCachePruneArgs(maxUsedGib: number): string[] {
  return [
    "builder",
    "prune",
    "--force",
    "--max-used-space",
    String(maxUsedGib * 1024 ** 3),
  ];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function reclaimedSpace(output: CommandOutput | undefined): string {
  if (!output) return "unknown";
  const line = output.stdout
    .split("\n")
    .find((entry) => entry.startsWith("Total reclaimed space:"));
  return line?.slice("Total reclaimed space:".length).trim() || "0 B";
}

export function formatMaintenanceSummary(result: {
  removedLogFiles: number;
  removedLogBytes: number;
  docker: CommandOutput[];
  builderCacheMaxUsedGib?: number;
}): string {
  const checkedAt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Vilnius",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return [
    "🧹 Kurami Orchestrator monthly maintenance completed",
    `- Removed logs: ${result.removedLogFiles} (${formatBytes(result.removedLogBytes)})`,
    `- Unused images reclaimed: ${reclaimedSpace(result.docker[0])}`,
    `- Builder cache reclaimed: ${reclaimedSpace(result.docker[1])}`,
    `- Builder cache ceiling: ${result.builderCacheMaxUsedGib ?? defaultBuilderCacheMaxUsedGib} GiB`,
    "- Preserved: containers, volumes, networks, worktrees, preview runtimes",
    `- Completed: ${checkedAt.replaceAll("/", ".").replace(",", "")}`,
  ].join("\n");
}

export async function findOldLogFiles(
  logRoot: string,
  nowMs: number,
  retentionDays: number,
): Promise<LogCandidate[]> {
  const candidates: LogCandidate[] = [];

  async function walk(directory: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const name of names) {
      const path = resolve(directory, name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) continue;
      if (metadata.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!metadata.isFile() || !allowedLogExtension.test(name)) continue;
      const ageDays = Math.floor((nowMs - metadata.mtimeMs) / 86_400_000);
      if (ageDays < retentionDays) continue;
      candidates.push({ path, bytes: metadata.size, ageDays });
    }
  }

  await walk(resolve(logRoot));
  return candidates.sort((left, right) => left.path.localeCompare(right.path));
}

function runDocker(args: string[]): CommandOutput {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(result.stderr.trim() || `Docker command failed: ${args.join(" ")}`);
  }
  return { command: ["docker", ...args], stdout: result.stdout.trim() };
}

function assertRootlessDocker(): void {
  const info = runDocker(["info", "--format", "{{json .SecurityOptions}}"]);
  if (!info.stdout.includes("name=rootless")) {
    fail("Monthly maintenance requires the rootless Docker daemon");
  }
}

export async function monthlyMaintenance(
  orchestratorHome: string,
  apply: boolean,
  nowMs = Date.now(),
): Promise<object> {
  const retentionDays = parseLogRetention(process.env.KURAMI_LOG_RETENTION_DAYS);
  const maxUsedGib = await builderCacheMaxUsedGib(orchestratorHome);
  const candidates = await findOldLogFiles(
    resolve(orchestratorHome, "logs"),
    nowMs,
    retentionDays,
  );
  const bytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0);

  if (!apply) {
    return {
      ok: true,
      apply: false,
      logRetentionDays: retentionDays,
      logFiles: candidates,
      logBytes: bytes,
      dockerPlan: [
        `docker image prune --all --force --filter until=${dockerRetentionHours}h`,
        `docker ${builderCachePruneArgs(maxUsedGib).join(" ")}`,
      ],
      builderCacheMaxUsedGib: maxUsedGib,
      excluded: ["containers", "volumes", "networks", "worktrees", "preview runtimes"],
    };
  }

  assertRootlessDocker();

  for (const candidate of candidates) {
    const metadata = await lstat(candidate.path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail(`Refusing unsafe log cleanup target: ${candidate.path}`);
    }
    await unlink(candidate.path);
  }

  const docker = [
    runDocker([
      "image",
      "prune",
      "--all",
      "--force",
      "--filter",
      `until=${dockerRetentionHours}h`,
    ]),
    runDocker(builderCachePruneArgs(maxUsedGib)),
  ];

  return {
    ok: true,
    apply: true,
    removedLogFiles: candidates.length,
    removedLogBytes: bytes,
    docker,
    builderCacheMaxUsedGib: maxUsedGib,
    excluded: ["containers", "volumes", "networks", "worktrees", "preview runtimes"],
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const summaryText = process.argv.includes("--summary-text");
  const unknown = process.argv
    .slice(2)
    .filter((arg) => !["--apply", "--summary-text"].includes(arg));
  if (unknown.length > 0 || (summaryText && !apply)) {
    fail("Usage: monthly-maintenance.ts [--apply [--summary-text]]");
  }
  const orchestratorHome = resolve(
    process.env.KURAMI_HOME ?? process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
  );
  const result = await monthlyMaintenance(orchestratorHome, apply);
  if (summaryText) {
    process.stdout.write(
      `${formatMaintenanceSummary(result as {
        removedLogFiles: number;
        removedLogBytes: number;
        docker: CommandOutput[];
        builderCacheMaxUsedGib: number;
      })}\n`,
    );
    return;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
