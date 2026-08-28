import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResourceGuardAnalysis } from "../src/orchestrator/resources/guard.ts";
import type { RuntimeHealthResult } from "../src/orchestrator/health/runtime.ts";
import {
  defaultServerHealthConfig,
  emptyHealthAlertState,
  type HealthAlertDecision,
} from "../src/system/health/server-health.ts";
import {
  cleanupHealthChannel,
  reconcileSystemHealthCard,
  sendSystemHealthAlert,
  systemHealthAlertCard,
  systemHealthCard,
} from "../src/system/health/system-health-discord.ts";
import * as legacyDiscordUi from "../src/discord/ui.ts";
import * as canonicalDiscordUi from "../src/discord/ui.ts";
import * as canonicalHealthDiscord from "../src/system/health/system-health-discord.ts";

assert.equal(legacyDiscordUi.componentMessage, canonicalDiscordUi.componentMessage);
assert.equal(legacyDiscordUi.container, canonicalDiscordUi.container);
assert.equal(legacyDiscordUi.compactTable, canonicalDiscordUi.compactTable);
assert.equal(systemHealthCard, canonicalHealthDiscord.systemHealthCard);
assert.equal(sendSystemHealthAlert, canonicalHealthDiscord.sendSystemHealthAlert);

const resourceGuard: ResourceGuardAnalysis = {
  disk: { usedPercent: 18, availableGiB: 158.1, state: "normal" },
  worktrees: {
    global: 0,
    byProject: {},
    maxGlobal: 6,
    maxPerProject: 4,
  },
  observations: [],
  quarantines: { observed: 0, quarantined: 0, reviewDue: 0 },
  admissionBlocked: false,
  blockReasons: [],
  warnings: [],
};

const result: RuntimeHealthResult = {
  ok: true,
  checkedAt: "2026-08-26T09:49:49.121Z",
  databaseIntegrity: "ok",
  dockerRootless: true,
  containerRuntime: { total: 12, running: 12, unhealthy: 0 },
  topConsumers: {
    cpu: { name: "hermes", cpuPercent: 87.4, memoryPercent: 2.1, rssMiB: 492 },
    memory: { name: "node", cpuPercent: 4.2, memoryPercent: 8.4, rssMiB: 1970 },
    containerCpu: null,
    containerMemory: null,
  },
  oomKillCount: 0,
  oomKillsSincePreviousCheck: 0,
  networkConnectivity: {
    status: "online",
    successfulTargets: 3,
    totalTargets: 3,
    latencyMs: 18.4,
  },
  networkSpeed: {
    version: 1,
    checkedAt: "2026-08-26T08:00:00.000Z",
    server: "London, England (Clouvider)",
    pingMs: 5.4,
    jitterMs: 0.6,
    downloadMbps: 1202.9,
    uploadMbps: 85.1,
    bytesReceived: 180600242,
    bytesSent: 12779520,
  },
  activePreviewLeases: 0,
  backupAgeHours: 30.6,
  backupMaxAgeHours: 84,
  backupFresh: true,
  preview: {
    orphanDockerProjects: [],
    missingDockerProjects: [],
    missingStaticArtifacts: [],
    failedLeases: [],
    terminalRunLeases: [],
    mappingMismatches: [],
    expiredLeases: [],
    orphanRuntimeDirectories: [],
  },
  resourceGuard,
  server: {
    hostname: "shagserv",
    cpuUsedPercent: 3.4,
    cpuCores: 8,
    loadAverage: [0.47, 0.59, 0.6],
    memoryUsedPercent: 24.7,
    memoryUsedGiB: 5.7,
    memoryTotalGiB: 22.9,
    memoryAvailableGiB: 17.3,
    swapTotalGiB: 0,
    swapUsedGiB: 0,
    uptimeSeconds: 16 * 86_400,
  },
  serverHealthConfig: defaultServerHealthConfig,
  cpuStatistics: { windowMinutes: 8, sampleCount: 32, averagePercent: 6.5, peakPercent: 21.8 },
  alertIssues: [],
  problems: [],
};

const card = systemHealthCard(result, [
  {
    id: String(Date.parse(result.checkedAt)),
    checkedAt: result.checkedAt,
    ok: true,
    cpuPercent: result.server.cpuUsedPercent,
    memoryPercent: result.server.memoryUsedPercent,
    diskPercent: result.resourceGuard.disk.usedPercent,
    networkStatus: "online",
    networkLatencyMs: 18.4,
    downloadMbps: 1202.9,
    uploadMbps: 85.1,
    runningContainers: 12,
    unhealthyContainers: 0,
  },
]);
const serializedCard = JSON.stringify(card);
assert.equal(card.flags, 32768, "Health card must use Discord Components V2");
assert(!Object.hasOwn(card, "content"), "Health card must not fall back to plain content");
assert(!Object.hasOwn(card, "embeds"), "Health card must not mix legacy embeds with Components V2");
assert(serializedCard.includes("Kurami System Health"), "Health card title is missing");
assert(serializedCard.includes("🖥️ System"), "System section is missing");
assert(
  serializedCard.includes("🧭 Project Orchestrator"),
  "Project Orchestrator section is missing",
);
assert(serializedCard.includes("Disk") && serializedCard.includes("158.1 GiB"));
assert(serializedCard.includes("State DB") && serializedCard.includes("Backup"));
assert(serializedCard.includes("Docker") && serializedCard.includes("12 up"));
assert(serializedCard.includes("Network") && serializedCard.includes("1203↓ / 85↑ Mbps"));
assert(serializedCard.includes("**CPU 3.4% (5s)**"));
assert(serializedCard.includes("avg 8m 6.5% · peak 21.8%"));
assert(serializedCard.includes("**State DB** · healthy"));
assert(!serializedCard.includes("```text"), "Primary health card must not use a mobile-hostile pseudo-table");
assert(serializedCard.includes("Recent health runs"));
assert(serializedCard.includes("kurami:health:history"));
assert(!serializedCard.includes("Cronjob Response"), "Cron wrapper leaked into card");
assert(!serializedCard.includes("To stop or manage this job"), "Cron footer leaked into card");

const decision: HealthAlertDecision = {
  kind: "alert",
  active: {
    "server:cpu": {
      severity: "critical",
      message: "CPU is 97% used (critical 95%)",
    },
  },
  state: {
    ...emptyHealthAlertState(),
    active: {
      "server:cpu": {
        severity: "critical",
        message: "CPU is 97% used (critical 95%)",
      },
    },
    lastNotifiedAt: "2026-08-26T09:49:49.121Z",
  },
};
const alertCard = systemHealthAlertCard(result, decision);
const serializedAlert = JSON.stringify(alertCard);
assert(serializedAlert.includes("Kurami System Health Alert"));
assert(serializedAlert.includes("Active checks"));
assert(serializedAlert.includes("Project Orchestrator"));
assert(serializedAlert.includes("Top consumers at alert time"));
assert(serializedAlert.includes("hermes") && serializedAlert.includes("node"));

const requests: Array<{
  method: string;
  url: string;
  body: Record<string, unknown>;
}> = [];
let nextMessageId = 9001;
const server = createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk: string) => {
    body += chunk;
  });
  request.on("end", () => {
    requests.push({
      method: request.method ?? "",
      url: request.url ?? "",
      body: body ? (JSON.parse(body) as Record<string, unknown>) : {},
    });
    if (
      request.method === "GET" &&
      request.url === "/channels/1538633991974817842/messages/9001"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "9001", flags: 32768 }));
      return;
    }
    if (request.method === "GET" && request.url === "/users/@me") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "1538492507128856596" }));
      return;
    }
    if (
      request.method === "GET" &&
      request.url?.startsWith("/channels/1538633991974817842/messages?limit=100")
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify([
        { id: "9001", author: { id: "1538492507128856596" } },
        { id: "8002", author: { id: "1538492507128856596" } },
        { id: "8001", author: { id: "424242424242424242" } },
      ]));
      return;
    }
    if (request.method === "DELETE") {
      response.writeHead(204);
      response.end();
      return;
    }
    const requestedId = request.url?.split("/").at(-1);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: request.method === "PATCH" ? requestedId : String(nextMessageId++),
        flags: 32768,
      }),
    );
  });
});
await new Promise<void>((resolveListen) =>
  server.listen(0, "127.0.0.1", resolveListen),
);
const address = server.address();
assert(address && typeof address === "object", "Fake Discord did not start");
const apiBase = `http://127.0.0.1:${address.port}`;
const stateRoot = await mkdtemp(join(tmpdir(), "kurami-health-discord-"));
const statePath = join(stateRoot, "health-surface.json");

try {
  const created = await reconcileSystemHealthCard({
    token: "test-token",
    channelId: "1538633991974817842",
    apiBase,
    result,
    statePath,
  });
  assert.deepEqual(created, { action: "created", messageId: "9001" });
  const edited = await reconcileSystemHealthCard({
    token: "test-token",
    channelId: "1538633991974817842",
    apiBase,
    result,
    statePath,
  });
  assert.deepEqual(edited, { action: "edited", messageId: "9001" });
  const alertMessageId = await sendSystemHealthAlert({
    token: "test-token",
    channelId: "1538633903726788758",
    apiBase,
    result,
    decision,
    nonceSeed: "critical-test",
  });
  assert.equal(alertMessageId, "9002");

  assert.equal(requests.length, 3);
  assert.equal(requests[0]?.method, "POST");
  assert.equal(
    requests[0]?.url,
    "/channels/1538633991974817842/messages",
  );
  assert.equal(requests[1]?.method, "PATCH");
  assert.equal(
    requests[1]?.url,
    "/channels/1538633991974817842/messages/9001",
  );
  assert.equal(requests[2]?.method, "POST");
  assert.equal(
    requests[2]?.url,
    "/channels/1538633903726788758/messages",
  );
  assert.equal(requests[0]?.body.flags, 32768);
  assert.equal(requests[0]?.body.enforce_nonce, true);
  assert(!Object.hasOwn(requests[0]?.body ?? {}, "content"));
  assert(!Object.hasOwn(requests[0]?.body ?? {}, "embeds"));

  const cleanup = await cleanupHealthChannel({
    token: "test-token",
    channelId: "1538633991974817842",
    apiBase,
    statePath,
  });
  assert.deepEqual(cleanup, {
    keptMessageId: "9001",
    scanned: 3,
    deleted: 1,
  });
  assert.equal(requests.filter((request) => request.method === "DELETE").length, 1);
} finally {
  await new Promise<void>((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose())),
  );
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    componentsV2: true,
    systemSection: true,
    projectOrchestratorSection: true,
    persistentHealthCard: true,
    directAlertCard: true,
    boundedHealthCleanup: true,
    cronWrapperSuppressed: true,
  })}\n`,
);
