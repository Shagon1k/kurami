import { hasActivePrRequest } from "../controls/pr-boundary.ts";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import type { StartPlan } from "../projects/sessions/session-types.ts";
import { assertNoWorktreeWriter } from "../projects/sessions/recover-legacy-ci-timeout.ts";
import type { DatabaseSync } from "node:sqlite";
import { LATEST_ATTENTION_VALUE_SQL } from "./run-projections.ts";

/** A new owner request may spend the remaining attempt; it never clears the old outcome. */
export function canRetryUnchangedCi(database: DatabaseSync, runId: string, requestId: string | null = null): boolean {
  if (hasActivePrRequest(database,runId) ||
    !database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='run_codex_tasks'").get()) return false;
  return Boolean(database.prepare(`SELECT 1 FROM runs r JOIN run_resources rr USING(run_id)
    JOIN run_ci_snapshots ci USING(run_id)
    JOIN run_ci_repair_attempts a ON a.run_id=r.run_id AND a.attempt_number=1
    JOIN run_control_requests q ON q.request_id=a.request_id AND q.run_id=r.run_id
    JOIN run_codex_tasks ct ON ct.run_id=r.run_id AND ct.context_id=a.attempt_id AND ct.kind='ci_repair'
    WHERE r.run_id=? AND r.state='needs_attention' AND r.owner_state='none'
      AND r.execution_mode='live' AND r.stop_reason IS NULL AND r.archived_at IS NULL
      AND r.completion_requested_at IS NULL AND rr.resource_state='provisioned'
      AND rr.tmux_session_name IS NULL AND rr.previous_codex_thread_id IS NULL AND rr.codex_thread_id IS NOT NULL
      AND ${LATEST_ATTENTION_VALUE_SQL}='ci_repair_no_new_head'
      AND EXISTS(SELECT 1 FROM run_state_history h WHERE h.run_id=r.run_id
        AND h.sequence=(SELECT MAX(h2.sequence) FROM run_state_history h2 WHERE h2.run_id=r.run_id AND h2.from_state<>h2.to_state)
        AND h.reason='ci_repair_no_new_head' AND json_extract(h.details_json,'$.attemptId')=a.attempt_id)
      AND a.attempt_state='needs_attention' AND a.result_head_sha IS NULL AND a.completed_at IS NOT NULL
      AND a.failure_reason='No new PR head appeared after the fixer task'
      AND (SELECT COUNT(*) FROM run_ci_repair_attempts attempts WHERE attempts.run_id=r.run_id)=1
      AND q.action='ci_repair' AND q.request_state='applied'
      AND ci.repository=r.repository AND ci.head_sha=a.source_head_sha AND ci.aggregate_state='failed' AND ci.last_error IS NULL
      AND julianday(ci.last_observed_at) BETWEEN julianday('now','-2 minutes') AND julianday('now')
      AND ct.thread_id=a.codex_thread_id AND ct.thread_id<>rr.codex_thread_id AND ct.turn_id IS NOT NULL
      AND ct.phase='terminal' AND ct.turn_status='completed' AND ct.failure_code IS NULL
      AND ct.stopped_at IS NOT NULL AND ct.released_at IS NOT NULL
      AND (ct.stop_requested IS NULL OR ct.stop_requested='release')
      AND julianday(ct.released_at)>=julianday(ct.stopped_at)
      AND ct.worktree_path=rr.worktree_path AND ct.branch_name=rr.branch_name
      AND EXISTS(SELECT 1 FROM run_codex_task_events e WHERE e.task_id=ct.task_id AND e.event_key='terminal:'||ct.turn_id
        AND e.method='turn/completed' AND e.thread_id=ct.thread_id AND e.turn_id=ct.turn_id AND e.status='completed' AND e.failure_code IS NULL)
      AND EXISTS(SELECT 1 FROM run_state_history h WHERE h.run_id=r.run_id AND h.reason='ci_repair_task_archived'
        AND json_extract(h.details_json,'$.attemptId')=a.attempt_id
        AND json_extract(h.details_json,'$.repairCodexThreadId')=ct.thread_id
        AND json_extract(h.details_json,'$.restoredCodexThreadId')=rr.codex_thread_id)
      AND NOT EXISTS(SELECT 1 FROM run_control_requests pending WHERE pending.run_id=r.run_id
        AND pending.request_state IN ('pending','processing') AND (? IS NULL OR pending.request_id<>?))
      AND NOT EXISTS(SELECT 1 FROM run_codex_tasks active WHERE active.worktree_path=rr.worktree_path AND active.released_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM run_ai_reviews review WHERE review.run_id=r.run_id AND review.review_state='running')
      AND NOT EXISTS(SELECT 1 FROM run_review_fix_rounds fix WHERE fix.run_id=r.run_id AND fix.round_state IN ('running','waiting_ci','resolving'))
      AND NOT EXISTS(SELECT 1 FROM run_autonomous_successions s WHERE s.run_id=r.run_id AND s.succession_state IN ('starting','running'))
      AND NOT EXISTS(SELECT 1 FROM runs newer WHERE newer.project=r.project AND newer.item_id=r.item_id AND newer.rowid>r.rowid)
      AND NOT EXISTS(SELECT 1 FROM project_events event WHERE event.project=r.project AND event.item_id=r.item_id
        AND event.processing_state='pending' AND event.from_status IS NOT event.to_status)
  `).get(runId, requestId, requestId));
}

/** Revalidated at the writer claim, before ownership or state changes. */
export function assertUnchangedCiRetrySource(plan: StartPlan): void {
  const repair=plan.repair;
  if (!repair) throw new Error("Missing CI retry source");
  const read=(bin:string,args:string[])=>execFileSync(bin,args,{encoding:"utf8",timeout:20_000,stdio:["ignore","pipe","ignore"]}).trim();
  const git=(...args:string[])=>read("git",["-C",plan.worktreePath,...args]);
  const common=realpathSync(read("git",["-C",plan.canonicalRepository,"rev-parse","--path-format=absolute","--git-dir"]));
  if (realpathSync(plan.worktreePath)!==plan.worktreePath ||
    git("rev-parse","--path-format=absolute","--git-common-dir")!==common ||
    !git("rev-parse","--path-format=absolute","--git-dir").startsWith(common+"/worktrees/") ||
    git("branch","--show-current")!==plan.branchName || git("status","--porcelain","--untracked-files=all")!=="" ||
    git("remote","get-url","origin").replace(/\.git$/u,"")!==`https://github.com/${plan.repository}` ||
    git("rev-parse","HEAD")!==repair.sourceHeadSha ||
    read("git",["ls-remote","--exit-code",`https://github.com/${plan.repository}.git`,`refs/heads/${plan.branchName}`])!==`${repair.sourceHeadSha}\trefs/heads/${plan.branchName}`)
    throw new Error("CI retry refused: preserved worktree or remote head changed");
  const pull=JSON.parse(read(process.env.GH_BIN?.trim() || "gh",["api","--method","GET",`repos/${plan.repository}/pulls/${repair.pullRequestNumber}`]));
  if (pull.state!=="open" || pull.merged!==false || pull.html_url!==repair.pullRequestUrl ||
    pull.head?.sha!==repair.sourceHeadSha || pull.head?.ref!==plan.branchName ||
    pull.head?.repo?.full_name!==plan.repository || pull.base?.repo?.full_name!==plan.repository)
    throw new Error("CI retry refused: current PR identity or head changed");
  assertNoWorktreeWriter(plan.worktreePath);
}
