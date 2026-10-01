import type { DatabaseSync } from "node:sqlite";
import { AppServerClient } from "../../integrations/codex/app-server.ts";
import { markTaskFailure, recordTurnCompleted, taskForSession, type ProtocolTask } from "../../integrations/codex/task-store.ts";
import { killTmuxSession, tmuxSessionExists } from "./session-shared.ts";

export const protocolRemoteBlocker = "protocol_remote_handoff_unverified: the installed public app-server protocol has no verified transfer to the mobile Remote host; Take control remains pending on upstream integration. No Remote ownership was assigned.";

function assertTaskMapping(database: DatabaseSync, task: ProtocolTask): void {
  const current = taskForSession(database,task.session_name);
  const mapping = database.prepare(`SELECT r.owner_state,rr.* FROM runs r JOIN run_resources rr USING(run_id) WHERE run_id=?`)
    .get(task.run_id);
  if (!current || current.task_id !== task.task_id || current.run_id !== task.run_id ||
      current.kind !== task.kind || current.context_id !== task.context_id || current.released_at || mapping?.owner_state !== "cli" ||
      mapping.tmux_session_name !== task.session_name || mapping.codex_thread_id !== current.thread_id ||
      mapping.worktree_path !== current.worktree_path || mapping.branch_name !== current.branch_name)
    throw new Error("Protocol task ownership or exact mapping changed");
}

export async function stopProtocolTask(database: DatabaseSync, task: ProtocolTask,
  intent: "cancel" | "timeout" | "release"): Promise<ProtocolTask> {
  assertTaskMapping(database,task);
  database.prepare("UPDATE run_codex_tasks SET stop_requested=COALESCE(stop_requested,?) WHERE task_id=?")
    .run(intent,task.task_id);
  for (let attempt=0; attempt<60; attempt++) {
    const updated = taskForSession(database,task.session_name)!;
    if (updated.stopped_at) return updated;
    if (!tmuxSessionExists(task.session_name)) break;
    await new Promise<void>((done) => setTimeout(done,250));
  }
  // Exit can land between the receipt read and has-session. Re-read after observing exit.
  assertTaskMapping(database,task);
  const acknowledged = taskForSession(database,task.session_name)!;
  if (acknowledged.stopped_at) return acknowledged;
  throw new Error("Protocol process stop was not acknowledged; preserving writer ownership and worktree");
}

export function releaseProtocolTask(database: DatabaseSync, task: ProtocolTask,
  targetState: string, reason: string): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = taskForSession(database,task.session_name)!;
    assertTaskMapping(database,task);
    const owner = database.prepare("SELECT state,owner_state,stop_reason FROM runs WHERE run_id=?").get(task.run_id) as {state:string;owner_state:string;stop_reason:string|null};
    if (!current.stopped_at || current.released_at || owner.owner_state !== "cli") throw new Error("Protocol stop or ownership fence changed");
    // Reconciliation precedes cancellation planning. A terminal failure cannot undo Done/Cancel.
    if (owner.state === "stopping" && ["cancelled","completed"].includes(owner.stop_reason ?? ""))
      targetState = "stopping";
    // The Codex child has acknowledged exit. Remove only its exact supervisor.
    if (tmuxSessionExists(task.session_name)) killTmuxSession(task.session_name);
    if (tmuxSessionExists(task.session_name)) throw new Error("Protocol supervisor did not exit");
    let restoredThreadId: string | null = null;
    if (current.thread_id === null && current.turn_id === null) {
      const resource = database.prepare("SELECT previous_codex_thread_id FROM run_resources WHERE run_id=?")
        .get(task.run_id) as {previous_codex_thread_id:string|null};
      if (resource.previous_codex_thread_id) {
        // No technical thread was bound: there is nothing to archive. Restore only the
        // predecessor held by this exact unbound task and its still-running context.
        const context = task.kind === "ci_repair"
          ? database.prepare(`SELECT 1 FROM run_ci_repair_attempts WHERE attempt_id=? AND run_id=?
              AND attempt_state='running' AND codex_thread_id IS NULL`).get(task.context_id,task.run_id)
          : database.prepare(`SELECT 1 FROM run_review_fix_rounds WHERE round_id=? AND run_id=?
              AND round_state='running' AND codex_thread_id IS NULL`).get(task.context_id,task.run_id);
        if (!context) throw new Error("Protocol pre-binding task context changed");
        const restored = database.prepare(`UPDATE run_resources
          SET codex_thread_id=previous_codex_thread_id,previous_codex_thread_id=NULL
          WHERE run_id=? AND tmux_session_name=? AND codex_thread_id IS NULL
            AND previous_codex_thread_id=? AND worktree_path=? AND branch_name=?`)
          .run(task.run_id,task.session_name,resource.previous_codex_thread_id,task.worktree_path,task.branch_name);
        if (restored.changes !== 1) throw new Error("Protocol predecessor mapping changed");
        restoredThreadId = resource.previous_codex_thread_id;
      }
    }
    const changed = database.prepare(`UPDATE run_resources SET tmux_session_name=NULL
      WHERE run_id=? AND tmux_session_name=? AND codex_thread_id IS ? AND worktree_path=? AND branch_name=?`)
      .run(task.run_id,task.session_name,restoredThreadId ?? task.thread_id,task.worktree_path,task.branch_name);
    if (changed.changes !== 1) throw new Error("Protocol task mapping changed");
    database.prepare("UPDATE run_codex_tasks SET released_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE task_id=?").run(task.task_id);
    database.prepare("UPDATE runs SET state=?,owner_state='none',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id=?")
      .run(targetState,task.run_id);
    if (["needs_attention","stopping"].includes(targetState) && task.kind === "ci_repair")
      database.prepare("UPDATE run_ci_repair_attempts SET attempt_state='needs_attention',failure_reason=?,completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE attempt_id=?")
        .run(task.failure_code ?? "owner_stop_requested",task.context_id);
    if (["needs_attention","stopping"].includes(targetState) && task.kind === "review_fix")
      database.prepare("UPDATE run_review_fix_rounds SET round_state='needs_attention',failure_reason=?,completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE round_id=?")
        .run(task.failure_code ?? "owner_stop_requested",task.context_id);
    database.prepare(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json) VALUES (?,?,?,?,?)`)
      .run(task.run_id,owner.state,targetState,reason,JSON.stringify({
        taskId:task.task_id,threadId:task.thread_id,turnId:task.turn_id,turnStatus:task.turn_status,failureCode:task.failure_code,
        restoredThreadId,
      }));
    database.exec("COMMIT");
  } catch(error) { database.exec("ROLLBACK"); throw error; }
}

// Controller restart reads only the exact stored identity, never resumes or dispatches it.
export async function reconcileProtocolTasks(database: DatabaseSync, codexBin = process.env.CODEX_BIN || "codex"): Promise<void> {
  const tasks = database.prepare(`SELECT t.* FROM run_codex_tasks t JOIN runs r USING(run_id)
    JOIN run_resources rr USING(run_id) WHERE t.released_at IS NULL AND r.owner_state='cli'
      AND rr.tmux_session_name=t.session_name`).all() as ProtocolTask[];
  for (const task of tasks) {
    const alive = tmuxSessionExists(task.session_name);
    if (!alive && !task.stopped_at) {
      if (task.thread_id && task.turn_id && !task.turn_status) {
        const client = new AppServerClient(codexBin,{rejectServerRequests:true});
        try {
          await client.initialize();
          const response = await client.request("thread/read",{threadId:task.thread_id,includeTurns:true}) as {
            thread?: { id?:string; turns?: Array<{id:string;status:string;error?:unknown}> };
          };
          const turn = response.thread?.id === task.thread_id ? response.thread.turns?.find((turn)=>turn.id===task.turn_id) : undefined;
          if (turn) recordTurnCompleted(database,task.task_id,{method:"turn/completed",params:{threadId:task.thread_id,turn}});
        } catch { /* Missing history is an attention boundary, not a new dispatch. */ }
        finally { await client.shutdown(); }
      }
      markTaskFailure(database,task.task_id,"protocol_process_stop_unacknowledged");
      database.prepare(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
        SELECT run_id,state,'needs_attention','protocol_process_stop_unacknowledged',json_object('taskId',?)
        FROM runs WHERE run_id=? AND state<>'needs_attention'`).run(task.task_id,task.run_id);
      database.prepare("UPDATE runs SET state='needs_attention' WHERE run_id=? AND owner_state='cli'").run(task.run_id);
    }
    const updated = taskForSession(database,task.session_name)!;
    if (updated.stopped_at && (updated.failure_code || (updated.turn_status && updated.turn_status !== "completed")))
      releaseProtocolTask(database,updated,"needs_attention",updated.failure_code ?? "protocol_turn_failed");
  }
}
