import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { resolveKuramiHome } from "../../../core/kurami-home.ts";
import { appendHistory } from "./session-shared.ts";
import { taskForSession, type ProtocolTask } from "../../integrations/codex/task-store.ts";
import { assertNoLegacyWriter } from "./recover-legacy-ci-timeout.ts";

// Operator-only, owner-approved external delivery. Never attribute this head to the archived worker.
export const externalDeliveryReason = "operator_external_ci_delivery_recovery";
export const pf34ExternalEvidence = Object.freeze({
  runId: "r_f3edc9332a2d56f6c6dc", project: "pickflick", repository: "Shagon1k/PickFlick",
  issueNumber: 34, pullNumber: 157, itemId: "PVTI_lAHOAKqXQ84Bfsnszg3wrvg",
  branch: "PF-34_7-2-implement-secure-club-invitation",
  worktree: "/home/shagon1k/_projects/.worktrees/pickflick/PF-34_7-2-implement-secure-club-invitation/PickFlick",
  canonical: "/home/shagon1k/_projects/PickFlick",
  sourceSha: "c442192ed8aa4eccc25e06bd90874cc9d1adf7a5",
  externalSha: "b46c7eb16912198596b45d075d5e4f9610671387",
  predecessorThreadId: "01a10411-d166-7f93-a202-8477502583fa",
  attemptId: "cra_376a24dcfb1243f1bc03a3f1356943ff", requestId: "rq_376a24dcfb1243f1bc03a3f1356943ff",
  taskId: "ct_fa10cb31047846be92c1f8e3d2a7e502", threadId: "01a1061b-a783-7893-abe7-b7abe67ec462",
  turnId: "01a1061b-af06-7f50-bc6e-a50ff9070829", sessionName: "cx-pf-34-f3edc9",
  completedAt: "2026-10-04T09:01:41.579Z", stoppedAt: "2026-10-04T08:51:24.635Z",
  releasedAt: "2026-10-04T08:51:37.942Z", releaseSequence: 2221, archiveSequence: 2222, attentionSequence: 2223,
});
export const externalDeliveryChecks = Object.freeze(["Secret scan", "Lint, type-check, test",
  "Integration and runtime smoke", "UI smoke", "Production images", "Delivery gate"]);
type Evidence = { [K in keyof typeof pf34ExternalEvidence]: typeof pf34ExternalEvidence[K] extends string ? string : number };
type Project = { repository: string; workspace: { canonical_repository: string; worktree_root: string; base_branch: string } };
function requireEvidence(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(`External CI recovery refused: ${reason}`);
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
  } catch { throw new Error("External CI recovery refused: invalid evidence JSON"); }
}

export function recoverExternalCiDelivery(database: DatabaseSync, project: Project, apply: boolean,
  evidence: Evidence = pf34ExternalEvidence): object {
  // Dry runs also read a consistent DB snapshot. Apply holds the controller claim fence
  // throughout filesystem/process/GitHub validation; operators must quiesce launchers.
  database.exec(apply ? "BEGIN IMMEDIATE" : "BEGIN");
  try {
    const run = database.prepare(`SELECT r.*,rr.resource_state,rr.worktree_path,rr.branch_name,
      rr.tmux_session_name,rr.codex_thread_id,rr.previous_codex_thread_id,rr.preview_id
      FROM runs r JOIN run_resources rr USING(run_id) WHERE run_id=?`).get(evidence.runId);
    requireEvidence(run && run.project === evidence.project && run.repository === evidence.repository &&
      run.issue_number === evidence.issueNumber && run.item_id === evidence.itemId &&
      project.repository === evidence.repository && project.workspace.canonical_repository === evidence.canonical &&
      run.worktree_path === evidence.worktree && run.interaction_policy === "autonomous", "run is not allowlisted");
    const recovered = run.state === "parked_review";
    requireEvidence((run.state === "needs_attention" || recovered) && run.owner_state === "none" && run.stop_reason === null &&
      run.completion_requested_at === null && run.completion_source_event_id === null && run.archived_at === null &&
      run.preview_required === 1 && run.preview_required_label === "preview-required" && run.preview_id === null &&
      run.preview_requirement_satisfied_at === null && run.preview_requirement_lease_id === null && run.execution_mode === "live" && run.resource_state === "provisioned" &&
      run.tmux_session_name === null && run.previous_codex_thread_id === null &&
      run.codex_thread_id === evidence.predecessorThreadId && run.branch_name === evidence.branch, "run/owner/thread fence changed");
    const attempts = database.prepare("SELECT * FROM run_ci_repair_attempts WHERE run_id=? ORDER BY attempt_number DESC").all(evidence.runId);
    const attempt = attempts[0];
    // Preserve the single historical attempt and budget; current passed CI does not authorize a retry.
    requireEvidence(attempts.length === 1 && attempt?.attempt_number === 1 && attempt.attempt_id === evidence.attemptId &&
      attempt.attempt_state === "needs_attention" && attempt.failure_reason === "No new PR head appeared after the fixer task" &&
      attempt.source_head_sha === evidence.sourceSha && attempt.result_head_sha === null && attempt.completed_at === evidence.completedAt && attempt.source_ci_state === "failed" &&
      attempt.request_id === evidence.requestId &&
      attempts.every(a => !["running", "waiting_ci"].includes(String(a.attempt_state))), "original attempt/budget changed");
    const request = database.prepare("SELECT * FROM run_control_requests WHERE request_id=? AND run_id=?").get(attempt.request_id!,evidence.runId);
    requireEvidence(request?.action === "ci_repair" && request.request_state === "applied", "repair request changed");
    const task = database.prepare("SELECT * FROM run_codex_tasks WHERE task_id=?").get(evidence.taskId) as ProtocolTask | undefined;
    requireEvidence(task && task.run_id === evidence.runId && task.kind === "ci_repair" && task.context_id === evidence.attemptId &&
      task.session_name === evidence.sessionName && task.thread_id === evidence.threadId && task.thread_id === attempt.codex_thread_id && task.thread_id !== evidence.predecessorThreadId && task.turn_id === evidence.turnId &&
      task.phase === "terminal" && task.turn_status === "completed" && task.failure_code === null &&
      task.stop_requested === null && task.stopped_at === evidence.stoppedAt && task.released_at === evidence.releasedAt &&
      task.final_summary === null &&
      task.worktree_path === run.worktree_path && task.branch_name === evidence.branch &&
      taskForSession(database,task.session_name)?.task_id === task.task_id, "terminal/released task identity changed");
    requireEvidence(Number.isFinite(Date.parse(task.stopped_at)) && Number.isFinite(Date.parse(task.released_at)) &&
      Date.parse(task.released_at) >= Date.parse(task.stopped_at), "stop/release acknowledgement timestamps invalid");
    const terminal = database.prepare("SELECT * FROM run_codex_task_events WHERE task_id=? AND event_key=?")
      .get(task.task_id,`terminal:${task.turn_id}`);
    requireEvidence(terminal?.method === "turn/completed" && terminal.thread_id === task.thread_id &&
      terminal.turn_id === task.turn_id && terminal.status === "completed" && terminal.failure_code === null, "exact terminal receipt missing");
    const release = database.prepare(`SELECT sequence,from_state,details_json FROM run_state_history WHERE run_id=?
      AND reason='codex_protocol_park_completed' AND to_state='parked_review'
      AND json_extract(details_json,'$.taskId')=? ORDER BY sequence DESC LIMIT 1`).get(evidence.runId,task.task_id);
    const released = json(release?.details_json);
    requireEvidence(release?.sequence === evidence.releaseSequence && release.from_state === "parked_review" && released.restoredThreadId === null &&
      released.taskId === evidence.taskId && released.threadId === task.thread_id && released.turnId === task.turn_id &&
      released.turnStatus === "completed" && released.failureCode === null, "release receipt changed");
    const archive = database.prepare(`SELECT sequence,from_state,to_state,details_json FROM run_state_history
      WHERE run_id=? AND reason='ci_repair_task_archived' ORDER BY sequence DESC LIMIT 1`).get(evidence.runId);
    const archived = json(archive?.details_json);
    requireEvidence(archive?.sequence === evidence.archiveSequence && archive.from_state === "parked_review" && archive.to_state === "parked_review" &&
      archived.attemptId === evidence.attemptId && archived.attemptNumber === 1 &&
      archived.repairCodexThreadId === task.thread_id && archived.restoredCodexThreadId === evidence.predecessorThreadId,
      "archive/predecessor evidence changed");
    const attention = database.prepare(`SELECT sequence,reason,details_json FROM run_state_history WHERE run_id=?
      AND to_state='needs_attention' AND reason NOT IN ('ci_repair_task_archived','review_fix_task_archived')
      ORDER BY sequence DESC LIMIT 1`).get(evidence.runId);
    const attentionDetail = json(attention?.details_json);
    requireEvidence(attention?.sequence === evidence.attentionSequence && attention.reason === "ci_repair_no_new_head" && attentionDetail.attemptId === attempt.attempt_id &&
      attentionDetail.attemptNumber === 1 && attentionDetail.sourceHeadSha === evidence.sourceSha, "latest attention reason changed");
    const history = database.prepare(`SELECT * FROM run_state_history WHERE run_id=? AND from_state IS NOT to_state
      ORDER BY sequence DESC LIMIT 1`).get(evidence.runId);
    const detail = json(history?.details_json);
    requireEvidence(history?.to_state === run.state && (recovered
      ? history.reason === externalDeliveryReason && history.from_state === "needs_attention" &&
        detail.requestId === evidence.requestId && detail.releaseSequence === evidence.releaseSequence && detail.taskId === task.task_id && detail.attemptId === attempt.attempt_id &&
        detail.sourceHeadSha === evidence.sourceSha && detail.externalHeadSha === evidence.externalSha &&
        detail.deliveryOrigin === "owner_approved_external_fix" && detail.workerProducedHead === false && detail.archiveSequence === archive?.sequence &&
        detail.attentionSequence === attention.sequence && detail.threadId === task.thread_id && detail.turnId === task.turn_id &&
        detail.stoppedAt === task.stopped_at && detail.releasedAt === task.released_at && detail.repairRetry === false
      : history.sequence === attention.sequence && history.reason === "ci_repair_no_new_head" && detail.attemptId === attempt.attempt_id &&
        detail.attemptNumber === 1 && detail.sourceHeadSha === evidence.sourceSha), "latest attention/recovery reason changed");
    for (const [table, condition] of [
      ["run_control_requests", "request_state IN ('pending','queued','processing')"],
      ["run_codex_tasks", "released_at IS NULL"],
      ["run_ai_reviews", "1=1"],
      ["run_review_fix_rounds", "1=1"],
      ["run_autonomous_successions", "succession_state IN ('starting','running')"],
    ]) requireEvidence(!database.prepare(`SELECT 1 FROM ${table} WHERE run_id=? AND ${condition}`).get(evidence.runId), "control or worker conflict");
    requireEvidence(!database.prepare(`SELECT 1 FROM project_events WHERE project=? AND item_id=?
      AND processing_state='pending' AND event_id<>? AND from_status IS NOT to_status`).get(run.project,run.item_id,run.trigger_event_id),
      "pending Project mutation");
    requireEvidence(!database.prepare("SELECT 1 FROM runs WHERE project=? AND item_id=? AND rowid>(SELECT rowid FROM runs WHERE run_id=?)")
      .get(run.project,run.item_id,evidence.runId), "run superseded");
    requireEvidence(!database.prepare(`SELECT 1 FROM run_resources rr JOIN runs r USING(run_id)
      WHERE rr.worktree_path=? AND r.run_id<>? AND (r.owner_state<>'none' OR rr.tmux_session_name IS NOT NULL)`)
      .get(run.worktree_path,evidence.runId), "another run owns worktree");
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
      git("rev-parse","HEAD") === evidence.externalSha && git("rev-parse",`refs/remotes/origin/${evidence.branch}`) === evidence.externalSha,
      "origin/local/tracking SHA changed");
    requireEvidence(command("git",["ls-remote","--exit-code",`https://github.com/${evidence.repository}.git`,`refs/heads/${evidence.branch}`]) ===
      `${evidence.externalSha}\trefs/heads/${evidence.branch}`, "live remote SHA changed");
    const gh = (path: string) => json(command(process.env.GH_BIN?.trim() || "gh",["api","--method","GET",path]));
    const prUrl = `https://github.com/${evidence.repository}/pull/${evidence.pullNumber}`;
    const pull = gh(`repos/${evidence.repository}/pulls/${evidence.pullNumber}`);
    const head = pull.head as { sha?: string; ref?: string; repo?: { full_name?: string } } | undefined;
    const base = pull.base as { sha?: string; ref?: string; repo?: { full_name?: string } } | undefined;
    requireEvidence(pull.number === evidence.pullNumber && pull.html_url === prUrl && pull.state === "open" && pull.merged === false && pull.draft === true &&
      head?.sha === evidence.externalSha && head.ref === evidence.branch && head.repo?.full_name === evidence.repository &&
      base?.ref === project.workspace.base_branch && base.repo?.full_name === evidence.repository, "live PR identity/SHA changed");
    const ci = database.prepare("SELECT * FROM run_ci_snapshots WHERE run_id=?").get(evidence.runId);
    const age = Date.now() - Date.parse(String(ci?.last_observed_at));
    requireEvidence(ci?.repository === evidence.repository && ci.pull_request_number === evidence.pullNumber &&
      ci.pull_request_url === prUrl && ci.head_sha === evidence.externalSha && ci.aggregate_state === "passed" && ci.last_error === null &&
      age >= 0 && age <= 120_000, "fresh passed CI evidence missing");
    let storedChecks: unknown;
    try { storedChecks = JSON.parse(String(ci.checks_json)); }
    catch { throw new Error("External CI recovery refused: invalid checks JSON"); }
    requireEvidence(Array.isArray(storedChecks) && storedChecks.length === externalDeliveryChecks.length,
      "exact six stored checks missing");
    // Read native receipts, not labels or arbitrary links supplied by the snapshot.
    const native = gh(`repos/${evidence.repository}/commits/${evidence.externalSha}/check-runs?per_page=100&filter=latest`);
    requireEvidence(Array.isArray(native.check_runs) && native.total_count === native.check_runs.length &&
      native.check_runs.length < 100, "incomplete native CI evidence");
    for (const name of externalDeliveryChecks) {
      const stored = storedChecks.filter(c => c?.name === name);
      const checks = (native.check_runs as Record<string, unknown>[]).filter(c => c.name === name);
      requireEvidence(stored.length === 1 && stored[0].state === "passed" && stored[0].source === "check_run" &&
        checks.length === 1, "stored/native check set changed");
      const check = checks[0];
      const app = check.app as { slug?: string } | undefined;
      requireEvidence(check.head_sha === evidence.externalSha &&
        app?.slug === "github-actions" && check.status === "completed" && check.conclusion === "success" &&
        typeof check.html_url === "string" &&
        new RegExp(`^https://github\\.com/${evidence.repository}/actions/runs/[0-9]+/job/[0-9]+$`, "u").test(check.html_url) &&
        check.html_url === stored[0].detailsUrl && Number.isFinite(Date.parse(String(check.completed_at))) &&
        Date.parse(String(check.completed_at)) <= Date.parse(String(ci.last_observed_at)), "bad or stale native check receipt");
    }
    assertNoLegacyWriter(worktree,task.session_name);
    const panes = spawnSync("tmux",["list-panes","-a","-F","#{pane_current_path}"],{encoding:"utf8"});
    requireEvidence(panes.status === 1 || (panes.status === 0 && !panes.stdout.split("\n").some(path => path === worktree || path.startsWith(worktree + "/"))),
      "live worktree supervisor or tmux evidence unavailable");
    // Recheck mutable external/local evidence at the write boundary. This is not an
    // external writer lock: operators must keep independent launchers quiescent.
    const finalPull = gh(`repos/${evidence.repository}/pulls/${evidence.pullNumber}`);
    requireEvidence(JSON.stringify(finalPull.head) === JSON.stringify(pull.head) &&
      JSON.stringify(finalPull.base) === JSON.stringify(pull.base) && finalPull.state === "open" &&
      finalPull.merged === false && finalPull.draft === true &&
      git("rev-parse","HEAD") === evidence.externalSha &&
      git("rev-parse",`refs/remotes/origin/${evidence.branch}`) === evidence.externalSha &&
      git("branch","--show-current") === evidence.branch && git("status","--porcelain","--untracked-files=all") === "" &&
      Date.now() - Date.parse(String(ci.last_observed_at)) <= 120_000, "evidence drifted during validation");
    const inspected = { requestId: evidence.requestId, releaseSequence: release!.sequence, taskId: task.task_id, attemptId: attempt.attempt_id, attemptNumber: 1, threadId: task.thread_id,
      turnId: task.turn_id, turnStatus: task.turn_status, stoppedAt: task.stopped_at, releasedAt: task.released_at,
      predecessorThreadId: evidence.predecessorThreadId, archiveSequence: archive!.sequence, attentionSequence: attention.sequence, historySequence: history!.sequence,
      sourceHeadSha: evidence.sourceSha, externalHeadSha: evidence.externalSha, worktree,
      pullRequestNumber: evidence.pullNumber, baseSha: base!.sha, ciObservedAt: ci.last_observed_at,
      deliveryOrigin: "owner_approved_external_fix", workerProducedHead: false,
      evidenceBasis: "allowlisted_archived_no_head_incident_and_native_passed_external_ci",
      repairRetry: false, action: externalDeliveryReason };
    if (apply && !recovered) {
      const changed = database.prepare(`UPDATE runs SET state='parked_review',owner_state='none',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE run_id=? AND state='needs_attention' AND owner_state='none' AND stop_reason IS NULL`).run(evidence.runId);
      requireEvidence(changed.changes === 1, "run changed before recovery");
      appendHistory(database,evidence.runId,"needs_attention","parked_review",externalDeliveryReason,inspected);
    }
    database.exec("COMMIT");
    return { ok: true, apply, alreadyRecovered: recovered, runId: evidence.runId, ...inspected };
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

if (import.meta.main) {
  process.umask(0o077);
  const args = process.argv.slice(2);
  requireEvidence((args.length === 2 || args.length === 3) && args[0] === "--run-id" && args[1] === pf34ExternalEvidence.runId &&
    (args.length === 2 || args[2] === "--apply"), "use --run-id <allowlisted run> [--apply]");
  const home = resolveKuramiHome(resolve(import.meta.dirname,"../../../../.."));
  const config = parse(readFileSync(resolve(home,"config/orchestrator.yaml"),"utf8"));
  requireEvidence(config.mode === "live", "controller is not in live mode");
  const registry = parse(readFileSync(resolve(home,"config/projects.yaml"),"utf8"));
  const apply = args.includes("--apply");
  const database = new DatabaseSync(resolve(home,"state/orchestrator.db"),{readOnly:!apply,timeout:5_000});
  try { process.stdout.write(JSON.stringify(recoverExternalCiDelivery(database,registry.projects.pickflick,apply)) + "\n"); }
  finally { database.close(); }
}

