import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveKuramiHome } from "../../core/kurami-home.ts";
import { parse } from "yaml";
import { calculateCpuUsedPercent, parseCpuSample } from "./server-health.ts";
import {
  recordCpuStatistic,
  resolveCpuStatisticsConfig,
  type CpuStatisticsConfig,
} from "./cpu-statistics.ts";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function loadConfig(kuramiHome: string): Promise<CpuStatisticsConfig> {
  const raw = await readFile(resolve(kuramiHome, "config/orchestrator.yaml"), "utf8");
  const config = parse(raw) as { version?: number; cpu_statistics?: Partial<CpuStatisticsConfig> };
  if (config.version !== 1) throw new Error("Unsupported configuration version");
  return resolveCpuStatisticsConfig(config.cpu_statistics);
}

export async function sampleCpuUsedPercent(intervalSeconds: number): Promise<number> {
  const before = await readFile("/proc/stat", "utf8");
  await delay(intervalSeconds * 1_000);
  const after = await readFile("/proc/stat", "utf8");
  return calculateCpuUsedPercent(parseCpuSample(before), parseCpuSample(after));
}

export async function sampleAndRecordCpuStatistics(
  kuramiHome: string,
): Promise<{ cpuPercent: number; config: CpuStatisticsConfig; samplesStored: number }> {
  const config = await loadConfig(kuramiHome);
  const cpuPercent = await sampleCpuUsedPercent(config.sample_interval_seconds);
  const entries = await recordCpuStatistic(
    resolve(kuramiHome, "state/cpu-statistics.json"),
    { checkedAt: new Date().toISOString(), cpuPercent },
  );
  return { cpuPercent, config, samplesStored: entries.length };
}

export async function runCpuStatisticsSamplerCli(): Promise<void> {
  const mode = process.argv.slice(2).join(" ");
  if (mode !== "--once" && mode !== "--daemon") {
    throw new Error("Usage: cpu-statistics-sampler.ts [--once|--daemon]");
  }
  const kuramiHome = resolveKuramiHome(
    resolve(import.meta.dirname, "../../../.."),
  );
  do {
    const result = await sampleAndRecordCpuStatistics(kuramiHome);
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } while (mode === "--daemon");
}

if (import.meta.main) {
  runCpuStatisticsSamplerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
