import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { resolveKuramiHome } from "../../../core/kurami-home.ts";
import { loadOwnerGitHubTokenFromFile } from "../../integrations/github/app-auth.ts";
import { openOrchestratorDatabase } from "../../state/database.ts";
import { LATEST_ATTENTION_VALUE_SQL } from "../../runtime/run-projections.ts";
import { hasActivePrRequest } from "../../controls/pr-boundary.ts";
import { ownerSourceEffects, refreshManagedSource, type SourceEffects } from "../worktrees/refresh-source.ts";
import { cleanupReviewFixSession } from "./manager.ts";
import { loadReviewFixContext } from "./session-start.ts";
import { reviewFixPrompt } from "./prompts.ts";
import { appendHistory, git, loadRun } from "./session-shared.ts";
import type { ProjectsRegistry } from "./session-types.ts";

type RetryEffects = {
  source: SourceEffects;
  capture: typeof loadReviewFixContext;
  cleanup: typeof cleanupReviewFixSession;
};

function requireRetry(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(`Review fix retry preparation refused: ${reason}`);
}

/** Only a completed, released, no-new-head round may be rearmed. The old round
 * and its evidence remain immutable; the next owner request captures new scope. */
function inspectLocal(database: DatabaseSync, runId: string) {
  const run = loadRun(database, runId);
  const attention = database.prepare(`SELECT ${LATEST_ATTENTION_VALUE_SQL} AS reason
    FROM runs r WHERE run_id=?`).get(runId);
  requireRetry(attention?.reason === "review_fix_no_new_head", "another attention cause must be handled first");
  const round = database.prepare(`SELECT * FROM run_review_fix_rounds
    WHERE run_id=? ORDER BY round_number DESC LIMIT 1`).get(runId);
  requireRetry(run.run_state === "needs_attention" && run.owner_state === "none" &&
    run.execution_mode === "live" && run.resource_state === "provisioned" &&
    run.stop_reason === null && run.tmux_session_name === null &&
    run.worktree_path && run.branch_name && run.codex_thread_id,
  "run ownership or resources changed");
  requireRetry(round?.round_state === "needs_attention" &&
    round.failure_reason === "review_fix_no_new_head" && round.result_head_sha === null &&
    round.codex_thread_id && round.repository === run.repository,
  "latest round is not a stopped no-edit round");
  const task = database.prepare(`SELECT * FROM run_codex_tasks WHERE run_id=?
    AND kind='review_fix' AND context_id=? ORDER BY rowid DESC LIMIT 1`).get(runId, round.round_id!);
  requireRetry(task && task.phase === "terminal" && task.turn_status === "completed" &&
    task.failure_code === null && [null, "release"].includes(task.stop_requested as null | string) &&
    task.stopped_at && task.released_at && task.thread_id === round.codex_thread_id &&
    task.worktree_path === run.worktree_path && task.branch_name === run.branch_name &&
    database.prepare(`SELECT 1 FROM run_codex_task_events WHERE task_id=?
      AND method='turn/completed' AND thread_id=? AND turn_id=? AND status='completed'
      AND failure_code IS NULL`).get(task.task_id!, task.thread_id!, task.turn_id!),
  "exact completed and released worker receipt is missing");
  const cleanup = database.prepare(`SELECT * FROM run_review_fix_operations
    WHERE round_id=? AND operation_kind='cleanup'`).get(round.round_id!);
  const originalMapping = run.codex_thread_id === round.codex_thread_id && Boolean(run.previous_codex_thread_id);
  const restoredMapping = cleanup?.operation_state === "completed" &&
    cleanup.task_codex_thread_id === round.codex_thread_id &&
    cleanup.previous_codex_thread_id === run.codex_thread_id && run.previous_codex_thread_id === null;
  requireRetry(originalMapping || restoredMapping, "stopped task mapping changed");
  requireRetry(!database.prepare(`SELECT 1 FROM run_control_requests WHERE run_id=?
    AND request_state IN ('pending','processing')`).get(runId) && !hasActivePrRequest(database, runId),
  "a control request is active");
  requireRetry(!database.prepare(`SELECT 1 FROM run_codex_tasks WHERE
    (run_id=? OR worktree_path=?) AND released_at IS NULL`).get(runId, run.worktree_path),
  "another protocol worker is active");
  requireRetry(!database.prepare(`SELECT 1 FROM preview_leases p JOIN run_resources rr USING(run_id)
    WHERE rr.worktree_path=? AND p.state<>'released'`).get(run.worktree_path), "preview lease is active");
  requireRetry(git(run.worktree_path, ["rev-parse", "HEAD"]) === round.source_head_sha &&
    git(run.worktree_path, ["status", "--porcelain", "--untracked-files=all"]) === "",
  "local changes or a different head must be preserved");
  return { run, round, originalMapping,
    fingerprint: createHash("sha256").update(JSON.stringify({ run, round, task, cleanup })).digest("hex") };
}

export async function prepareReviewFixRetry(database: DatabaseSync, runId: string,
  registry: ProjectsRegistry, apply: boolean, supplied?: RetryEffects): Promise<object> {
  const home = resolveKuramiHome(resolve(import.meta.dirname, "../../../../.."));
  const effects = supplied ?? { source: ownerSourceEffects(await loadOwnerGitHubTokenFromFile(home)),
    capture: loadReviewFixContext, cleanup: cleanupReviewFixSession };
  const inspect = async () => {
    const local = inspectLocal(database, runId);
    const project = registry.projects[local.run.project];
    requireRetry(project, "project mapping is missing");
    refreshManagedSource(database, project, runId, "review_fix_retry_prepare",
      String(local.round.request_id), false, effects.source);
    const context = await effects.capture(database, local.run, project, String(local.round.request_id), "applied");
    requireRetry(context.sourceHeadSha === local.round.source_head_sha &&
      context.pullRequestNumber === local.round.pull_request_number &&
      context.pullRequestUrl === local.round.pull_request_url, "PR identity changed");
    // This validates the actual serialized prompt budget, not an approximate body count.
    reviewFixPrompt(local.run, context);
    requireRetry(inspectLocal(database, runId).fingerprint === local.fingerprint,
      "local task identity changed while capturing current review evidence");
    return { ...local, context };
  };
  let ready = await inspect();
  if (apply) {
    if (ready.originalMapping) await effects.cleanup(database, ready.run, registry, true);
    ready = await inspect();
    database.exec("BEGIN IMMEDIATE");
    try {
      requireRetry(inspectLocal(database, runId).fingerprint === ready.fingerprint,
        "task changed before retry preparation claim");
      effects.source.noWriter(ready.run.worktree_path!);
      const changed = database.prepare(`UPDATE runs SET state='parked_review',
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE run_id=? AND state='needs_attention' AND owner_state='none' AND stop_reason IS NULL`).run(runId);
      requireRetry(changed.changes === 1, "run changed before retry preparation");
      appendHistory(database, runId, "needs_attention", "parked_review", "review_fix_retry_prepared", {
        sourceRoundId: ready.round.round_id, sourceTaskThreadId: ready.round.codex_thread_id,
        sourceHeadSha: ready.context.sourceHeadSha,
        evidenceDigest: createHash("sha256").update(JSON.stringify(ready.context)).digest("hex"),
        threads: ready.context.threads.length, summaryFindings: ready.context.summaryOnlyFindings.length,
      });
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  }
  return { ok: true, apply, action: "prepare_review_fix_retry", runId,
    sourceRoundId: ready.round.round_id, sourceHeadSha: ready.context.sourceHeadSha,
    threads: ready.context.threads.length, summaryFindings: ready.context.summaryOnlyFindings.length,
    writerStarted: false, nextAction: "Request Fix findings to capture current evidence in a new managed round." };
}

if (import.meta.main) {
  const args = process.argv.slice(2), runId = args[1];
  if (args[0] !== "--run-id" || !/^r_[a-zA-Z0-9_]+$/u.test(runId ?? "") ||
    args.slice(2).some(arg => arg !== "--apply") || args.length > 3)
    throw new Error("Usage: prepare-review-fix-retry.ts --run-id <run_id> [--apply]");
  const home = resolveKuramiHome(resolve(import.meta.dirname, "../../../../.."));
  const apply = args.includes("--apply");
  const config = parse(await readFile(resolve(home, "config/orchestrator.yaml"), "utf8")) as {version:number;mode:string};
  requireRetry(config.version === 1 && (!apply || config.mode === "live"), "live controller mode is required to apply preparation");
  const database = apply
    ? openOrchestratorDatabase(resolve(home, "state/orchestrator.db"), {timeoutMs:1000})
    : new DatabaseSync(resolve(home, "state/orchestrator.db"), { readOnly: true, timeout:1000 });
  try {
    const registry = parse(await readFile(resolve(home, "config/projects.yaml"), "utf8")) as ProjectsRegistry;
    console.log(JSON.stringify(await prepareReviewFixRetry(database, runId!, registry, apply)));
  } finally { database.close(); }
}
