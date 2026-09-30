import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collectHealthCycle, deliverHealthNotifications, readHealthCycle, type HealthNotification } from "../src/system/health/health-cycle.ts";
import { readHealthStatus } from "../src/system/health/health-read-model.ts";
import { readHealthHistory } from "../src/system/health/health-history.ts";
import { emptyHealthAlertState } from "../src/system/health/server-health.ts";
import { runSystemHealthDiscordCli } from "../src/system/health/system-health-discord.ts";
import { collectHubOperations } from "../src/hub/operations.ts";
import { healthResult } from "./fixtures/health-result.ts";

const home = await mkdtemp(join(tmpdir(), "kurami-health-cycle-"));
const environment = {KURAMI_HOME: process.env.KURAMI_HOME, HERMES_HOME: process.env.HERMES_HOME, DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN};
const issue = {key: "server:cpu", severity: "critical" as const, message: "CPU is 98% used", requiredChecks: 2};
let result = healthResult("2026-09-30T10:00:00Z");
const inspect = async () => structuredClone(result);
const pending = () => {
  const database = new DatabaseSync(join(home, "state/system-health.db"), {readOnly: true});
  try {return (database.prepare("SELECT count(*) n FROM health_notifications").get() as {n: number}).n;} finally {database.close();}
};
try {
  await mkdir(join(home, "state"));
  await mkdir(join(home, "config"));
  await writeFile(join(home, "config/orchestrator.yaml"), "version: 1\ndiscord: {health_channel_id: '123456', alerts_channel_id: '234567'}\n");
  await writeFile(join(home, "state/runtime-health-alert.json"), JSON.stringify({...emptyHealthAlertState(), streaks: {[issue.key]: {severity: "critical", count: 1}}}));
  result.alertIssues = [issue]; result.ok = false; result.oomKillCount = 4;
  process.env.KURAMI_HOME = home; process.env.HERMES_HOME = join(home, "missing-hermes");
  delete process.env.DISCORD_BOT_TOKEN;
  await assert.rejects(() => runSystemHealthDiscordCli(["--run"], root => collectHealthCycle(root, inspect)), /ENOENT/);
  assert.equal(readHealthCycle(home)?.alerts.active[issue.key]?.severity, "critical", "migration preserves the existing hysteresis streak; missing Discord credentials cannot prevent collection");
  assert.equal(pending(), 1);
  assert.equal((await stat(join(home, "state/system-health.db"))).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(join(home, "state/runtime-health-counters.json"), "utf8")).oomKillCount, 4);
  assert.equal((await readHealthHistory(join(home, "state/system-health-history.json"))).length, 1);
  let attempted: HealthNotification | undefined;
  await assert.rejects(() => deliverHealthNotifications(home, async notification => {attempted = notification; throw new Error("Discord offline");}), /Discord offline/);
  assert.equal(pending(), 1, "failed delivery retains the original notification");
  await writeFile(join(home, "state/system-health-snapshot.json"), "{}");
  await writeFile(join(home, "state/runtime-health-alert.json"), JSON.stringify({active: {}}));
  assert.equal(readHealthStatus(home).health?.checkedAt, result.checkedAt, "canonical cycle survives a missing compatibility projection");
  assert.equal(readHealthStatus(home).active[issue.key]?.severity, "critical");
  result.checkedAt = "2026-09-30T10:20:00Z"; result.server.cpuUsedPercent = 99;
  await collectHealthCycle(home, inspect);
  const hub = collectHubOperations(home, join(home, "codex"), join(home, "hermes"), new Date(result.checkedAt), {available: true, projects: {}, runs: []});
  assert.equal(hub.health?.server.cpuUsedPercent, 99, "Hub receives fresh measurements despite a pending failed notification");
  assert(hub.alerts.some(alert => alert.id === issue.key));
  assert.equal(pending(), 1);
  result.checkedAt = "2026-09-30T15:20:00Z"; await collectHealthCycle(home, inspect);
  assert.equal(pending(), 1, "pending alerts suppress duplicate reminder backlog");
  result = healthResult("2026-09-30T15:40:00Z"); await collectHealthCycle(home, inspect);
  assert.equal(pending(), 2, "recovery is retained after an undelivered alert");
  const delivered: HealthNotification[] = [];
  const delivery = await deliverHealthNotifications(home, async notification => {delivered.push(notification); return "123456";});
  assert.deepEqual(delivery, {delivered: 2, pending: 0});
  assert.deepEqual(delivered.map(notification => notification.decision.kind), ["alert", "recovery"]);
  assert.equal(delivered[0].nonceSeed, attempted?.nonceSeed, "retry reuses the nonce and original measurement");
  assert.equal(delivered[0].result.checkedAt, "2026-09-30T10:00:00Z");
  assert.equal(delivered[1].result.checkedAt, result.checkedAt);
  assert.equal(readHealthStatus(home).health?.ok, true);

  result.checkedAt = "2026-09-30T16:00:00Z"; result.alertIssues = [{...issue, requiredChecks: 1}];
  await collectHealthCycle(home, inspect);
  let release!: () => void;
  let started!: () => void;
  const sending = new Promise<void>(resolve => {started = resolve;});
  const gate = new Promise<void>(resolve => {release = resolve;});
  const worker = deliverHealthNotifications(home, async () => {started(); await gate; return "234567";});
  await sending;
  try {
    await assert.rejects(() => deliverHealthNotifications(home, async () => "345678"), /already running/);
    result.checkedAt = "2026-09-30T16:20:00Z"; result.server.cpuUsedPercent = 97;
    await collectHealthCycle(home, inspect);
    assert.equal(readHealthStatus(home).health?.server.cpuUsedPercent, 97, "a delivery lease does not lock collection");
  } finally {release(); await worker;}
  assert.equal(pending(), 0);
  result.alertIssues = [];
  result.checkedAt = "2026-09-30T16:40:00Z";
  let releaseInspection!: () => void;
  let inspectionStarted!: () => void;
  const inspecting = new Promise<void>(resolve => {inspectionStarted = resolve;});
  const inspectionGate = new Promise<void>(resolve => {releaseInspection = resolve;});
  const collecting = collectHealthCycle(home, async () => {inspectionStarted(); await inspectionGate; return structuredClone(result);});
  await inspecting;
  try {
    await assert.rejects(() => collectHealthCycle(home, inspect), /collection is already running/);
    assert.deepEqual(await deliverHealthNotifications(home, async () => "456789"), {delivered: 0, pending: 0}, "a slow CPU/network inspection does not hold the delivery database lock");
  } finally {releaseInspection(); await collecting;}
  const checkedBeforeFailure = readHealthCycle(home)?.result.checkedAt;
  await assert.rejects(() => collectHealthCycle(home, async () => {throw new Error("Inspection failed");}), /Inspection failed/);
  assert.equal(readHealthCycle(home)?.result.checkedAt, checkedBeforeFailure, "failed inspection preserves the last successful cycle");
  for (let index = 0; index < 12; index++) {
    result.checkedAt = new Date(Date.parse("2026-09-30T17:00:00Z") + index * 60_000).toISOString();
    await collectHealthCycle(home, inspect);
  }
  assert.equal(readHealthCycle(home)?.history.length, 10);
  assert.equal((await readHealthHistory(join(home, "state/system-health-history.json"))).length, 10);
  await rm(join(home, "state/system-health-snapshot.json"));
  await mkdir(join(home, "state/system-health-snapshot.json"));
  result.checkedAt = "2026-09-30T18:00:00Z";
  await assert.rejects(() => collectHealthCycle(home, inspect));
  assert.equal(readHealthStatus(home).health?.checkedAt, result.checkedAt, "a failed compatibility-file write cannot discard a committed cycle");
} finally {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(home, {recursive: true, force: true});
}
console.log("Health cycle: independent collection, legacy migration, canonical projections, durable retries, ordered recovery and concurrent delivery verified");
