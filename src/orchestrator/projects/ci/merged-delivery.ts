import { createHash } from "node:crypto";
import { requestProjectPr } from "../../../projects-site/pr-actions.ts";
import { requestProjectStatus } from "../../../projects-site/status.ts";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { SourceProject } from "../worktrees/refresh-source.ts";
import { completeMergedTask, type ProjectConfig } from "../project-status.ts";
import { hasActivePrRequest } from "../../controls/pr-boundary.ts";
import { assertNoWorktreeWriter } from "../sessions/recover-legacy-ci-timeout.ts";

function requireDelivery(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(`Merged delivery refused: ${reason}`);
}

/** Shared with release: cleanup is separate from task acceptance. All managed
 * ownership is fenced by the caller's IMMEDIATE transaction; no source mutation. */
export function validateMergedDeliverySource(
  database: DatabaseSync, project: SourceProject, runId: string, headSha: string,
  noWriter = assertNoWorktreeWriter,
  acceptanceOnly = false,
): void {
  const run = database.prepare(`SELECT r.*, rr.resource_state, rr.worktree_path,
    rr.branch_name, rr.tmux_session_name, rr.previous_codex_thread_id
    FROM runs r JOIN run_resources rr USING(run_id) WHERE run_id=?`).get(runId);
  requireDelivery(run && run.repository === project.repository && run.execution_mode === "live" &&
    (acceptanceOnly || (run.owner_state === "none" && run.tmux_session_name === null &&
    run.previous_codex_thread_id === null)) &&
    run.stop_reason !== "cancelled" &&
    ["provisioned", "releasing"].includes(String(run.resource_state)), "owner/resource fence changed");
  requireDelivery(!database.prepare(`SELECT 1 FROM runs WHERE project=? AND item_id=?
    AND rowid>(SELECT rowid FROM runs WHERE run_id=?)`).get(run.project, run.item_id, runId), "newer run exists");
  requireDelivery(!database.prepare(`SELECT 1 FROM run_control_requests WHERE run_id=?
    AND request_state IN ('pending','processing')`).get(runId), "pending control intent");
  requireDelivery(!hasActivePrRequest(database, runId), "active PR request");
  requireDelivery(!database.prepare(`SELECT 1 FROM project_status_requests WHERE project=? AND item_id=?
    AND request_state IN ('checking','writing','awaiting_sync','uncertain')`).get(run.project, run.item_id), "active Project status request");
  if (!acceptanceOnly) for (const [table, condition] of [
    ["run_ci_repair_attempts", "attempt_state IN ('running','waiting_ci')"],
    ["run_review_fix_rounds", "round_state IN ('running','waiting_ci','resolving')"],
    ["run_ai_reviews", "review_state='running'"],
    ["run_autonomous_successions", "succession_state IN ('starting','running')"],
  ]) requireDelivery(!database.prepare(`SELECT 1 FROM ${table} WHERE run_id=? AND ${condition}`).get(runId), "active worker");
  requireDelivery(run.worktree_path && run.branch_name, "source mapping missing");
  const worktree = String(run.worktree_path);
  requireDelivery(!database.prepare(`SELECT 1 FROM run_resources WHERE worktree_path=? AND run_id<>?
    AND resource_state<>'released'`).get(worktree, runId), "another run owns source");
  if (!acceptanceOnly) requireDelivery(!database.prepare(`SELECT 1 FROM run_codex_tasks WHERE worktree_path=?
    AND released_at IS NULL`).get(worktree), "active protocol task");
  const child = relative(realpathSync(project.workspace.worktree_root), worktree);
  requireDelivery(child && !child.startsWith("..") && realpathSync(worktree) === worktree, "noncanonical worktree boundary");
  const git = (path: string, ...args: string[]): string => execFileSync("git", ["-C", path, ...args], {
    encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdio: ["ignore", "pipe", "pipe"], timeout: 10_000,
  }).trim();
  const common = git(project.workspace.canonical_repository, "rev-parse", "--path-format=absolute", "--git-dir");
  requireDelivery(git(worktree, "rev-parse", "--show-toplevel") === worktree &&
    git(worktree, "rev-parse", "--path-format=absolute", "--git-common-dir") === common &&
    git(worktree, "rev-parse", "--path-format=absolute", "--git-dir").startsWith(common + "/worktrees/"), "wrong canonical repository");
  requireDelivery(git(worktree, "branch", "--show-current") === run.branch_name &&
    git(worktree, "rev-parse", "HEAD") === headSha, "branch/head mismatch");
  if (!acceptanceOnly) {
    requireDelivery(!git(worktree, "status", "--porcelain", "--untracked-files=all"), "dirty source preserved");
    noWriter(worktree);
  }
}

/** Finish only exact existing native receipts. Never start or retry an external writer.
 * Native managers own reconciliation; the acceptance transaction rechecks every gate. */
export async function reconcileMergedDeliveryRequests(database: DatabaseSync, runId: string): Promise<void> {
  const run = database.prepare("SELECT project,item_id FROM runs WHERE run_id=?").get(runId);
  requireDelivery(run, "run missing during native reconciliation");
  const hash = (identity: unknown[]) => createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  // Checking/writing/uncertain operations remain gated, even if another read saw a merge.
  const prs = database.prepare("SELECT * FROM project_pr_requests WHERE run_id=? AND request_state='pending'").all(runId);
  for (const row of prs) {
    requireDelivery(row.project === run.project && row.item_id === run.item_id &&
      row.idempotency_key === hash([row.actor_subject,row.project,row.item_id,row.action,row.client_key]),
      "native PR request identity changed");
    const result = await requestProjectPr({project:row.project,itemId:row.item_id,action:row.action,
      head:row.head_sha,fingerprint:row.fingerprint,key:row.client_key,method:row.merge_method,
      confirmed:true,checkOnly:true}, String(row.actor_subject));
    requireDelivery(result.requestId === row.request_id, "native PR receipt changed");
  }
  const statuses = database.prepare(`SELECT * FROM project_status_requests
    WHERE project=? AND item_id=? AND request_state='awaiting_sync'`).all(run.project,run.item_id);
  for (const row of statuses) {
    requireDelivery(row.idempotency_key === "projects-status:" +
      hash([row.actor_subject,row.project,row.item_id,row.from_status,row.to_status,row.client_key]),
      "native status request identity changed");
    const result = await requestProjectStatus({project:row.project,itemId:row.item_id,from:row.from_status,
      target:row.to_status,key:row.client_key,observedAt:row.created_at}, String(row.actor_subject), {checkOnly:true});
    requireDelivery(result.requestId === row.request_id, "native status receipt changed");
  }
}

export async function requestMergedDeliveryCompletion(
  database: DatabaseSync, project: SourceProject & ProjectConfig, runId: string,
  evidence: { number: number; url: string; headSha: string; mergedAt: string; mergeCommitSha: string | null },
): Promise<{ action: string; reason?: string }> {
  let accepted = false;
  try {
    await reconcileMergedDeliveryRequests(database, runId);
    database.exec("BEGIN IMMEDIATE");
    requireDelivery(Number.isFinite(Date.parse(evidence.mergedAt)), "verified merge timestamp missing");
    const run = database.prepare("SELECT * FROM runs WHERE run_id=?").get(runId);
    // Cancellation and superseded/terminal runs are never accepted by a stale observation.
    requireDelivery(run && ["starting", "running", "handoff_pending", "waiting_human", "remote_owned", "parked_review", "needs_attention"].includes(String(run.state)) &&
      (run.stop_reason === null || run.stop_reason === "completed"), "run is not an active managed delivery");
    const ci = database.prepare("SELECT * FROM run_ci_snapshots WHERE run_id=?").get(runId);
    requireDelivery(ci?.pull_request_number === evidence.number && ci.pull_request_url === evidence.url &&
      ci.head_sha === evidence.headSha, "exact CI/PR evidence missing");
    requireDelivery(ci.repository === project.repository, "CI repository mismatch");
    const event = database.prepare("SELECT * FROM project_events WHERE event_id=?").get(run.trigger_event_id);
    requireDelivery(event?.content_type === "Issue" && event.project === run.project &&
      event.item_id === run.item_id && event.content_id === run.content_id &&
      event.repository === run.repository && event.issue_number === run.issue_number,
      "associated task identity changed");
    validateMergedDeliverySource(database, project, runId, evidence.headSha, assertNoWorktreeWriter, true);
    completeMergedTask(database, project, runId);
    database.prepare(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
      SELECT ?,?,?, 'merged_task_accepted',? WHERE NOT EXISTS (
        SELECT 1 FROM run_state_history WHERE run_id=? AND reason='merged_task_accepted'
          AND json_extract(details_json,'$.headSha')=?
          AND json_extract(details_json,'$.number')=? AND json_extract(details_json,'$.url')=?)`)
      .run(runId, run.state, run.state, JSON.stringify({ ...evidence, repository: run.repository, itemId: run.item_id, issueNumber: run.issue_number,
        baseBranch: project.workspace.base_branch, issueAcceptance: "completed", previewWaiver: "verified_merge" }), runId, evidence.headSha, evidence.number, evidence.url);
    database.exec("COMMIT");
    accepted = true;
    // Acceptance survives a blocked resource release. Never manufacture Preview evidence.
    database.exec("BEGIN IMMEDIATE");
    const currentCi = database.prepare("SELECT * FROM run_ci_snapshots WHERE run_id=?").get(runId);
    requireDelivery(currentCi?.repository === project.repository && currentCi.head_sha === evidence.headSha &&
      currentCi.pull_request_number === evidence.number && currentCi.pull_request_url === evidence.url &&
      currentCi.aggregate_state === "passed", "exact CI has not passed; cleanup retained");
    const current = database.prepare("SELECT state,stop_reason FROM runs WHERE run_id=?").get(runId)!;
    requireDelivery(["parked_review", "needs_attention"].includes(String(current.state)) &&
      current.stop_reason !== "cancelled", "active run retained until its owner/worker parks");
    validateMergedDeliverySource(database, project, runId, evidence.headSha);
    // completion_requested_at/source_event_id belong to a real Project Done event.
    // Merge has its own audited provenance below; do not fabricate that event.
    database.prepare(`UPDATE runs SET state='stopping', stop_reason='completed',
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id=?`).run(runId);
    database.prepare(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
      VALUES(?,?,'stopping','merged_delivery_completion_requested',?)`)
      .run(runId, run.state, JSON.stringify({ ...evidence, issueAcceptance: "completed", previewWaiver: "verified_merge" }));
    database.exec("COMMIT");
    return { action: "merged_delivery_cleanup_requested" };
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    const reason = error instanceof Error ? error.message : String(error);
    if (accepted) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const current = database.prepare("SELECT state FROM runs WHERE run_id=?").get(runId)!;
        const changed = database.prepare(`UPDATE runs SET state='needs_attention',stop_reason='completed'
          WHERE run_id=? AND state IN ('parked_review','needs_attention')
            AND (stop_reason IS NULL OR stop_reason='completed')
            AND NOT EXISTS (SELECT 1 FROM runs newer WHERE newer.project=runs.project
              AND newer.item_id=runs.item_id AND newer.rowid>runs.rowid)`).run(runId);
        database.prepare(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
          VALUES(?,?,?,'merged_delivery_cleanup_blocked',?)`)
          .run(runId, current.state, changed.changes === 1 ? "needs_attention" : current.state,
            JSON.stringify({ ...evidence, reason, issueAcceptance: "completed" }));
        database.exec("COMMIT");
      } catch (failure) { database.exec("ROLLBACK"); throw failure; }
    }
    // Retry requires a fresh exact merged-PR observation; never spoof a Done event.
    return { action: accepted ? "merged_task_accepted_cleanup_retained" : "merged_delivery_retained", reason };
  }
}
