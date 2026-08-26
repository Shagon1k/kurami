import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

process.umask(0o077);

export type NetworkConnectivitySnapshot = {
  status: "online" | "degraded" | "offline";
  successfulTargets: number;
  totalTargets: number;
  latencyMs: number | null;
};

export type NetworkSpeedSnapshot = {
  version: 1;
  checkedAt: string;
  server: string;
  pingMs: number;
  jitterMs: number;
  downloadMbps: number;
  uploadMbps: number;
  bytesReceived: number;
  bytesSent: number;
};

const connectivityTargets = [
  "https://www.cloudflare.com/cdn-cgi/trace",
  "https://www.google.com/generate_204",
  "https://github.com/",
] as const;

function rounded(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function fail(message: string): never {
  throw new Error(message);
}

export async function inspectNetworkConnectivity(
  fetcher: typeof fetch = fetch,
): Promise<NetworkConnectivitySnapshot> {
  const samples = await Promise.all(
    connectivityTargets.map(async (url) => {
      const started = performance.now();
      try {
        const response = await fetcher(url, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(5_000),
          headers: { "user-agent": "Kurami-System-Health/1.0" },
        });
        if (response.status >= 500) return null;
        await response.body?.cancel();
        return performance.now() - started;
      } catch {
        return null;
      }
    }),
  );
  const successful = samples
    .filter((sample): sample is number => sample !== null)
    .sort((left, right) => left - right);
  const middle = successful.length === 0
    ? null
    : successful[Math.floor(successful.length / 2)]!;
  return {
    status:
      successful.length >= 2
        ? "online"
        : successful.length === 1
          ? "degraded"
          : "offline",
    successfulTargets: successful.length,
    totalTargets: connectivityTargets.length,
    latencyMs: middle === null ? null : rounded(middle),
  };
}

export async function readNetworkSpeedSnapshot(
  path: string,
): Promise<NetworkSpeedSnapshot | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<NetworkSpeedSnapshot>;
    if (
      value.version === 1 &&
      typeof value.checkedAt === "string" &&
      Number.isFinite(Date.parse(value.checkedAt)) &&
      typeof value.server === "string" &&
      [
        value.pingMs,
        value.jitterMs,
        value.downloadMbps,
        value.uploadMbps,
        value.bytesReceived,
        value.bytesSent,
      ].every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0)
    ) {
      return value as NetworkSpeedSnapshot;
    }
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function parseLibreSpeedOutput(output: string): NetworkSpeedSnapshot {
  const line = output
    .split(/\r?\n/u)
    .reverse()
    .find((entry) => entry.trim().startsWith("["));
  if (!line) fail("LibreSpeed returned no JSON result");
  const values = JSON.parse(line) as Array<{
    timestamp?: unknown;
    server?: { name?: unknown };
    bytes_sent?: unknown;
    bytes_received?: unknown;
    ping?: unknown;
    jitter?: unknown;
    upload?: unknown;
    download?: unknown;
  }>;
  const value = values[0];
  if (!value) fail("LibreSpeed returned an empty result");
  const number = (input: unknown, name: string): number => {
    if (typeof input !== "number" || !Number.isFinite(input) || input < 0) {
      fail(`LibreSpeed returned invalid ${name}`);
    }
    return rounded(input, 2);
  };
  const checkedAt = String(value.timestamp ?? "");
  const server = String(value.server?.name ?? "").trim();
  if (!Number.isFinite(Date.parse(checkedAt)) || !server) {
    fail("LibreSpeed result has no timestamp or server");
  }
  return {
    version: 1,
    checkedAt,
    server: server.slice(0, 120),
    pingMs: number(value.ping, "ping"),
    jitterMs: number(value.jitter, "jitter"),
    downloadMbps: number(value.download, "download speed"),
    uploadMbps: number(value.upload, "upload speed"),
    bytesReceived: number(value.bytes_received, "received bytes"),
    bytesSent: number(value.bytes_sent, "sent bytes"),
  };
}

export async function writeNetworkSpeedSnapshot(
  path: string,
  snapshot: NetworkSpeedSnapshot,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export function runLibreSpeed(binary: string): NetworkSpeedSnapshot {
  const result = spawnSync(binary, [
    "--json",
    "--server", "49",
    "--secure",
    "--telemetry-level", "disabled",
    "--no-icmp",
    "--concurrent", "1",
    "--duration", "1",
    "--chunks", "2",
    "--upload-size", "64",
    "--timeout", "10",
  ], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  if (result.status !== 0) {
    fail(result.stderr.trim().slice(0, 500) || "LibreSpeed failed");
  }
  return parseLibreSpeedOutput(`${result.stderr}\n${result.stdout}`);
}

export async function runNetworkHealthCli(): Promise<void> {
  if (process.argv.length !== 2) fail("Usage: network-health.ts");
  const orchestratorHome = resolve(
    process.env.KURAMI_HOME ??
      process.env.ORCHESTRATOR_HOME ??
      resolve(import.meta.dirname, "../../../.."),
  );
  const binary = resolve(
    process.env.LIBRESPEED_BIN ?? resolve(orchestratorHome, "runtime/tools/librespeed-cli"),
  );
  const snapshot = runLibreSpeed(binary);
  const statePath = resolve(orchestratorHome, "state/network-speed.json");
  await writeNetworkSpeedSnapshot(statePath, snapshot);
  process.stdout.write(`${JSON.stringify({ ok: true, ...snapshot })}\n`);
}

if (import.meta.main) {
  runNetworkHealthCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
