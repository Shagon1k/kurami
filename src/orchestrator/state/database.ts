// One way to open the orchestrator database for writing. Every process (the controller, pollers, session
// and preview managers, Discord controls) shares state/orchestrator.db in WAL mode: readers never wait, but
// writers queue for one lock, and a writer that waits past the busy timeout fails with "database is locked".
// Each open site used to repeat the same pragmas; this helper sets them once and measures transactions:
// one that holds the lock for more than a second, or a wait that fails, is appended to
// logs/sqlite-locks.jsonl with the process and the code that began it. That log names the lock holders.
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { basename, dirname, resolve } from "node:path";

/** Writers wait this long for the lock before failing. */
export const BUSY_TIMEOUT_MS = 5_000;
/** A transaction holding the lock longer than this is logged. */
export const SLOW_TRANSACTION_MS = 1_000;
const LOG_LIMIT_BYTES = 4 * 1024 * 1024;

export type LockEvent = {
  ts: string; kind: "slow_transaction" | "lock_wait_failed"; ms: number;
  process: string; action: string | null; site: string | null; pid: number;
};

/** logs/ next to state/, where the other orchestrator logs live. */
export const lockLogPath = (databasePath: string): string => resolve(dirname(databasePath), "../logs/sqlite-locks.jsonl");

/** The first stack frame outside this file: the code that began the transaction. */
function callerSite(): string | null {
  const frames = (new Error().stack ?? "").split("\n").slice(1).map(line => line.trim());
  const frame = frames.find(line => !line.includes("/orchestrator/state/database.ts"));
  return frame?.replace(/^at /, "").replace(/^.*\/src\//, "src/").replace(/^.*\((.*\/)?src\//, "src/").replace(/\)$/, "").slice(0, 200) ?? null;
}

class OrchestratorDatabase extends DatabaseSync {
  private readonly logPath: string;
  private begunAt: number | null = null;
  private begunSite: string | null = null;
  constructor(path: string, options: { readOnly: boolean; timeoutMs: number }) {
    super(path, { readOnly: options.readOnly, timeout: options.timeoutMs });
    this.logPath = lockLogPath(path);
  }

  override exec(sql: string): void {
    const statement = sql.trimStart().slice(0, 16).toUpperCase();
    if (statement.startsWith("BEGIN")) {
      const started = Date.now(), site = callerSite();
      try { super.exec(sql); }
      catch (error) {
        if (/database is locked|SQLITE_BUSY/i.test(String((error as Error)?.message))) this.record("lock_wait_failed", Date.now() - started, site);
        throw error;
      }
      this.begunAt = Date.now(); this.begunSite = site;
      return;
    }
    super.exec(sql);
    if (this.begunAt !== null && (statement.startsWith("COMMIT") || statement.startsWith("ROLLBACK") || statement.startsWith("END"))) {
      const held = Date.now() - this.begunAt;
      if (held > SLOW_TRANSACTION_MS) this.record("slow_transaction", held, this.begunSite);
      this.begunAt = null; this.begunSite = null;
    }
  }

  private record(kind: LockEvent["kind"], ms: number, site: string | null): void {
    const event: LockEvent = {
      ts: new Date().toISOString(), kind, ms, process: basename(process.argv[1] ?? "node"),
      action: process.env.KURAMI_CONTROLLER_ACTION ?? null, site, pid: process.pid,
    };
    // Measurement must never break the write it measures.
    try {
      mkdirSync(dirname(this.logPath), { recursive: true, mode: 0o700 });
      try { if (statSync(this.logPath).size > LOG_LIMIT_BYTES) renameSync(this.logPath, `${this.logPath}.1`); } catch {}
      appendFileSync(this.logPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    } catch {}
  }
}

/** Opens the orchestrator database with foreign keys on, the shared busy timeout and lock measurement. */
export function openOrchestratorDatabase(path: string, options: { readOnly?: boolean; timeoutMs?: number } = {}): DatabaseSync {
  const timeoutMs = options.timeoutMs ?? BUSY_TIMEOUT_MS;
  const database = new OrchestratorDatabase(path, { readOnly: options.readOnly ?? false, timeoutMs });
  database.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=${timeoutMs};`);
  return database;
}
