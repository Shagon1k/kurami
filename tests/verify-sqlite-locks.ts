// The orchestrator database helper: pragmas set once; a transaction that holds the lock past the threshold
// and a writer whose lock wait fails are both logged with the process and the code site; fast transactions
// leave no trace.
import assert from "node:assert/strict";
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
  console.log(JSON.stringify({ ok: true, sqliteLocks: "pragmas, slow transaction, failed wait, quiet fast path" }));
} finally { rmSync(home, { recursive: true, force: true }); }
