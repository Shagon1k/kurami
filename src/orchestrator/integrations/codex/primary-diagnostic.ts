import { closeSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { sanitizeWorkerSummary, sanitizeWorkerText, WORKER_SUMMARY_LIMIT } from "./worker-diagnostic.ts";

export type PrimaryStoppedResult = { threadId: string; turnId: string; summary: string | null };
const READ_LIMIT = 256 * 1024;

/** Keep the concluding blockers as well as the opening result; redact before slicing. */
export function primaryStoppedSummary(text: string): string | null {
  const safe = sanitizeWorkerText(text);
  if (!safe || safe.length <= WORKER_SUMMARY_LIMIT) return safe;
  return safe.slice(0, 300) + " … " + safe.slice(-(WORKER_SUMMARY_LIMIT - 303));
}

/** Native completion receipt, not terminal prose or a delivery-success classifier. */
export function capturePrimaryStoppedResult(threadId: string, worktree: string | null,
  home = process.env.CODEX_HOME ?? resolve(homedir(), ".codex")): PrimaryStoppedResult | null {
  let database: DatabaseSync | undefined;
  let fd: number | undefined;
  try {
    database = new DatabaseSync(resolve(home, "state_5.sqlite"), { readOnly: true, timeout: 1000 });
    const row = database.prepare("SELECT rollout_path FROM threads WHERE id=?").get(threadId);
    if (typeof row?.rollout_path !== "string") return null;
    const path = realpathSync(row.rollout_path);
    if (!["sessions", "archived_sessions"].some(dir => path.startsWith(resolve(home, dir) + sep))) return null;
    fd = openSync(path, "r");
    const before = fstatSync(fd);
    const size = before.size;
    const buffer = Buffer.alloc(Math.min(size, READ_LIMIT));
    const firstLength = readSync(fd, buffer, 0, buffer.length, 0);
    const first = buffer.subarray(0, firstLength).toString("utf8").split("\n")[0]!;
    const meta = JSON.parse(first);
    if (meta.type !== "session_meta" || meta.payload?.id !== threadId || !worktree || meta.payload.cwd !== worktree) return null;
    const offset = Math.max(0, size - READ_LIMIT);
    const length = readSync(fd, buffer, 0, buffer.length, offset);
    const lines = buffer.subarray(0, length).toString("utf8").split("\n");
    if (offset > 0) lines.shift();
    let result: PrimaryStoppedResult | null = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { return null; }
      if (record.type !== "event_msg") continue;
      const event = record.payload;
      if (event?.type === "task_started" || event?.type === "turn_aborted") result = null;
      if (event?.type === "task_complete" && typeof event.turn_id === "string") {
        result = { threadId, turnId: event.turn_id,
          summary: typeof event.last_agent_message === "string" ? primaryStoppedSummary(event.last_agent_message) : null };
      }
    }
    const after = fstatSync(fd);
    return after.size === before.size && after.mtimeMs === before.mtimeMs ? result : null;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); database?.close(); }
}

/** Only the current primary park receipt may explain its stopped result. No historical backfill. */
export function primaryStoppedDiagnostic(database: DatabaseSync, runId: string): string | null {
  const run = database.prepare(`SELECT r.state, r.owner_state, r.stop_reason,
    rr.codex_thread_id, rr.previous_codex_thread_id, rr.tmux_session_name
    FROM runs r JOIN run_resources rr USING(run_id) WHERE r.run_id=?`).get(runId);
  if (!run || run.state !== "parked_review" || run.owner_state !== "none" || run.stop_reason ||
      run.previous_codex_thread_id || run.tmux_session_name || typeof run.codex_thread_id !== "string") return null;
  const receipt = database.prepare(`SELECT reason, details_json FROM run_state_history
    WHERE run_id=? ORDER BY sequence DESC LIMIT 1`).get(runId);
  if (receipt?.reason !== "codex_cli_park_completed") return null;
  let details;
  try { details = JSON.parse(String(receipt.details_json)); } catch { return null; }
  if (details.codexThreadId !== run.codex_thread_id || details.primaryStoppedResult?.threadId !== run.codex_thread_id ||
      typeof details.primaryStoppedResult?.turnId !== "string") return null;
  const summary = typeof details.primaryStoppedResult.summary === "string"
    ? sanitizeWorkerSummary(details.primaryStoppedResult.summary) : null;
  return summary ? `Run report (not PR verification): ${summary}` : null;
}
