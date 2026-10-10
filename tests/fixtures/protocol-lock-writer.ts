// Disposable writer using the same connection as the protocol lifecycle tests, never live state.
import { rmSync } from "node:fs";
import { protocolRepository } from "./protocol-repository.ts";

const fixture = protocolRepository();
process.send!({ kind: "ready", root: fixture.root, dbPath: fixture.dbPath,
  timeout: fixture.database.prepare("PRAGMA busy_timeout").get()?.timeout,
  foreignKeys: fixture.database.prepare("PRAGMA foreign_keys").get()?.foreign_keys });
process.on("message", (command: { timeoutMs?: number }) => {
  if (command.timeoutMs !== undefined) fixture.database.exec(`PRAGMA busy_timeout=${command.timeoutMs}`);
  process.send!({ kind: "attempting" });
  const started = performance.now();
  try {
    fixture.database.prepare("UPDATE run_codex_tasks SET stop_requested=COALESCE(stop_requested,?) WHERE task_id=?")
      .run("cancel", fixture.id);
    process.send!({ kind: "result", ok: true, ms: performance.now() - started,
      stopRequested: fixture.database.prepare("SELECT stop_requested FROM run_codex_tasks WHERE task_id=?").get(fixture.id)?.stop_requested });
  } catch (error) {
    process.send!({ kind: "result", ok: false, ms: performance.now() - started,
      error: String(error), errcode: (error as { errcode?: number }).errcode });
  }
});
process.on("disconnect", () => {
  fixture.database.close();
  rmSync(fixture.root, { recursive: true, force: true });
});
