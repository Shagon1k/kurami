import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RuntimeHealthResult } from "../../orchestrator/health/runtime.ts";

export type HealthHistoryEntry = {
  id: string;
  checkedAt: string;
  ok: boolean;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  networkStatus: "online" | "degraded" | "offline";
  networkLatencyMs: number | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  runningContainers: number;
  unhealthyContainers: number;
};

function validHistoryEntry(value: unknown): value is HealthHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<HealthHistoryEntry>;
  return typeof entry.id === "string" && /^\d{10,20}$/u.test(entry.id) &&
    typeof entry.checkedAt === "string" && Number.isFinite(Date.parse(entry.checkedAt)) &&
    typeof entry.ok === "boolean" &&
    [entry.cpuPercent, entry.memoryPercent, entry.diskPercent].every(number => typeof number === "number" && Number.isFinite(number)) &&
    ["online", "degraded", "offline"].includes(entry.networkStatus ?? "") &&
    [entry.networkLatencyMs, entry.downloadMbps, entry.uploadMbps].every(number => number === null || typeof number === "number" && Number.isFinite(number)) &&
    Number.isInteger(entry.runningContainers) && Number.isInteger(entry.unhealthyContainers);
}

export async function readHealthHistory(path: string): Promise<HealthHistoryEntry[]> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as {version?: number; entries?: unknown[]};
    if (value.version !== 1 || !Array.isArray(value.entries)) return [];
    return value.entries.filter(validHistoryEntry).slice(0, 10);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function healthHistory(previous: HealthHistoryEntry[], result: RuntimeHealthResult): HealthHistoryEntry[] {
  const entry: HealthHistoryEntry = {
    id: String(Date.parse(result.checkedAt)), checkedAt: result.checkedAt, ok: result.ok,
    cpuPercent: result.server.cpuUsedPercent, memoryPercent: result.server.memoryUsedPercent,
    diskPercent: result.resourceGuard.disk.usedPercent,
    networkStatus: result.networkConnectivity.status, networkLatencyMs: result.networkConnectivity.latencyMs,
    downloadMbps: result.networkSpeed?.downloadMbps ?? null, uploadMbps: result.networkSpeed?.uploadMbps ?? null,
    runningContainers: result.containerRuntime.running, unhealthyContainers: result.containerRuntime.unhealthy,
  };
  return [entry, ...previous.filter(item => item.id !== entry.id)].slice(0, 10);
}

export async function writeHealthHistory(path: string, entries: HealthHistoryEntry[]): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({version: 1, entries})}\n`, {mode: 0o600});
  await rename(temporary, path);
}

export async function recordHealthHistory(path: string, result: RuntimeHealthResult): Promise<HealthHistoryEntry[]> {
  const entries = healthHistory(await readHealthHistory(path), result);
  await writeHealthHistory(path, entries);
  return entries;
}
