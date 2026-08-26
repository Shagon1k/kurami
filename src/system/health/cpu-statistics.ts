import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type CpuStatisticsConfig = {
  sample_interval_seconds: number;
  rolling_window_minutes: number;
};

export type CpuStatisticEntry = {
  checkedAt: string;
  cpuPercent: number;
};

export type CpuStatisticsState = {
  version: 1;
  entries: CpuStatisticEntry[];
};

export type CpuRollingStatistics = {
  windowMinutes: number;
  sampleCount: number;
  averagePercent: number | null;
  peakPercent: number | null;
};

export const defaultCpuStatisticsConfig: CpuStatisticsConfig = {
  sample_interval_seconds: 15,
  rolling_window_minutes: 8,
};

const maximumEntries = 1_440;

function rounded(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function assertInteger(name: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

export function resolveCpuStatisticsConfig(
  input: Partial<CpuStatisticsConfig> | undefined,
): CpuStatisticsConfig {
  const config = { ...defaultCpuStatisticsConfig, ...input };
  assertInteger("cpu_statistics.sample_interval_seconds", config.sample_interval_seconds, 5, 60);
  assertInteger("cpu_statistics.rolling_window_minutes", config.rolling_window_minutes, 1, 60);
  return config;
}

function validEntry(value: unknown): value is CpuStatisticEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CpuStatisticEntry>;
  return (
    typeof candidate.checkedAt === "string" &&
    Number.isFinite(Date.parse(candidate.checkedAt)) &&
    typeof candidate.cpuPercent === "number" &&
    Number.isFinite(candidate.cpuPercent) &&
    candidate.cpuPercent >= 0 &&
    candidate.cpuPercent <= 100
  );
}

export async function readCpuStatistics(path: string): Promise<CpuStatisticEntry[]> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<CpuStatisticsState>;
    if (value.version !== 1 || !Array.isArray(value.entries)) return [];
    return value.entries.filter(validEntry).slice(-maximumEntries);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function recordCpuStatistic(
  path: string,
  entry: CpuStatisticEntry,
): Promise<CpuStatisticEntry[]> {
  if (!validEntry(entry)) throw new Error("Invalid CPU statistic entry");
  const previous = await readCpuStatistics(path);
  const entries = [...previous.filter((item) => item.checkedAt !== entry.checkedAt), entry]
    .sort((left, right) => Date.parse(left.checkedAt) - Date.parse(right.checkedAt))
    .slice(-maximumEntries);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, entries } satisfies CpuStatisticsState)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
  return entries;
}

export function calculateCpuRollingStatistics(
  entries: CpuStatisticEntry[],
  windowMinutes: number,
  now = new Date(),
): CpuRollingStatistics {
  assertInteger("cpu_statistics.rolling_window_minutes", windowMinutes, 1, 60);
  const earliest = now.getTime() - windowMinutes * 60_000;
  const selected = entries.filter((entry) => Date.parse(entry.checkedAt) >= earliest);
  if (selected.length === 0) {
    return { windowMinutes, sampleCount: 0, averagePercent: null, peakPercent: null };
  }
  const values = selected.map((entry) => entry.cpuPercent);
  return {
    windowMinutes,
    sampleCount: values.length,
    averagePercent: rounded(values.reduce((sum, value) => sum + value, 0) / values.length),
    peakPercent: rounded(Math.max(...values)),
  };
}
