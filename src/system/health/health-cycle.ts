import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveKuramiHome } from "../../core/kurami-home.ts";
import { inspectRuntimeHealth, writeRuntimeHealthCounterState, type RuntimeHealthResult } from "../../orchestrator/health/runtime.ts";
import { evaluateHealthAlerts, readHealthAlertState, writeHealthAlertState, type HealthAlertState, type HealthAlertDecision } from "./server-health.ts";
import { healthHistory, readHealthHistory, writeHealthHistory, type HealthHistoryEntry } from "./health-history.ts";
import { writeHealthSurfaceSnapshot } from "./health-snapshot.ts";

process.umask(0o077);

export type HealthCycle = {version: 1; result: RuntimeHealthResult; history: HealthHistoryEntry[]; alerts: HealthAlertState};
export type HealthNotification = {nonceSeed: string; result: RuntimeHealthResult; decision: HealthAlertDecision};
const cyclePath = (home: string) => resolve(home, "state/system-health.db");

function openStore(home: string): DatabaseSync {
  mkdirSync(resolve(home, "state"), {recursive: true, mode: 0o700});
  const database = new DatabaseSync(cyclePath(home), {timeout: 1_000});
  database.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS health_cycle(singleton INTEGER PRIMARY KEY CHECK(singleton=1), payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_notifications(nonce TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL, fingerprint TEXT NOT NULL, kind TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_leases(kind TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
  return database;
}

function acquireLease(database: DatabaseSync, kind: "collection" | "delivery"): string {
  const owner = randomUUID();
  const now = Date.now();
  database.exec("BEGIN IMMEDIATE");
  try {
    const lease = database.prepare("SELECT expires_at FROM health_leases WHERE kind=?").get(kind) as {expires_at: number} | undefined;
    if (lease && lease.expires_at > now) throw new Error(`Health ${kind} is already running`);
    database.prepare("INSERT OR REPLACE INTO health_leases VALUES(?,?,?)").run(kind, owner, now + 5 * 60_000);
    database.exec("COMMIT");
    return owner;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function storedCycle(database: DatabaseSync): HealthCycle | null {
  const row = database.prepare("SELECT payload FROM health_cycle WHERE singleton=1").get() as {payload: string} | undefined;
  if (!row) return null;
  const cycle = JSON.parse(row.payload) as HealthCycle;
  if (cycle.version !== 1) throw new Error("Unsupported health cycle state");
  return cycle;
}

export function readHealthCycle(home: string): HealthCycle | null {
  if (!existsSync(cyclePath(home))) return null;
  const database = new DatabaseSync(cyclePath(home), {readOnly: true, timeout: 500});
  try {return storedCycle(database);} finally {database.close();}
}

export async function collectHealthCycle(home: string, inspect = inspectRuntimeHealth): Promise<HealthCycle> {
  const database = openStore(home);
  let owner: string | undefined;
  try {
    owner = acquireLease(database, "collection");
    const previous = storedCycle(database);
    const previousAlerts = previous?.alerts ?? await readHealthAlertState(resolve(home, "state/runtime-health-alert.json"));
    const previousHistory = previous?.history ?? await readHealthHistory(resolve(home, "state/system-health-history.json"));
    if (previous) await writeRuntimeHealthCounterState(resolve(home, "state/runtime-health-counters.json"), previous.result.oomKillCount);
    const result = await inspect(home);
    const decision = evaluateHealthAlerts(previousAlerts, result.alertIssues, new Date(result.checkedAt), result.serverHealthConfig.alert_reminder_minutes);
    const cycle: HealthCycle = {version: 1, result, history: healthHistory(previousHistory, result), alerts: decision.state};
    database.exec("BEGIN IMMEDIATE");
    const renewed = database.prepare("UPDATE health_leases SET expires_at=? WHERE kind='collection' AND owner=?").run(Date.now() + 5 * 60_000, owner);
    if (renewed.changes !== 1) throw new Error("Health collection lease was lost");
    if (decision.kind) {
      const fingerprint = Object.entries(decision.active).sort(([left], [right]) => left.localeCompare(right)).map(([key, issue]) => `${key}:${issue.severity}`).join("|");
      const nonceSeed = `${decision.kind}:${previousAlerts.lastNotifiedAt ?? "initial"}:${fingerprint}`;
      const nonce = createHash("sha256").update(nonceSeed).digest("hex");
      const notification: HealthNotification = {nonceSeed, result, decision};
      const pendingReminder = decision.kind === "reminder" && database.prepare("SELECT 1 FROM health_notifications WHERE fingerprint=? AND kind IN ('alert','reminder')").get(fingerprint);
      if (!pendingReminder) database.prepare("INSERT OR IGNORE INTO health_notifications VALUES(?,?,?,?,?)").run(nonce, JSON.stringify(notification), result.checkedAt, fingerprint, decision.kind);
    }
    database.prepare("INSERT OR REPLACE INTO health_cycle VALUES(1,?)").run(JSON.stringify(cycle));
    database.exec("COMMIT");
    // Compatibility files are projections; delivery never owns measurements or hysteresis.
    await Promise.all([
      writeHealthSurfaceSnapshot(resolve(home, "state/system-health-snapshot.json"), result),
      writeHealthHistory(resolve(home, "state/system-health-history.json"), cycle.history),
      writeHealthAlertState(resolve(home, "state/runtime-health-alert.json"), cycle.alerts),
      writeRuntimeHealthCounterState(resolve(home, "state/runtime-health-counters.json"), result.oomKillCount),
    ]);
    return cycle;
  } catch (error) {
    try {database.exec("ROLLBACK");} catch {}
    throw error;
  } finally {
    if (owner) database.prepare("DELETE FROM health_leases WHERE kind='collection' AND owner=?").run(owner);
    database.close();
  }
}

export async function deliverHealthNotifications(home: string, send: (notification: HealthNotification) => Promise<string>): Promise<{delivered: number; pending: number}> {
  const database = openStore(home);
  let owner: string | undefined;
  try {
    owner = acquireLease(database, "delivery");
    const notifications = database.prepare("SELECT nonce,payload FROM health_notifications ORDER BY created_at,rowid LIMIT 20").all() as {nonce: string; payload: string}[];
    let delivered = 0;
    for (const row of notifications) {
      const renewed = database.prepare("UPDATE health_leases SET expires_at=? WHERE kind='delivery' AND owner=?").run(Date.now() + 5 * 60_000, owner);
      if (renewed.changes !== 1) throw new Error("Health delivery lease was lost");
      await send(JSON.parse(row.payload) as HealthNotification);
      database.prepare("DELETE FROM health_notifications WHERE nonce=?").run(row.nonce);
      delivered += 1;
    }
    const pending = (database.prepare("SELECT count(*) n FROM health_notifications").get() as {n: number}).n;
    return {delivered, pending};
  } finally {
    try {database.exec("ROLLBACK");} catch {}
    if (owner) database.prepare("DELETE FROM health_leases WHERE kind='delivery' AND owner=?").run(owner);
    database.close();
  }
}

if (import.meta.main) {
  collectHealthCycle(resolveKuramiHome(resolve(import.meta.dirname, "../../../.."))).then(cycle => {
    process.stdout.write(`${JSON.stringify({ok: cycle.result.ok, checkedAt: cycle.result.checkedAt, history: cycle.history.length})}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ok: false, error: error instanceof Error ? error.message : String(error)})}\n`);
    process.exitCode = 1;
  });
}
