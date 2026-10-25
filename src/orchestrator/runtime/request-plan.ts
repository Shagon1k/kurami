import { isFailedAutonomousSuccessorRecovery, isNeedsAttentionCliHandoff } from "./recovery.ts";
import { previewNeedsExtension, type RunRow } from "./run-read-model.ts";

export type RequestRow = RunRow & {
  request_id: string;
  requested_review_active_count?: number;
  requested_action:
    | "take_control"
    | "preview_start"
    | "preview_stop"
    | "stop"
    | "discard_local"
    | "discard_published"
    | "ci_repair"
    | "ai_review"
    | "review_fix"
    | "recover_interrupted_review_fix"
    | "retry"
    | "recover_managed_task";
};

export type ControllerAction =
  | "provision"
  | "start"
  | "successor_start"
  | "repair_start"
  | "repair_cleanup"
  | "review_start"
  | "review_fix_start"
  | "review_fix_resolve"
  | "review_fix_cleanup"
  | "recover_interrupted_review_fix"
  | "retry"
  | "recover_managed_task"
  | "sync"
  | "cancel_cli"
  | "park"
  | "handoff"
  | "claim_remote"
  | "preview_allocate"
  | "preview_up"
  | "preview_down"
  | "preview_expire"
  | "preview_extend"
  | "preview_requirement_complete"
  | "request_stop"
  | "resume_stop"
  | "request_complete"
  | "request_reject"
  | "release"
  | "discard_cancelled"
  | "discard_published_cancelled"
  | "project_backlog"
  | "project_review";

export type PlannedAction = {
  action: ControllerAction;
  runId: string;
  project: string;
  issueNumber: number;
  requestId?: string;
  roundId?: string;
  command?: string;
  reason?: string;
  requestOutcome?: "applied" | "rejected";
};

export function planForRequest(
  request: RequestRow,
  config: { limits: { preview_expiry_warning_hours: number } },
): PlannedAction {
  const base = {
    runId: request.run_id,
    project: request.project,
    issueNumber: request.issue_number,
    requestId: request.request_id,
  };
  const recovery = {
    runState: request.run_state,
    ownerState: request.owner_state,
    executionMode: request.execution_mode,
    resourceState: request.resource_state,
    worktreePath: request.worktree_path,
    branchName: request.branch_name,
    tmuxSessionName: request.tmux_session_name,
    codexThreadId: request.codex_thread_id,
    previousCodexThreadId: request.previous_codex_thread_id,
    latestAttentionReason: request.latest_attention_reason,
    latestSuccessorState: request.latest_autonomous_successor_state,
    latestSuccessorPredecessorThreadId:
      request.latest_autonomous_successor_predecessor_thread_id,
    autonomousSuccessorActive: request.autonomous_successor_active,
  };
  switch (request.requested_action) {
    case "take_control":
      if (request.stop_reason === "cancelled") {
        return {
          ...base,
          action: "request_reject",
          reason: "cancellation_requested",
        };
      }
      if (isNeedsAttentionCliHandoff(recovery)) {
        return { ...base, action: "handoff" };
      }
      if (isFailedAutonomousSuccessorRecovery(recovery)) {
        return { ...base, action: "successor_start" };
      }
      if (request.run_state === "needs_attention") {
        return {
          ...base,
          action: "request_reject",
          reason: "run_needs_attention",
        };
      }
      if (request.owner_state === "remote") {
        if (
          request.run_state === "remote_owned" &&
          request.resource_state === "provisioned" &&
          request.tmux_session_name === null &&
          request.codex_thread_id &&
          request.previous_codex_thread_id === null
        ) {
          return { ...base, action: "successor_start" };
        }
        return {
          ...base,
          action: "request_reject",
          reason: "remote_successor_not_safe",
        };
      }
      if (!request.codex_thread_id) {
        return {
          ...base,
          action: "request_reject",
          reason: "codex_thread_not_ready",
        };
      }
      if (request.previous_codex_thread_id !== null) {
        return {
          ...base,
          action: "request_reject",
          reason: "ci_repair_cleanup_pending",
        };
      }
      if (request.owner_state === "cli" && request.tmux_session_name) {
        return { ...base, action: "handoff" };
      }
      if (
        request.owner_state === "none" &&
        request.tmux_session_name === null &&
        ["parked_review", "waiting_human"].includes(request.run_state)
      ) {
        return { ...base, action: "claim_remote" };
      }
      return {
        ...base,
        action: "request_reject",
        reason: "run_not_takeover_eligible",
      };

    case "preview_start":
      if (
        !["running", "remote_owned", "parked_review", "waiting_human"].includes(
          request.run_state,
        )
      ) {
        return {
          ...base,
          action: "request_reject",
          reason: "run_not_preview_eligible",
        };
      }
      if (!request.preview_lease_id && request.preview_id === null) {
        return { ...base, action: "preview_allocate" };
      }
      if (request.preview_lease_state === "leased") {
        return { ...base, action: "preview_up" };
      }
      if (request.preview_lease_state === "running") {
        if (previewNeedsExtension(request, config.limits.preview_expiry_warning_hours)) {
          return { ...base, action: "preview_extend" };
        }
        return {
          ...base,
          action: "request_complete",
          reason: "preview_already_running",
        };
      }
      return {
        ...base,
        action: "request_reject",
        reason: "preview_in_transitional_state",
      };

    case "preview_stop":
      if (!request.preview_lease_id) {
        return {
          ...base,
          action: "request_complete",
          reason: "preview_already_absent",
        };
      }
      return { ...base, action: "preview_down" };

    case "stop":
      return { ...base, action: "request_stop" };

    case "discard_local":
      if (
        request.run_state === "needs_attention" &&
        request.stop_reason === "cancelled" &&
        request.owner_state === "none"
      ) {
        return { ...base, action: "discard_cancelled" };
      }
      return {
        ...base,
        action: "request_reject",
        reason: "cancelled_local_work_not_discardable",
      };

    case "discard_published":
      if (
        request.run_state === "needs_attention" &&
        request.stop_reason === "cancelled" &&
        request.owner_state === "none"
      ) {
        return { ...base, action: "discard_published_cancelled" };
      }
      return {
        ...base,
        action: "request_reject",
        reason: "cancelled_published_work_not_discardable",
      };

    case "ci_repair":
      if (
        request.run_state === "parked_review" &&
        request.owner_state === "none" &&
        request.tmux_session_name === null &&
        request.resource_state === "provisioned" &&
        Boolean(request.codex_thread_id) &&
        request.previous_codex_thread_id === null &&
        Boolean(request.ci_head_sha) &&
        ["failed", "missing"].includes(request.ci_aggregate_state ?? "") &&
        request.repair_attempt_count < 2 &&
        request.repair_active_count === 0 &&
        request.review_fix_active_count === 0
      ) {
        return { ...base, action: "repair_start" };
      }
      return {
        ...base,
        action: "request_reject",
        reason: "run_not_ci_repair_eligible",
      };

    case "ai_review":
      if (
        request.run_state === "parked_review" &&
        request.owner_state === "none" &&
        request.tmux_session_name === null &&
        request.resource_state === "provisioned" &&
        request.previous_codex_thread_id === null &&
        request.repair_active_count === 0 &&
        (request.requested_review_active_count ?? request.review_active_count) === 0 &&
        request.review_fix_active_count === 0
      )
        return { ...base, action: "review_start" };
      return {
        ...base,
        action: "request_reject",
        reason: "run_not_ai_review_eligible",
      };
    case "review_fix":
      if (
        request.run_state === "parked_review" &&
        request.owner_state === "none" &&
        request.tmux_session_name === null &&
        request.resource_state === "provisioned" &&
        Boolean(request.codex_thread_id) &&
        request.previous_codex_thread_id === null &&
        request.repair_active_count === 0 &&
        request.review_active_count === 0 &&
        request.review_fix_active_count === 0 &&
        Boolean(request.ci_head_sha)
      )
        return { ...base, action: "review_fix_start" };
      return {
        ...base,
        action: "request_reject",
        reason: "run_not_review_fix_eligible",
      };
    case "recover_interrupted_review_fix":
      if (request.run_state === "needs_attention" && request.owner_state === "none" &&
          request.execution_mode === "live" && request.resource_state === "provisioned" &&
          request.stop_reason === null && request.tmux_session_name === null &&
          ["review_fix_uncommitted_changes","review_fix_runtime_budget_exceeded"].includes(request.latest_attention_reason ?? ""))
        return { ...base, action: "recover_interrupted_review_fix" };
      return { ...base, action:"request_reject", reason:"run_not_interrupted_review_fix_eligible" };
    case "retry":
      if(request.run_state === "needs_attention" && request.owner_state === "cli" && request.stop_reason === null &&
        request.execution_mode === "live" && request.latest_attention_reason === "primary_attempt_failed")
        return {...base,action:"retry"};
      return {...base,action:"request_reject",reason:"run_not_retry_eligible"};
    case "recover_managed_task":
      if (
        request.run_state === "needs_attention" &&
        request.owner_state === "cli" &&
        request.execution_mode === "live" &&
        request.resource_state === "provisioned" &&
        request.stop_reason === null &&
        request.latest_attention_reason === "review_fix_uncommitted_changes" &&
        request.latest_review_fix_state === "needs_attention" &&
        request.latest_review_fix_failure_reason ===
          "review_fix_uncommitted_changes" &&
        request.latest_review_fix_round_id &&
        request.latest_review_fix_codex_thread_id === request.codex_thread_id &&
        request.previous_codex_thread_id !== null &&
        request.tmux_session_name !== null
      )
        return { ...base, action: "recover_managed_task" };
      return {
        ...base,
        action: "request_reject",
        reason: "run_not_managed_task_recovery_eligible",
      };
  }
}
