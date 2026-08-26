import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResourceGuardAnalysis } from "../src/resource-guard.ts";
import type { RuntimeHealthResult } from "../src/runtime-health.ts";
import {
  defaultServerHealthConfig,
  emptyHealthAlertState,
  type HealthAlertDecision,
} from "../src/server-health.ts";
import {
  reconcileSystemHealthCard,
  sendSystemHealthAlert,
  systemHealthAlertCard,
  systemHealthCard,
} from "../src/system-health-discord.ts";

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
  alertIssues: [],
  problems: [],
};

const card = systemHealthCard(result);
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
assert(serializedCard.includes("Runtime") && serializedCard.includes("12 running"));
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
    cronWrapperSuppressed: true,
  })}\n`,
);
