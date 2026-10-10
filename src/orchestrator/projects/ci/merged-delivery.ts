import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { SourceProject } from "../worktrees/refresh-source.ts";
import { assertNoWorktreeWriter } from "../sessions/recover-legacy-ci-timeout.ts";

function requireDelivery(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(`Merged delivery refused: ${reason}`);
}

/** Shared with release: GitHub delivery is not issue acceptance. All managed
 * ownership is fenced by the caller's IMMEDIATE transaction; no source mutation. */
export function validateMergedDeliverySource(
  database: DatabaseSync, project: SourceProject, runId: string, headSha: string,
  noWriter = assertNoWorktreeWriter,
): void {
  const run = database.prepare(`SELECT r.*, rr.resource_state, rr.worktree_path,
    rr.branch_name, rr.tmux_session_name, rr.previous_codex_thread_id
    FROM runs r JOIN run_resources rr USING(run_id) WHERE run_id=?`).get(runId);
  requireDelivery(run && run.repository === project.repository && run.execution_mode === "live" &&
    run.owner_state === "none" && run.tmux_session_name === null &&
    run.previous_codex_thread_id === null &&
    ["provisioned", "releasing"].includes(String(run.resource_state)), "owner/resource fence changed");
  requireDelivery(!database.prepare(`SELECT 1 FROM runs WHERE project=? AND item_id=?
    AND rowid>(SELECT rowid FROM runs WHERE run_id=?)`).get(run.project, run.item_id, runId), "newer run exists");
  requireDelivery(!database.prepare(`SELECT 1 FROM run_control_requests WHERE run_id=?
    AND request_state IN ('pending','processing')`).get(runId), "pending control intent");
  for (const [table, condition] of [
    ["run_ci_repair_attempts", "attempt_state IN ('running','waiting_ci')"],
    ["run_review_fix_rounds", "round_state IN ('running','waiting_ci','resolving')"],
    ["run_ai_reviews", "review_state='running'"],
    ["run_autonomous_successions", "succession_state IN ('starting','running')"],
  ]) requireDelivery(!database.prepare(`SELECT 1 FROM ${table} WHERE run_id=? AND ${condition}`).get(runId), "active worker");
  requireDelivery(run.worktree_path && run.branch_name, "source mapping missing");
  const worktree = String(run.worktree_path);
  requireDelivery(!database.prepare(`SELECT 1 FROM run_resources WHERE worktree_path=? AND run_id<>?
    AND resource_state<>'released'`).get(worktree, runId), "another run owns source");
  requireDelivery(!database.prepare(`SELECT 1 FROM run_codex_tasks WHERE worktree_path=?
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
  requireDelivery(!git(worktree, "status", "--porcelain", "--untracked-files=all"), "dirty source preserved");
  noWriter(worktree);
}

export function requestMergedDeliveryCompletion(
  database: DatabaseSync, project: SourceProject, runId: string,
  evidence: { number: number; url: string; headSha: string },
): { action: string; reason?: string } {
  database.exec("BEGIN IMMEDIATE");
  try {
    const run = database.prepare("SELECT * FROM runs WHERE run_id=?").get(runId);
    // Cancellation, human Remote ownership and terminal states are never stolen.
    requireDelivery(run?.state === "parked_review" && run.stop_reason === null, "run is not quiescent review");
    const ci = database.prepare("SELECT * FROM run_ci_snapshots WHERE run_id=?").get(runId);
    requireDelivery(ci?.pull_request_number === evidence.number && ci.pull_request_url === evidence.url &&
      ci.head_sha === evidence.headSha && ci.aggregate_state === "passed", "exact CI/PR evidence missing");
    if (run.preview_required === 1) {
      requireDelivery(database.prepare(`SELECT 1 FROM preview_leases WHERE run_id=?
        AND verified_head_sha=? AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
        AND reviewed_via IS NOT NULL AND state IN ('running','released')`)
        .get(runId, evidence.headSha), "owner-reviewed exact preview required");
    }
    validateMergedDeliverySource(database, project, runId, evidence.headSha);
    // completion_requested_at/source_event_id belong to a real Project Done event.
    // Merge has its own audited provenance below; do not fabricate that event.
    database.prepare(`UPDATE runs SET state='stopping', stop_reason='completed',
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id=?`).run(runId);
    database.prepare(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
      VALUES(?,'parked_review','stopping','merged_delivery_completion_requested',?)`)
      .run(runId, JSON.stringify({ ...evidence, issueAcceptance: "unchanged" }));
    database.exec("COMMIT");
    return { action: "merged_delivery_cleanup_requested" };
  } catch (error) {
    database.exec("ROLLBACK");
    // Retry only by observing the live merged PR again, never by spoofing Done.
    return { action: "merged_delivery_retained", reason: error instanceof Error ? error.message : String(error) };
  }
}
