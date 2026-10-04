import { randomUUID } from "node:crypto";
import { completedWorkerSummary } from "./worker-diagnostic.ts";
import type { DatabaseSync } from "node:sqlite";

export type ProtocolTask = {
  task_id: string; run_id: string; kind: "ci_repair" | "review_fix";
  context_id: string; session_name: string; thread_id: string | null; turn_id: string | null;
  worktree_path: string; branch_name: string;
  phase: string; turn_status: "completed" | "failed" | "interrupted" | null;
  final_summary: string | null;
  failure_code: string | null; stop_requested: string | null; stopped_at: string | null;
  released_at: string | null; created_at: string;
};

export function taskForSession(database: DatabaseSync, session: string | null): ProtocolTask | null {
  if (!session || !database.prepare("SELECT 1 FROM sqlite_master WHERE name='run_codex_tasks'").get()) return null;
  return database.prepare("SELECT * FROM run_codex_tasks WHERE session_name=? ORDER BY rowid DESC LIMIT 1")
    .get(session) as ProtocolTask | undefined ?? null;
}

export function isProtocolThread(database: DatabaseSync, threadId: string | null): boolean {
  if (!threadId || !database.prepare("SELECT 1 FROM sqlite_master WHERE name='run_codex_tasks'").get()) return false;
  return Boolean(database.prepare("SELECT 1 FROM run_codex_tasks WHERE thread_id=?").get(threadId));
}

export function claimProtocolTask(database: DatabaseSync, runId: string, session: string,
  kind: ProtocolTask["kind"], contextId: string): string {
  if (!["ci_repair", "review_fix"].includes(kind)) throw new Error("Protocol execution is restricted to CI repair and review fix");
  const taskId = `ct_${randomUUID().replaceAll("-", "")}`;
  const inserted = database.prepare(`INSERT INTO run_codex_tasks(task_id,run_id,session_name,kind,context_id,worktree_path,branch_name)
    SELECT ?,run_id,?,?,?,worktree_path,branch_name FROM run_resources
    WHERE run_id=? AND tmux_session_name=?`).run(taskId,session,kind,contextId,runId,session);
  if (inserted.changes !== 1) throw new Error("Missing exact worktree claim for protocol task");
  return taskId;
}

// Errors are protocol discriminants, never raw stdout/error prose. Only a separately
// bounded completed final assistant report may be retained as display-only diagnostics.
export function turnFailureCode(error: unknown): string {
  const info = (error as { codexErrorInfo?: unknown } | null)?.codexErrorInfo;
  if (info === "usageLimitExceeded" || info === "sessionBudgetExceeded") return "external_billing_block";
  if (info === "rateLimitExceeded") return "external_rate_limit";
  if (typeof info === "string") return `protocol_${info.replace(/[^a-zA-Z]/gu, "")}`;
  if (info && typeof info === "object") {
    const [key] = Object.keys(info);
    const status = (Object.values(info)[0] as { httpStatusCode?: number } | null)?.httpStatusCode;
    if (status === 402) return "external_billing_block";
    if (status === 429) return "external_rate_limit";
    return `protocol_${(key ?? "unknown").replace(/[^a-zA-Z]/gu, "")}`;
  }
  return "protocol_turn_failed";
}

export function recordTurnCompleted(database: DatabaseSync, taskId: string, message: {
  method?: string; params?: unknown;
}): boolean {
  if (message.method !== "turn/completed") return false;
  const params = message.params as {
    threadId?: string; turn?: { id?: string; status?: string; error?: unknown; items?: unknown };
  } | undefined;
  const turn = params?.turn;
  if (!params?.threadId || !turn?.id || !["completed","failed","interrupted"].includes(turn.status ?? "")) return false;
  database.exec("BEGIN IMMEDIATE");
  try {
    const task = database.prepare("SELECT * FROM run_codex_tasks WHERE task_id=?").get(taskId) as ProtocolTask;
    if (!task) { database.exec("COMMIT"); return false; }
    const owner = database.prepare(`SELECT r.owner_state, rr.tmux_session_name, rr.codex_thread_id,rr.worktree_path,rr.branch_name
      FROM runs r JOIN run_resources rr USING(run_id) WHERE r.run_id=?`).get(task.run_id) as {
      owner_state: string; tmux_session_name: string | null; codex_thread_id: string | null;
      worktree_path: string | null; branch_name: string | null;
    };
    if (!task || task.released_at || task.thread_id !== params.threadId || task.turn_id !== turn.id ||
        owner.owner_state !== "cli" || owner.tmux_session_name !== task.session_name ||
        owner.codex_thread_id !== task.thread_id || owner.worktree_path !== task.worktree_path ||
        owner.branch_name !== task.branch_name) {
      database.exec("COMMIT");
      return false;
    }
    const failure = turn.status === "failed" ? turnFailureCode(turn.error) :
      turn.status === "interrupted" ? "protocol_turn_interrupted" : null;
    // First terminal receipt wins; conflicting replays cannot change completion.
    const changed = database.prepare(`UPDATE run_codex_tasks SET phase='terminal',turn_status=?,
      failure_code=COALESCE(failure_code,?),final_summary=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE task_id=? AND turn_status IS NULL`).run(turn.status!, failure,
        turn.status === 'completed' && !task.failure_code ? completedWorkerSummary(turn.items) : null, taskId);
    if (changed.changes === 1)
      database.prepare(`INSERT INTO run_codex_task_events
        (task_id,event_key,method,thread_id,turn_id,status,failure_code) VALUES (?,?,?,?,?,?,?)`)
        .run(taskId, `terminal:${turn.id}`, "turn/completed", params.threadId, turn.id, turn.status!, failure);
    database.exec("COMMIT");
    return true;
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

export function protocolTurnSucceeded(database: DatabaseSync, session: string): boolean {
  const task = taskForSession(database, session);
  return task?.turn_status === "completed" && !task.failure_code && Boolean(task.stopped_at) && !task.released_at;
}

export function markTaskFailure(database: DatabaseSync, taskId: string, code: string): void {
  database.prepare(`UPDATE run_codex_tasks SET failure_code=COALESCE(failure_code,?),
    phase=CASE WHEN turn_status IS NULL THEN 'disconnected' ELSE phase END,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE task_id=? AND released_at IS NULL`).run(code, taskId);
}
