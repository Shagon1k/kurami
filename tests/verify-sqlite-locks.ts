// The orchestrator database helper: pragmas set once; a transaction that holds the lock past the threshold
// and a writer whose lock wait fails are both logged with the process and the code site; fast transactions
// leave no trace.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { on, once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockLogPath, openOrchestratorDatabase, type LockEvent } from "../src/orchestrator/state/database.ts";

const home = mkdtempSync(join(tmpdir(), "kurami-sqlite-locks-")), path = join(home, "state/orchestrator.db");
const events = (): LockEvent[] => existsSync(lockLogPath(path)) ? readFileSync(lockLogPath(path), "utf8").trim().split("\n").map(line => JSON.parse(line) as LockEvent) : [];
const hold = (ms: number) => { const until = Date.now() + ms; while (Date.now() < until); };
try {
  mkdirSync(join(home, "state"));
  const first = openOrchestratorDatabase(path);
  first.exec("PRAGMA journal_mode=WAL; CREATE TABLE runs(id INTEGER PRIMARY KEY)");
  assert.equal((first.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys, 1);
  assert.equal((first.prepare("PRAGMA busy_timeout").get() as { timeout: number }).timeout, 5000);

  first.exec("BEGIN IMMEDIATE"); first.exec("INSERT INTO runs DEFAULT VALUES"); first.exec("COMMIT");
  assert.deepEqual(events(), [], "a fast transaction is not logged");

  first.exec("BEGIN IMMEDIATE");
  const second = openOrchestratorDatabase(path, { timeoutMs: 50 });
  assert.throws(() => second.exec("BEGIN IMMEDIATE"), /database is locked/);
  hold(1_100);
  first.exec("COMMIT");
  const [failed, slow] = events();
  assert.equal(failed?.kind, "lock_wait_failed"); assert.ok(failed!.ms >= 40);
  assert.match(failed!.site ?? "", /tests\/verify-sqlite-locks\.ts:\d+/, "the site is the code that began the transaction");
  assert.equal(slow?.kind, "slow_transaction"); assert.ok(slow!.ms >= 1_000);
  assert.equal(slow!.process, "verify-sqlite-locks.ts");
  second.exec("BEGIN IMMEDIATE"); second.exec("ROLLBACK");
  first.close(); second.close();
  await verifyProtocolContention();
  console.log(JSON.stringify({ ok: true, sqliteLocks: "pragmas, slow transaction, failed wait, quiet fast path, multiprocess protocol cancellation wait and bounded refusal" }));
} finally { rmSync(home, { recursive: true, force: true }); }

async function verifyProtocolContention(): Promise<void> {
  const writer = fork(join(import.meta.dirname, "fixtures/protocol-lock-writer.ts"), [],
    { execPath: process.execPath, execArgv: [], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const exited = once(writer, "exit");
  const messages = on(writer, "message", { signal: AbortSignal.timeout(10_000) });
  const next = async (kind: string) => {
    const { value } = await messages.next();
    const message = value![0] as { kind: string; root: string; dbPath: string; timeout: number;
      foreignKeys: number; ok: boolean; ms: number; error: string; errcode: number; stopRequested: string };
    assert.equal(message.kind, kind);
    return message;
  };
  let holder: DatabaseSync | undefined;
  let root: string | undefined;
  try {
    const ready = await next("ready");
    root = ready.root;
    assert.equal(ready.timeout, 5000, "protocol fixtures must use the runtime busy timeout");
    assert.equal(ready.foreignKeys, 1);
    holder = openOrchestratorDatabase(ready.dbPath);
    holder.exec("BEGIN IMMEDIATE");

    // Reproduce the old opener's immediate SQLITE_BUSY against an acknowledged lock,
    // not a probabilistic overlap with a running Codex worker.
    const raw = new DatabaseSync(ready.dbPath);
    try {
      assert.equal(raw.prepare("PRAGMA busy_timeout").get()?.timeout, 0);
      assert.throws(() => raw.prepare("UPDATE run_codex_tasks SET stop_requested='cancel'").run(), /database is locked/);
    } finally { raw.close(); }

    writer.send({});
    await next("attempting");
    let finished = false;
    const waiting = next("result").then(result => { finished = true; return result; });
    // Only the parent can release the lock: the writer must remain pending, not fail
    // eagerly. This observation window is not a retry or a narrow duration assertion.
    await delay(100);
    const wasWaiting = !finished;
    holder.exec("COMMIT");
    const success = await waiting;
    assert.equal(wasWaiting, true, "the protocol write must wait while another process owns the lock");
    assert.equal(success.ok, true, success.error);
    assert.equal(success.stopRequested, "cancel");

    holder.exec("BEGIN IMMEDIATE");
    writer.send({ timeoutMs: 50 });
    await next("attempting");
    const refused = await next("result");
    assert.equal(refused.ok, false, "a lock held beyond the configured bound must be refused");
    assert.equal(refused.errcode, 5, "SQLITE_BUSY");
    assert.match(refused.error, /database is locked/);
    assert.ok(refused.ms >= 40 && refused.ms < 2_000, `bounded 50ms wait: ${refused.ms}ms`);
    holder.exec("ROLLBACK");
    console.log(JSON.stringify({ ok: true, protocolLockContention: true, rawTimeoutMs: 0,
      fixtureTimeoutMs: ready.timeout, waitedMs: success.ms, refusedMs: refused.ms }));
  } finally {
    holder?.close();
    await messages.return?.();
    if (writer.connected) writer.disconnect();
    await exited;
    if (root) rmSync(root, { recursive: true, force: true });
  }
}
