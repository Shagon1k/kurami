import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

process.umask(0o077);

type HealthSettingsState = {
  version: 1;
  revision: number;
  intervalMinutes: number;
  actorId: string;
  appliedAt: string;
};

const allowedIntervals = new Set([5, 10, 12, 15, 20, 30, 60]);
const defaultIntervalMinutes = 20;
const defaultHealthJobId = "ee530a53db44";

function fail(message: string): never {
  throw new Error(message);
}

function integer(value: string | undefined, name: string): number {
  if (!value || !/^\d+$/u.test(value)) fail(`Invalid ${name}`);
  return Number(value);
}

async function readState(path: string): Promise<HealthSettingsState | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<HealthSettingsState>;
    if (
      value.version === 1 &&
      Number.isInteger(value.revision) &&
      Number(value.revision) >= 1 &&
      Number.isInteger(value.intervalMinutes) &&
      allowedIntervals.has(Number(value.intervalMinutes)) &&
      typeof value.actorId === "string" &&
      typeof value.appliedAt === "string"
    ) {
      return value as HealthSettingsState;
    }
    fail("Health settings state is invalid");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeState(path: string, state: HealthSettingsState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function editHealthSchedule(intervalMinutes: number, orchestratorHome: string): void {
  const hermesHome = resolve(
    process.env.HERMES_HOME ?? "/home/shagon1k/_hermes/_core",
  );
  const hermesBinary = resolve(
    process.env.HERMES_BIN ?? resolve(hermesHome, "hermes-agent/venv/bin/hermes"),
  );
  const jobId = process.env.KURAMI_HEALTH_JOB_ID?.trim() || defaultHealthJobId;
  if (!/^[a-f0-9]{12}$/u.test(jobId)) fail("Invalid health job ID");
  const result = spawnSync(
    hermesBinary,
    ["cron", "edit", jobId, "--schedule", `*/${intervalMinutes} * * * *`],
    {
      encoding: "utf8",
      cwd: orchestratorHome,
      env: { ...process.env, HERMES_HOME: hermesHome },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    },
  );
  if (result.status !== 0) {
    fail(result.stderr.trim().slice(0, 500) || "Hermes rejected the health schedule");
  }
}

function response(
  action: "status" | "applied" | "unchanged",
  state: HealthSettingsState | null,
): Record<string, unknown> {
  return {
    ok: true,
    action,
    revision: state?.revision ?? 0,
    intervalMinutes: state?.intervalMinutes ?? defaultIntervalMinutes,
    allowedIntervals: [...allowedIntervals],
    appliedAt: state?.appliedAt ?? null,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (command !== "status" && command !== "apply") {
    fail("Usage: health-settings.ts <status|apply> [--minutes N --expected-revision N --actor-id ID]");
  }
  let minutes: number | null = null;
  let expectedRevision: number | null = null;
  let actorId: string | null = null;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--minutes") minutes = integer(value, "health interval");
    else if (flag === "--expected-revision") {
      expectedRevision = integer(value, "expected revision");
    } else if (flag === "--actor-id") {
      if (!value || !/^\d{1,40}$/u.test(value)) fail("Invalid actor ID");
      actorId = value;
    } else fail(`Unknown health settings argument: ${flag ?? "missing"}`);
  }
  const orchestratorHome = resolve(
    process.env.KURAMI_HOME ?? process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
  );
  const statePath = resolve(orchestratorHome, "state/health-settings.json");
  const previous = await readState(statePath);
  if (command === "status") {
    if (args.length > 0) fail("Health settings status accepts no arguments");
    process.stdout.write(`${JSON.stringify(response("status", previous))}\n`);
    return;
  }
  if (
    minutes === null ||
    !allowedIntervals.has(minutes) ||
    expectedRevision === null ||
    !actorId
  ) {
    fail("Health interval must be one of 5, 10, 12, 15, 20, 30, or 60 minutes");
  }
  const currentRevision = previous?.revision ?? 0;
  if (expectedRevision !== currentRevision) {
    fail(
      `Health settings changed since this panel opened: expected revision ${expectedRevision}, current revision ${currentRevision}`,
    );
  }
  if ((previous?.intervalMinutes ?? defaultIntervalMinutes) === minutes && previous) {
    process.stdout.write(`${JSON.stringify(response("unchanged", previous))}\n`);
    return;
  }
  editHealthSchedule(minutes, orchestratorHome);
  const next: HealthSettingsState = {
    version: 1,
    revision: currentRevision + 1,
    intervalMinutes: minutes,
    actorId,
    appliedAt: new Date().toISOString(),
  };
  await writeState(statePath, next);
  process.stdout.write(`${JSON.stringify(response("applied", next))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
