import type { DatabaseSync } from "node:sqlite";
import { redactSecretLikeText } from "../../security/prompt-safety.ts";

export const WORKER_SUMMARY_LIMIT = 800;

/** Final assistant prose only: never user input, tool stdout, errors or a whole transcript. */
export function completedWorkerSummary(items: unknown): string | null {
  if (!Array.isArray(items)) return null;
  const item = items.findLast((value) => value?.type === "agentMessage" && value.phase === "final_answer" && typeof value.text === "string");
  return item ? sanitizeWorkerSummary(item.text) : null;
}

export function sanitizeWorkerText(text: string): string | null {
  // Fail closed on echoed orchestrator prompts; a final-channel echo is not a report.
  if (/Start fresh CI repair attempt|Initialize the engineering run|Start owner-approved review fix round|delimiter-safe JSON|explicit developer approval for focused commits/iu.test(text)) return null;
  // Redact before truncating so a credential crossing the boundary is not exposed.
  const safe = redactSecretLikeText(text)
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[^\s]+)\b/giu, "[REDACTED_CREDENTIAL]")
    .replace(/\b[\w.-]*(?:token|secret|password|passwd|api_key|private_key|credential)[\w.-]*\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/giu, "[REDACTED_CREDENTIAL]")
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s]+/giu, "[URL omitted]")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
    // Inert in Markdown/Discord as well as escaped HTML: no mentions, links or fences.
    .replace(/[@<>`*_[\]\\]/gu, " ")
    .replace(/\s+/gu, " ").trim();
  if (!safe) return null;
  return safe;
}

export function sanitizeWorkerSummary(text: string): string | null {
  const safe = sanitizeWorkerText(text);
  if (!safe) return null;
  return safe.length > WORKER_SUMMARY_LIMIT ? safe.slice(0, WORKER_SUMMARY_LIMIT - 1) + "…" : safe;
}

export type WorkerDiagnostic = {
  taskId: string; kind: string; contextId: string; threadId: string | null; turnId: string | null;
  sourceHeadSha: string; outcome: string | null; workerSummary: string | null; failureCode: string | null;
};

/** Current terminal context only. Restored primary threads and historical prose are not evidence. */
export function technicalWorkerDiagnostic(database: DatabaseSync, runId: string): WorkerDiagnostic | null {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE name='run_codex_tasks'").get() ||
      !database.prepare("PRAGMA table_info(run_codex_tasks)").all().some(row => row.name === "final_summary")) return null;
  const task = database.prepare(`SELECT t.*, a.source_head_sha AS ci_source, a.failure_reason AS ci_outcome,
      f.source_head_sha AS review_source, f.failure_reason AS review_outcome
    FROM run_codex_tasks t
    LEFT JOIN run_ci_repair_attempts a ON t.kind='ci_repair' AND a.attempt_id=t.context_id AND a.run_id=t.run_id
      AND a.codex_thread_id IS t.thread_id AND a.attempt_state='needs_attention'
      AND a.attempt_number=(SELECT MAX(attempt_number) FROM run_ci_repair_attempts WHERE run_id=t.run_id)
    LEFT JOIN run_review_fix_rounds f ON t.kind='review_fix' AND f.round_id=t.context_id AND f.run_id=t.run_id
      AND f.codex_thread_id IS t.thread_id AND f.round_state='needs_attention'
      AND f.round_number=(SELECT MAX(round_number) FROM run_review_fix_rounds WHERE run_id=t.run_id)
    JOIN runs r ON r.run_id=t.run_id AND r.state='needs_attention'
    WHERE t.run_id=? ORDER BY t.rowid DESC LIMIT 1`).get(runId);
  if (!task || !(task.ci_source || task.review_source)) return null;
  // An old failed context can remain after a guarded recovery. It must not explain
  // a later unrelated preview/admission failure merely because the run needs attention.
  const attention = database.prepare(`SELECT details_json FROM run_state_history
    WHERE run_id=? AND to_state='needs_attention'
      AND reason NOT IN ('ci_repair_task_archived','review_fix_task_archived')
    ORDER BY sequence DESC LIMIT 1`).get(runId);
  let provenance: { taskId?: unknown; attemptId?: unknown; roundId?: unknown };
  try { provenance = JSON.parse(String(attention?.details_json ?? "null")); }
  catch { return null; }
  if (!provenance || !(provenance.taskId === task.task_id ||
      (task.kind === 'ci_repair' && provenance.attemptId === task.context_id) ||
      (task.kind === 'review_fix' && provenance.roundId === task.context_id))) return null;
  return {
    taskId: String(task.task_id), kind: String(task.kind), contextId: String(task.context_id),
    threadId: task.thread_id as string | null, turnId: task.turn_id as string | null,
    sourceHeadSha: String(task.ci_source ?? task.review_source),
    outcome: sanitizeWorkerSummary(String(task.ci_outcome ?? task.review_outcome ?? "Technical task needs attention")),
    workerSummary: task.turn_status === "completed" && !task.failure_code && task.stopped_at && task.final_summary
      ? sanitizeWorkerSummary(String(task.final_summary)) : null,
    failureCode: task.failure_code ? String(task.failure_code).replace(/[^a-zA-Z0-9_]/gu, "").slice(0, 100) : null,
  };
}

export function workerDiagnosticText(diagnostic: WorkerDiagnostic | null): string | null {
  if (!diagnostic) return null;
  return [diagnostic.outcome, diagnostic.workerSummary ? `Worker report (not delivery proof): ${diagnostic.workerSummary}` :
    diagnostic.failureCode ? `Worker failure: ${diagnostic.failureCode}` : "Worker final summary unavailable."].filter(Boolean).join(" · ");
}
