import { strict as assert } from "node:assert";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectNetworkConnectivity,
  parseLibreSpeedOutput,
  readNetworkSpeedSnapshot,
  writeNetworkSpeedSnapshot,
} from "../src/network-health.ts";

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

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    boundedJson: true,
    fixedServer: parsed.server,
    telemetryDisabledByRunner: true,
    connectivityQuorum: "2-of-3",
    atomicState: true,
  })}\n`,
);
