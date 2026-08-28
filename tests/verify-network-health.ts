import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  inspectNetworkConnectivity,
  parseLibreSpeedOutput,
  readNetworkSpeedSnapshot,
  writeNetworkSpeedSnapshot,
} from "../src/system/network/network-health.ts";

const parsed = parseLibreSpeedOutput(`transport note
[{"timestamp":"2026-08-26T11:12:53.543Z","server":{"name":"London, England (Clouvider)"},"bytes_sent":12779520,"bytes_received":180600242,"ping":4.51,"jitter":0.62,"upload":85.12,"download":1202.92,"share":""}]
`);
assert.equal(parsed.downloadMbps, 1202.92);
assert.equal(parsed.uploadMbps, 85.12);
assert.equal(parsed.server, "London, England (Clouvider)");

let calls = 0;
const connectivity = await inspectNetworkConnectivity((async () => {
  calls += 1;
  if (calls === 3) throw new Error("synthetic target failure");
  return new Response(null, { status: 204 });
}) as typeof fetch);
assert.equal(connectivity.status, "online");
assert.equal(connectivity.successfulTargets, 2);
assert.equal(connectivity.totalTargets, 3);
assert(connectivity.latencyMs !== null);

const root = await mkdtemp(join(tmpdir(), "kurami-network-health-"));
const statePath = join(root, "network-speed.json");
await writeNetworkSpeedSnapshot(statePath, parsed);
assert.deepEqual(await readNetworkSpeedSnapshot(statePath), parsed);

const fakeLibreSpeed = join(root, "librespeed-cli");
const argumentLog = join(root, "librespeed-args.log");
await writeFile(
  fakeLibreSpeed,
  `#!/bin/sh
printf '%s\\n' "$@" > "$NETWORK_TEST_LOG"
printf '%s\\n' '[{"timestamp":"2026-08-26T11:12:53.543Z","server":{"name":"London, England (Clouvider)"},"bytes_sent":12779520,"bytes_received":180600242,"ping":4.51,"jitter":0.62,"upload":85.12,"download":1202.92}]'
`,
  { mode: 0o700 },
);
const cliEnvironment = {
  ...process.env,
  KURAMI_HOME: root,
  LIBRESPEED_BIN: fakeLibreSpeed,
  NETWORK_TEST_LOG: argumentLog,
};
const canonicalCli = resolve(
  import.meta.dirname,
  "../src/system/network/network-health.ts",
);
const canonicalResult = JSON.parse(
  execFileSync(process.execPath, [canonicalCli], {
    env: cliEnvironment,
    encoding: "utf8",
  }),
) as Record<string, unknown>;
const argumentsUsed = await readFile(argumentLog, "utf8");
assert(argumentsUsed.includes("--telemetry-level\ndisabled\n"));
assert(argumentsUsed.includes("--duration\n1\n"));

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    boundedJson: true,
    fixedServer: parsed.server,
    telemetryDisabledByRunner: true,
    connectivityQuorum: "2-of-3",
    atomicState: true,
    canonicalCli: true,
  })}\n`,
);
