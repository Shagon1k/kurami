import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { resolveKuramiHome } from "../../../core/kurami-home.ts";
import { taskForSession, type ProtocolTask } from "../../integrations/codex/task-store.ts";
import { assertNoLegacyWriter, pf33RecoveryEvidence } from "./recover-legacy-ci-timeout.ts";

export const noHeadRecoveryReason = "protocol_ci_no_new_head_review_recovery";
export const pf33NoHeadEvidence = Object.freeze({
  runId: pf33RecoveryEvidence.runId, project: pf33RecoveryEvidence.project,
  repository: pf33RecoveryEvidence.repository, issueNumber: 33, pullNumber: 156,
  branch: pf33RecoveryEvidence.branch, sourceSha: pf33RecoveryEvidence.sourceSha,
  predecessorThreadId: pf33RecoveryEvidence.previousThreadId,
  attemptId: "cra_e4cb3b423e6b478abdfc0b1e93058481", taskId: "ct_5d0bfee44e0b4bc7913cdce1069fcc16",
});
type Evidence = { [K in keyof typeof pf33NoHeadEvidence]: typeof pf33NoHeadEvidence[K] extends string ? string : number };
type Project = { repository: string; workspace: { canonical_repository: string; worktree_root: string; base_branch: string } };
function requireEvidence(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(`Protocol CI recovery refused: ${reason}`);
}
function command(executable: string, args: string[]): string {
  const result = spawnSync(executable, args, { encoding: "utf8", timeout: 30_000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  // Never propagate credential-bearing stderr or API payloads.
  requireEvidence(result.status === 0, `${executable} evidence unavailable`);
  return result.stdout.trim();
}
function json(value: unknown): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(String(value));
    requireEvidence(parsed && typeof parsed === "object" && !Array.isArray(parsed), "invalid evidence object");
    return parsed as Record<string, unknown>;
  } catch { throw new Error("Protocol CI recovery refused: invalid evidence JSON"); }
}

export function recoverCiNoNewHead(database: DatabaseSync, project: Project, apply: boolean,
  evidence: Evidence = pf33NoHeadEvidence): object {
  // Dry runs also read a consistent DB snapshot. Apply holds the controller claim fence
  // throughout filesystem/process/GitHub validation; operators must quiesce launchers.
  database.exec(apply ? "BEGIN IMMEDIATE" : "BEGIN");
  try {
    const run = database.prepare(`SELECT r.*,rr.resource_state,rr.worktree_path,rr.branch_name,
      rr.tmux_session_name,rr.codex_thread_id,rr.previous_codex_thread_id
      FROM runs r JOIN run_resources rr USING(run_id) WHERE run_id=?`).get(evidence.runId);
    requireEvidence(run && run.project === evidence.project && run.repository === evidence.repository &&
      run.issue_number === evidence.issueNumber && project.repository === evidence.repository, "run is not allowlisted");
    const recovered = run.state === "parked_review";
    requireEvidence((run.state === "needs_attention" || recovered) && run.owner_state === "none" && run.stop_reason === null &&
      run.completion_requested_at === null && run.execution_mode === "live" && run.resource_state === "provisioned" &&
      run.tmux_session_name === null && run.previous_codex_thread_id === null &&
      run.codex_thread_id === evidence.predecessorThreadId && run.branch_name === evidence.branch, "run/owner/thread fence changed");
    const attempts = database.prepare("SELECT * FROM run_ci_repair_attempts WHERE run_id=? ORDER BY attempt_number DESC").all(evidence.runId);
    const attempt = attempts[0];
    // Exhausted budget is essential: restoring the predecessor must not expose a retry.
    requireEvidence(attempts.length === 2 && attempt?.attempt_number === 2 && attempt.attempt_id === evidence.attemptId &&
      attempt.attempt_state === "needs_attention" && attempt.failure_reason === "No new PR head appeared after the fixer task" &&
      attempt.source_head_sha === evidence.sourceSha && attempt.result_head_sha === null && attempt.completed_at &&
      attempts.every(a => !["running", "waiting_ci"].includes(String(a.attempt_state))), "latest attempt or exhausted budget changed");
    const request = database.prepare("SELECT * FROM run_control_requests WHERE request_id=? AND run_id=?").get(attempt.request_id!,evidence.runId);
    requireEvidence(request?.action === "ci_repair" && request.request_state === "applied", "repair request changed");
    const task = database.prepare("SELECT * FROM run_codex_tasks WHERE task_id=?").get(evidence.taskId) as ProtocolTask | undefined;
    requireEvidence(task && task.run_id === evidence.runId && task.kind === "ci_repair" && task.context_id === evidence.attemptId &&
      task.thread_id && task.thread_id === attempt.codex_thread_id && task.thread_id !== evidence.predecessorThreadId && task.turn_id &&
      task.phase === "terminal" && task.turn_status === "completed" && task.failure_code === null &&
      (task.stop_requested === null || task.stop_requested === "release") && task.stopped_at && task.released_at &&
      task.worktree_path === run.worktree_path && task.branch_name === evidence.branch &&
      taskForSession(database,task.session_name)?.task_id === task.task_id, "terminal/released task identity changed");
    requireEvidence(Number.isFinite(Date.parse(task.stopped_at)) && Number.isFinite(Date.parse(task.released_at)) &&
      Date.parse(task.released_at) >= Date.parse(task.stopped_at), "stop/release acknowledgement timestamps invalid");
    const terminal = database.prepare("SELECT * FROM run_codex_task_events WHERE task_id=? AND event_key=?")
      .get(task.task_id,`terminal:${task.turn_id}`);
    requireEvidence(terminal?.method === "turn/completed" && terminal.thread_id === task.thread_id &&
      terminal.turn_id === task.turn_id && terminal.status === "completed" && terminal.failure_code === null, "exact terminal receipt missing");
    const release = database.prepare(`SELECT details_json FROM run_state_history WHERE run_id=?
      AND reason='codex_protocol_park_completed' AND to_state='parked_review'
      AND json_extract(details_json,'$.taskId')=? ORDER BY sequence DESC LIMIT 1`).get(evidence.runId,task.task_id);
    const released = json(release?.details_json);
    requireEvidence(released.threadId === task.thread_id && released.turnId === task.turn_id &&
      released.turnStatus === "completed" && released.failureCode === null, "release receipt changed");
    const archive = database.prepare(`SELECT sequence,details_json FROM run_state_history
      WHERE run_id=? AND reason='ci_repair_task_archived' ORDER BY sequence DESC LIMIT 1`).get(evidence.runId);
    const archived = json(archive?.details_json);
    requireEvidence(archived.attemptId === evidence.attemptId && archived.attemptNumber === 2 &&
      archived.repairCodexThreadId === task.thread_id && archived.restoredCodexThreadId === evidence.predecessorThreadId,
      "archive/predecessor evidence changed");
    const attention = database.prepare(`SELECT sequence,reason,details_json FROM run_state_history WHERE run_id=?
      AND to_state='needs_attention' AND reason NOT IN ('ci_repair_task_archived','review_fix_task_archived')
      ORDER BY sequence DESC LIMIT 1`).get(evidence.runId);
    const attentionDetail = json(attention?.details_json);
    requireEvidence(attention?.reason === "ci_repair_no_new_head" && attentionDetail.attemptId === attempt.attempt_id &&
      attentionDetail.attemptNumber === 2 && attentionDetail.sourceHeadSha === evidence.sourceSha, "latest attention reason changed");
    const history = database.prepare(`SELECT * FROM run_state_history WHERE run_id=? AND from_state IS NOT to_state
      ORDER BY sequence DESC LIMIT 1`).get(evidence.runId);
    const detail = json(history?.details_json);
    requireEvidence(history?.to_state === run.state && (recovered
      ? history.reason === noHeadRecoveryReason && detail.taskId === task.task_id && detail.attemptId === attempt.attempt_id &&
        detail.sourceHeadSha === evidence.sourceSha && detail.archiveSequence === archive?.sequence &&
        detail.attentionSequence === attention.sequence && detail.threadId === task.thread_id && detail.turnId === task.turn_id &&
        detail.stoppedAt === task.stopped_at && detail.releasedAt === task.released_at && detail.repairRetry === false
      : history.sequence === attention.sequence && history.reason === "ci_repair_no_new_head" && detail.attemptId === attempt.attempt_id &&
        detail.attemptNumber === 2 && detail.sourceHeadSha === evidence.sourceSha), "latest attention/recovery reason changed");
    for (const [table, condition] of [
      ["run_control_requests", "request_state IN ('pending','processing')"],
      ["run_codex_tasks", "released_at IS NULL"],
      ["run_ai_reviews", "review_state='running'"],
      ["run_review_fix_rounds", "round_state IN ('running','waiting_ci','resolving')"],
      ["run_autonomous_successions", "succession_state IN ('starting','running')"],
    ]) requireEvidence(!database.prepare(`SELECT 1 FROM ${table} WHERE run_id=? AND ${condition}`).get(evidence.runId), "control or worker conflict");
    requireEvidence(!database.prepare(`SELECT 1 FROM project_events WHERE project=? AND item_id=?
      AND processing_state='pending' AND event_id<>? AND from_status IS NOT to_status`).get(run.project,run.item_id,run.trigger_event_id),
      "pending Project mutation");
    requireEvidence(!database.prepare("SELECT 1 FROM runs WHERE project=? AND item_id=? AND rowid>(SELECT rowid FROM runs WHERE run_id=?)")
      .get(run.project,run.item_id,evidence.runId), "run superseded");
    const worktree = String(run.worktree_path);
    requireEvidence(!database.prepare("SELECT 1 FROM run_codex_tasks WHERE worktree_path=? AND released_at IS NULL").get(worktree),
      "another protocol task owns worktree");
    const child = relative(realpathSync(project.workspace.worktree_root),worktree);
    requireEvidence(child && !child.startsWith("..") && realpathSync(worktree) === worktree, "worktree boundary changed");
    const git = (...args: string[]) => command("git",["-C",worktree,...args]);
    requireEvidence(git("rev-parse","--show-toplevel") === worktree && git("branch","--show-current") === evidence.branch &&
      git("status","--porcelain","--untracked-files=all") === "", "worktree identity or cleanliness changed");
    const common = git("rev-parse","--path-format=absolute","--git-common-dir");
    requireEvidence(common === command("git",["-C",project.workspace.canonical_repository,"rev-parse","--path-format=absolute","--git-dir"]) &&
      git("rev-parse","--path-format=absolute","--git-dir").startsWith(common + "/worktrees/"), "linked repository changed");
    requireEvidence(git("remote","get-url","origin").replace(/\.git$/u, "") === `https://github.com/${evidence.repository}` &&
      git("rev-parse","HEAD") === evidence.sourceSha && git("rev-parse",`refs/remotes/origin/${evidence.branch}`) === evidence.sourceSha,
      "origin/local/tracking SHA changed");
    requireEvidence(command("git",["ls-remote","--exit-code",`https://github.com/${evidence.repository}.git`,`refs/heads/${evidence.branch}`]) ===
      `${evidence.sourceSha}\trefs/heads/${evidence.branch}`, "live remote SHA changed");
    const gh = (path: string) => json(command(process.env.GH_BIN?.trim() || "gh",["api","--method","GET",path]));
    const prUrl = `https://github.com/${evidence.repository}/pull/${evidence.pullNumber}`;
    const pull = gh(`repos/${evidence.repository}/pulls/${evidence.pullNumber}`);
    const head = pull.head as { sha?: string; ref?: string; repo?: { full_name?: string } } | undefined;
    const base = pull.base as { sha?: string; ref?: string; repo?: { full_name?: string } } | undefined;
    requireEvidence(pull.number === evidence.pullNumber && pull.html_url === prUrl && pull.state === "open" && pull.merged === false &&
      head?.sha === evidence.sourceSha && head.ref === evidence.branch && head.repo?.full_name === evidence.repository &&
      base?.ref === project.workspace.base_branch && base.repo?.full_name === evidence.repository, "live PR identity/SHA changed");
    const ci = database.prepare("SELECT * FROM run_ci_snapshots WHERE run_id=?").get(evidence.runId);
    const age = Date.now() - Date.parse(String(ci?.last_observed_at));
    requireEvidence(ci?.repository === evidence.repository && ci.pull_request_number === evidence.pullNumber &&
      ci.pull_request_url === prUrl && ci.head_sha === evidence.sourceSha && ci.aggregate_state === "failed" && ci.last_error === null &&
      age >= 0 && age <= 120_000, "fresh failed CI evidence missing");
    const review = database.prepare("SELECT * FROM run_ai_reviews WHERE run_id=? ORDER BY review_number DESC LIMIT 1").get(evidence.runId);
    requireEvidence(review?.review_state === "ready" && review.repository === evidence.repository && review.pull_request_number === evidence.pullNumber &&
      review.pull_request_url === prUrl && review.head_sha === evidence.sourceSha && review.base_sha === base?.sha &&
      review.base_ref === base?.ref && review.completed_at && review.failure_reason === null && review.github_review_id &&
      /^\d+$/u.test(String(review.github_review_id)) && review.github_review_url && review.findings_json &&
      Number(review.critical_count) + Number(review.important_count) + Number(review.suggestion_count) > 0, "current ready AI findings missing");
    let findings: unknown;
    try { findings = JSON.parse(String(review.findings_json)); }
    catch { throw new Error("Protocol CI recovery refused: invalid AI findings"); }
    requireEvidence(Array.isArray(findings) && findings.length > 0 &&
      findings.length === Number(review.critical_count) + Number(review.important_count) + Number(review.suggestion_count),
      "ready AI findings missing or inconsistent");
    const published = gh(`repos/${evidence.repository}/pulls/${evidence.pullNumber}/reviews/${review.github_review_id}`);
    requireEvidence(String(published.id) === review.github_review_id && published.commit_id === evidence.sourceSha &&
      published.html_url === review.github_review_url && published.submitted_at &&
      ["COMMENTED","CHANGES_REQUESTED","APPROVED"].includes(String(published.state)), "published AI review stale or missing");
    assertNoLegacyWriter(worktree,task.session_name);
    const panes = spawnSync("tmux",["list-panes","-a","-F","#{pane_current_path}"],{encoding:"utf8"});
    requireEvidence(panes.status === 1 || (panes.status === 0 && !panes.stdout.split("\n").some(path => path === worktree || path.startsWith(worktree + "/"))),
      "live worktree supervisor or tmux evidence unavailable");
    const inspected = { taskId: task.task_id, attemptId: attempt.attempt_id, attemptNumber: 2, threadId: task.thread_id,
      turnId: task.turn_id, turnStatus: task.turn_status, stoppedAt: task.stopped_at, releasedAt: task.released_at,
      predecessorThreadId: evidence.predecessorThreadId, archiveSequence: archive!.sequence, attentionSequence: attention.sequence, historySequence: history!.sequence,
      sourceHeadSha: evidence.sourceSha, worktree, pullRequestNumber: evidence.pullNumber, reviewId: review.review_id,
      githubReviewId: review.github_review_id, baseSha: base!.sha, ciObservedAt: ci.last_observed_at,
      externalBlock: "github_billing_or_spending_limit", evidenceBasis: "owner_report_and_allowlisted_completed_no_head_incident",
      repairRetry: false, action: noHeadRecoveryReason };
    if (apply && !recovered) {
      const changed = database.prepare(`UPDATE runs SET state='parked_review',owner_state='none',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE run_id=? AND state='needs_attention' AND owner_state='none' AND stop_reason IS NULL`).run(evidence.runId);
      requireEvidence(changed.changes === 1, "run changed before recovery");
      database.prepare(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
        VALUES (?,'needs_attention','parked_review',?,?)`).run(evidence.runId,noHeadRecoveryReason,JSON.stringify(inspected));
    }
    database.exec("COMMIT");
    return { ok: true, apply, alreadyRecovered: recovered, runId: evidence.runId, ...inspected };
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

if (import.meta.main) {
  process.umask(0o077);
  const args = process.argv.slice(2);
  requireEvidence((args.length === 2 || args.length === 3) && args[0] === "--run-id" && args[1] === pf33NoHeadEvidence.runId &&
    (args.length === 2 || args[2] === "--apply"), "use --run-id <allowlisted run> [--apply]");
  const home = resolveKuramiHome(resolve(import.meta.dirname,"../../../../.."));
  const config = parse(readFileSync(resolve(home,"config/orchestrator.yaml"),"utf8"));
  requireEvidence(config.mode === "live", "controller is not in live mode");
  const registry = parse(readFileSync(resolve(home,"config/projects.yaml"),"utf8"));
  const apply = args.includes("--apply");
  const database = new DatabaseSync(resolve(home,"state/orchestrator.db"),{readOnly:!apply,timeout:5_000});
  try { process.stdout.write(JSON.stringify(recoverCiNoNewHead(database,registry.projects.pickflick,apply)) + "\n"); }
  finally { database.close(); }
}
