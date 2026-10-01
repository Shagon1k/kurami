import { spawnSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { transcriptHasCompletedTurn } from "./codex-terminal.ts";

export const reviewFixUncommittedChangesReason =
  "review_fix_uncommitted_changes";
export const managedRecoveryCiMaxAgeMs = 2 * 60 * 1_000;

export type ManagedReviewFixRecoverySnapshot = {
  protocolCompleted?: number;
  protocolPresent?: number;
  runId: string;
  repository: string;
  runState: string;
  ownerState: string;
  stopReason: string | null;
  executionMode: string;
  resourceState: string;
  worktreePath: string | null;
  branchName: string | null;
  tmuxSessionName: string | null;
  codexThreadId: string | null;
  previousCodexThreadId: string | null;
  latestAttentionReason: string | null;
  latestAttentionDetailsJson: string | null;
  roundId: string | null;
  roundState: string | null;
  roundRepository: string | null;
  roundPullRequestNumber: number | null;
  roundPullRequestUrl: string | null;
  roundSourceHeadSha: string | null;
  roundCodexThreadId: string | null;
  roundFailureReason: string | null;
  roundRequestAction: string | null;
  roundRequestState: string | null;
  matchingRoundCount: number;
  otherPendingControlCount: number;
  activeRepairCount: number;
  activeReviewCount: number;
  activeReviewFixCount: number;
  ciRepository: string | null;
  ciPullRequestNumber: number | null;
  ciPullRequestUrl: string | null;
  ciHeadSha: string | null;
  ciAggregateState: string | null;
  ciLastObservedAt: string | null;
  ciLastError: string | null;
};

export type ManagedReviewFixRecoveryProject = {
  repository: string;
  workspace: { worktree_root: string };
};

export type ManagedReviewFixRecoveryInspection =
  | {
      eligible: true;
      roundId: string;
      headSha: string;
      targetRoundState: "waiting_ci" | "resolving";
    }
  | { eligible: false; reason: string };

export function loadManagedReviewFixRecoverySnapshot(
  database: DatabaseSync,
  runId: string,
  ignoredRequestId: string | null = null,
): ManagedReviewFixRecoverySnapshot | null {
  const hasProtocolStore = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE name='run_codex_tasks'").get());
  const protocolSelect = hasProtocolStore
    ? `EXISTS(SELECT 1 FROM run_codex_tasks ct WHERE ct.run_id=r.run_id
                AND ct.kind='review_fix' AND ct.context_id=f.round_id
                AND ct.session_name=rr.tmux_session_name AND ct.thread_id=f.codex_thread_id
                AND ct.worktree_path=rr.worktree_path AND ct.branch_name=rr.branch_name
                AND ct.turn_id IS NOT NULL AND ct.turn_status='completed' AND ct.failure_code IS NULL
                AND ct.stopped_at IS NOT NULL AND ct.released_at IS NULL)` : "0";
  const row = database
    .prepare(
      `SELECT ${protocolSelect} AS protocolCompleted,
              ${hasProtocolStore ? "EXISTS(SELECT 1 FROM run_codex_tasks ct WHERE ct.run_id=r.run_id AND ct.session_name=rr.tmux_session_name)" : "0"} AS protocolPresent,
              r.run_id AS runId, r.repository,
              r.state AS runState, r.owner_state AS ownerState,
              r.stop_reason AS stopReason, r.execution_mode AS executionMode,
              rr.resource_state AS resourceState,
              rr.worktree_path AS worktreePath, rr.branch_name AS branchName,
              rr.tmux_session_name AS tmuxSessionName,
              rr.codex_thread_id AS codexThreadId,
              rr.previous_codex_thread_id AS previousCodexThreadId,
              (SELECT h.reason FROM run_state_history h
               WHERE h.run_id=r.run_id AND h.to_state='needs_attention'
                 AND h.reason NOT IN (
                   'review_fix_task_archived', 'ci_repair_task_archived'
                 )
               ORDER BY h.sequence DESC LIMIT 1) AS latestAttentionReason,
              (SELECT h.details_json FROM run_state_history h
               WHERE h.run_id=r.run_id AND h.to_state='needs_attention'
                 AND h.reason NOT IN (
                   'review_fix_task_archived', 'ci_repair_task_archived'
                 )
               ORDER BY h.sequence DESC LIMIT 1) AS latestAttentionDetailsJson,
              f.round_id AS roundId, f.round_state AS roundState,
              f.repository AS roundRepository,
              f.pull_request_number AS roundPullRequestNumber,
              f.pull_request_url AS roundPullRequestUrl,
              f.source_head_sha AS roundSourceHeadSha,
              f.codex_thread_id AS roundCodexThreadId,
              f.failure_reason AS roundFailureReason,
              fq.action AS roundRequestAction,
              fq.request_state AS roundRequestState,
              (SELECT COUNT(*) FROM run_review_fix_rounds unique_fix
               WHERE unique_fix.run_id=r.run_id
                 AND unique_fix.round_state='needs_attention'
                 AND unique_fix.failure_reason=?) AS matchingRoundCount,
              (SELECT COUNT(*) FROM run_control_requests pending
               WHERE pending.run_id=r.run_id
                 AND pending.request_state IN ('pending','processing')
                 AND (? IS NULL OR pending.request_id<>?)) AS otherPendingControlCount,
              (SELECT COUNT(*) FROM run_ci_repair_attempts repair
               WHERE repair.run_id=r.run_id
                 AND repair.attempt_state IN ('running','waiting_ci')) AS activeRepairCount,
              (SELECT COUNT(*) FROM run_ai_reviews review
               WHERE review.run_id=r.run_id AND review.review_state='running') AS activeReviewCount,
              (SELECT COUNT(*) FROM run_review_fix_rounds active_fix
               WHERE active_fix.run_id=r.run_id
                 AND active_fix.round_state IN ('running','waiting_ci','resolving')) AS activeReviewFixCount,
              ci.repository AS ciRepository,
              ci.pull_request_number AS ciPullRequestNumber,
              ci.pull_request_url AS ciPullRequestUrl,
              ci.head_sha AS ciHeadSha,
              ci.aggregate_state AS ciAggregateState,
              ci.last_observed_at AS ciLastObservedAt,
              ci.last_error AS ciLastError
       FROM runs r
       JOIN run_resources rr USING (run_id)
       LEFT JOIN run_review_fix_rounds f ON f.round_id=(
         SELECT latest_fix.round_id FROM run_review_fix_rounds latest_fix
         WHERE latest_fix.run_id=r.run_id
         ORDER BY latest_fix.round_number DESC LIMIT 1
       )
       LEFT JOIN run_control_requests fq ON fq.request_id=f.request_id
       LEFT JOIN run_ci_snapshots ci USING (run_id)
       WHERE r.run_id=?`,
    )
    .get(
      reviewFixUncommittedChangesReason,
      ignoredRequestId,
      ignoredRequestId,
      runId,
    ) as ManagedReviewFixRecoverySnapshot | undefined;
  return row ?? null;
}

function reject(reason: string): ManagedReviewFixRecoveryInspection {
  return { eligible: false, reason };
}

function command(
  executable: string,
  args: string[],
): { ok: boolean; stdout: string } {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { ok: result.status === 0, stdout: result.stdout.trim() };
}

function git(worktreePath: string, args: string[]): string | null {
  const result = command("git", ["-C", worktreePath, ...args]);
  return result.ok ? result.stdout : null;
}

function repositoryFromRemote(remote: string): string | null {
  const normalized = remote.trim().replace(/\.git$/u, "");
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+)$/iu.exec(
    normalized,
  );
  return match?.[1] ?? null;
}

export function inspectManagedReviewFixRecovery(
  run: ManagedReviewFixRecoverySnapshot,
  project: ManagedReviewFixRecoveryProject | undefined,
  now = Date.now(),
): ManagedReviewFixRecoveryInspection {
  if (!project || project.repository.toLowerCase() !== run.repository.toLowerCase())
    return reject("project_repository_mismatch");
  if (
    run.runState !== "needs_attention" ||
    run.ownerState !== "cli" ||
    run.executionMode !== "live" ||
    run.resourceState !== "provisioned"
  )
    return reject("run_not_live_provisioned_cli_attention");
  if (run.stopReason !== null) return reject("stop_or_cancellation_present");
  if (
    run.latestAttentionReason !== reviewFixUncommittedChangesReason ||
    run.roundState !== "needs_attention" ||
    run.roundFailureReason !== reviewFixUncommittedChangesReason ||
    run.matchingRoundCount !== 1 ||
    !run.roundId
  )
    return reject("preserved_review_fix_not_unique");
  if (
    run.roundRequestAction !== "review_fix" ||
    run.roundRequestState !== "applied" ||
    run.otherPendingControlCount !== 0 ||
    run.activeRepairCount !== 0 ||
    run.activeReviewCount !== 0 ||
    run.activeReviewFixCount !== 0
  )
    return reject("control_or_worker_conflict");
  if (
    !run.codexThreadId ||
    !run.previousCodexThreadId ||
    run.roundCodexThreadId !== run.codexThreadId
  )
    return reject("preserved_task_identity_mismatch");
  let attentionDetails: Record<string, unknown>;
  try {
    attentionDetails = JSON.parse(run.latestAttentionDetailsJson ?? "null") as Record<
      string,
      unknown
    >;
  } catch {
    return reject("preserved_attention_evidence_invalid");
  }
  if (
    !attentionDetails ||
    attentionDetails.roundId !== run.roundId ||
    attentionDetails.sourceHeadSha !== run.roundSourceHeadSha ||
    attentionDetails.codexThreadId !== run.codexThreadId ||
    attentionDetails.previousCodexThreadId !== run.previousCodexThreadId
  )
    return reject("preserved_attention_evidence_mismatch");
  if (
    !run.worktreePath ||
    !run.branchName ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(run.branchName) ||
    run.branchName.includes("..")
  )
    return reject("managed_worktree_mapping_invalid");
  const worktreeRoot = resolve(project.workspace.worktree_root);
  const worktreePath = resolve(run.worktreePath);
  const relativePath = relative(worktreeRoot, worktreePath);
  try {
    if (
      !relativePath ||
      relativePath.startsWith("..") ||
      resolve(worktreeRoot, relativePath) !== worktreePath ||
      !statSync(worktreePath).isDirectory() ||
      realpathSync(worktreePath) !== worktreePath
    )
      return reject("managed_worktree_boundary_mismatch");
  } catch {
    return reject("managed_worktree_unavailable");
  }
  if (git(worktreePath, ["rev-parse", "--show-toplevel"]) !== worktreePath)
    return reject("managed_worktree_identity_mismatch");
  if (git(worktreePath, ["branch", "--show-current"]) !== run.branchName)
    return reject("managed_branch_mismatch");
  if (git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]) !== "")
    return reject("post_commit_worktree_dirty");
  const headSha = git(worktreePath, ["rev-parse", "HEAD"]);
  if (!headSha || !run.roundSourceHeadSha || headSha === run.roundSourceHeadSha)
    return reject("head_did_not_advance");
  if (
    !command("git", [
      "-C",
      worktreePath,
      "merge-base",
      "--is-ancestor",
      run.roundSourceHeadSha,
      headSha,
    ]).ok
  )
    return reject("source_head_not_ancestor");
  const origin = git(worktreePath, ["remote", "get-url", "origin"]);
  if (
    !origin ||
    repositoryFromRemote(origin)?.toLowerCase() !== run.repository.toLowerCase()
  )
    return reject("origin_repository_mismatch");
  if (
    git(worktreePath, ["rev-parse", `refs/remotes/origin/${run.branchName}`]) !==
    headSha
  )
    return reject("remote_branch_head_mismatch");
  const expectedPullUrl = `https://github.com/${run.repository}/pull/${run.roundPullRequestNumber}`;
  if (
    run.roundRepository?.toLowerCase() !== run.repository.toLowerCase() ||
    run.ciRepository?.toLowerCase() !== run.repository.toLowerCase() ||
    !run.roundPullRequestNumber ||
    run.ciPullRequestNumber !== run.roundPullRequestNumber ||
    run.roundPullRequestUrl !== expectedPullUrl ||
    run.ciPullRequestUrl !== expectedPullUrl ||
    run.ciHeadSha !== headSha ||
    !["pending", "passed"].includes(run.ciAggregateState ?? "") ||
    run.ciLastError !== null
  )
    return reject("exact_pull_request_or_ci_head_mismatch");
  const observedAt = Date.parse(run.ciLastObservedAt ?? "");
  if (
    !Number.isFinite(observedAt) ||
    observedAt > now ||
    now - observedAt > managedRecoveryCiMaxAgeMs
  )
    return reject("ci_observation_not_fresh");
  if (run.protocolPresent) {
    if (!run.protocolCompleted) return reject("managed_task_has_no_exact_protocol_completion");
  } else {
    if (
      !run.tmuxSessionName ||
      !/^cx-[a-z0-9-]+$/u.test(run.tmuxSessionName) ||
      !command("tmux", ["has-session", "-t", `=${run.tmuxSessionName}`]).ok
    )
      return reject("managed_session_dead_or_invalid");
    const sessionRunId = command("tmux", [
      "show-environment",
      "-t",
      `=${run.tmuxSessionName}`,
      "HERMES_RUN_ID",
    ]);
    const sessionWorktree = command("tmux", [
      "show-environment",
      "-t",
      `=${run.tmuxSessionName}`,
      "HERMES_WORKTREE_PATH",
    ]);
    if (
      !sessionRunId.ok ||
      sessionRunId.stdout !== `HERMES_RUN_ID=${run.runId}` ||
      !sessionWorktree.ok ||
      sessionWorktree.stdout !== `HERMES_WORKTREE_PATH=${worktreePath}`
    )
      return reject("managed_session_identity_ambiguous");
    const panePath = command("tmux", [
      "display-message",
      "-p",
      "-t",
      `${run.tmuxSessionName}:0.0`,
      "#{pane_current_path}",
    ]);
    if (!panePath.ok || resolve(panePath.stdout) !== worktreePath)
      return reject("managed_session_worktree_ambiguous");
    const transcript = command("tmux", [
      "capture-pane",
      "-p",
      "-J",
      "-t",
      `${run.tmuxSessionName}:0.0`,
      "-S",
      "-200",
    ]);
    if (!transcript.ok || !transcriptHasCompletedTurn(transcript.stdout))
      return reject("managed_session_not_terminal_or_approval_blocked");
  }
  return {
    eligible: true,
    roundId: run.roundId,
    headSha,
    targetRoundState:
      run.ciAggregateState === "passed" ? "resolving" : "waiting_ci",
  };
}
