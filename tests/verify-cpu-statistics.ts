import { strict as assert } from "node:assert";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  calculateCpuRollingStatistics,
  readCpuStatistics,
  recordCpuStatistic,
  resolveCpuStatisticsConfig,
} from "../src/system/health/cpu-statistics.ts";

const config = resolveCpuStatisticsConfig({
  sample_interval_seconds: 15,
  rolling_window_minutes: 8,
});
assert.deepEqual(config, { sample_interval_seconds: 15, rolling_window_minutes: 8 });
assert.throws(
  () => resolveCpuStatisticsConfig({ rolling_window_minutes: 0 }),
  /rolling_window_minutes/,
);

const now = new Date("2026-08-26T18:00:00.000Z");
const statistics = calculateCpuRollingStatistics(
  [
    { checkedAt: "2026-08-26T17:51:59.000Z", cpuPercent: 99 },
    { checkedAt: "2026-08-26T17:52:00.000Z", cpuPercent: 4 },
    { checkedAt: "2026-08-26T17:56:00.000Z", cpuPercent: 8 },
    { checkedAt: "2026-08-26T17:59:45.000Z", cpuPercent: 12 },
  ],
  8,
  now,
);
assert.deepEqual(statistics, {
  windowMinutes: 8,
  sampleCount: 3,
  averagePercent: 8,
  peakPercent: 12,
});
assert.deepEqual(calculateCpuRollingStatistics([], 8, now), {
  windowMinutes: 8,
  sampleCount: 0,
  averagePercent: null,
  peakPercent: null,
});

const directory = await mkdtemp(join(tmpdir(), "kurami-cpu-statistics-"));
const path = join(directory, "cpu-statistics.json");
await recordCpuStatistic(path, { checkedAt: "2026-08-26T17:59:45.000Z", cpuPercent: 12 });
await recordCpuStatistic(path, { checkedAt: "2026-08-26T17:56:00.000Z", cpuPercent: 8 });
assert.deepEqual(await readCpuStatistics(path), [
  { checkedAt: "2026-08-26T17:56:00.000Z", cpuPercent: 8 },
  { checkedAt: "2026-08-26T17:59:45.000Z", cpuPercent: 12 },
]);

process.stdout.write(`${JSON.stringify({ ok: true, rollingWindowMinutes: 8, boundedStorage: true })}\n`);
