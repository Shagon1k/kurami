import type { PlannedAction } from "./request-plan.ts";
import type { RunRow } from "./run-read-model.ts";
import {
  previewCompletionOwnershipStable,
  previewEvidenceCurrent,
  previewExpired,
  previewRequirementSatisfied,
  projectDiscoveryFresh,
} from "./run-predicates.ts";

type ProjectsRegistry = {
  projects: Record<string, {
    statuses: { backlog: string; active: string; review: string };
  }>;
};

export function planAutomatic(
  run: RunRow,
  registry: ProjectsRegistry,
  managedCliTurnCompleted: (sessionName: string) => boolean,
): PlannedAction | null {
  const base = {
    runId: run.run_id,
    project: run.project,
    issueNumber: run.issue_number,
  };
  const backlog = registry.projects[run.project]?.statuses.backlog;
  if (previewExpired(run)) {
    return { ...base, action: "preview_expire", reason: "preview_ttl_expired" };
  }
  if (
    previewCompletionOwnershipStable(run.run_state, run.owner_state) &&
    run.stop_reason === null &&
    previewEvidenceCurrent(run) &&
    previewRequirementSatisfied(run)
  ) {
    return {
      ...base,
      action: "preview_requirement_complete",
      reason: "exact_preview_reviewed",
    };
  }
  const project = registry.projects[run.project];
  if (
    project &&
    run.run_state === "parked_review" &&
    run.stop_reason === null &&
    run.owner_state === "none" &&
    run.tmux_session_name === null &&
    run.resource_state === "provisioned" &&
    run.project_item_status === project.statuses.active &&
    run.has_newer_run === 0 &&
    run.completion_parked !== 0 &&
    run.ci_pull_request_number !== null &&
    run.ci_pull_request_url !== null &&
    run.ci_head_sha !== null &&
    (run.interaction_policy === "autonomous" ||
      run.latest_autonomous_successor_state === "parked")
  ) {
    return { ...base, action: "project_review" };
  }
  if (
    run.latest_review_fix_state === "resolving" &&
    run.latest_review_fix_round_id &&
    run.run_state === "parked_review" &&
    run.owner_state === "none" &&
    run.stop_reason !== "cancelled"
  ) {
    return {
      ...base,
      action: "review_fix_resolve",
      roundId: run.latest_review_fix_round_id,
    };
  }
  if (
    [
      "parked_review",
      "needs_attention",
      "stopping",
      "archived",
      "cancelled",
    ].includes(run.run_state) &&
    run.owner_state === "none" &&
    run.tmux_session_name === null &&
    Boolean(run.codex_thread_id) &&
    Boolean(run.previous_codex_thread_id) &&
    run.latest_repair_state !== "running" &&
    run.latest_review_fix_state !== "running" &&
    run.latest_review_fix_state !== "waiting_ci" &&
    run.latest_review_fix_state !== "resolving" &&
    run.latest_repair_failure_reason !== "runtime_budget_exceeded" &&
    run.latest_review_fix_failure_reason !== "runtime_budget_exceeded" &&
    run.latest_review_fix_failure_reason !== "review_fix_uncommitted_changes" &&
    run.latest_review_fix_failure_reason !== "review_fix_no_new_head" &&
    run.latest_review_fix_failure_reason !==
      "No new PR head appeared after the review fixer task"
  ) {
    return run.latest_review_fix_codex_thread_id === run.codex_thread_id
      ? { ...base, action: "review_fix_cleanup" }
      : { ...base, action: "repair_cleanup" };
  }
  if (
    backlog &&
    run.run_state === "cancelled" &&
    run.stop_reason === "cancelled" &&
    run.owner_state === "none" &&
    run.resource_state === "released" &&
    run.has_newer_run === 0 &&
    run.backlog_satisfied === 0
  ) {
    return { ...base, action: "project_backlog" };
  }
  if (run.stop_reason === "cancelled" && run.owner_state === "cli") {
    return { ...base, action: "cancel_cli" };
  }
  if (
    run.stop_reason === "cancelled" &&
    run.run_state !== "stopping" &&
    run.run_state !== "cancelled"
  ) {
    return { ...base, action: "resume_stop" };
  }
  if (
    run.run_state === "admission_pending" &&
    run.resource_state === "planned" &&
    projectDiscoveryFresh(run)
  ) {
    return { ...base, action: "provision" };
  }
  if (
    run.run_state === "starting" &&
    run.owner_state === "none" &&
    run.resource_state === "provisioned" &&
    !run.tmux_session_name &&
    projectDiscoveryFresh(run)
  ) {
    return { ...base, action: "start" };
  }
  if (
    ["running", "parked_review"].includes(run.run_state) &&
    run.owner_state === "cli" &&
    run.tmux_session_name &&
    !run.codex_thread_id
  ) {
    return { ...base, action: "sync" };
  }
  const review = registry.projects[run.project]?.statuses.review;
  if (
    review &&
    run.run_state === "running" &&
    run.stop_reason === null &&
    (run.interaction_policy === "autonomous" ||
      run.autonomous_successor_active !== 0) &&
    run.owner_state === "cli" &&
    run.tmux_session_name &&
    run.codex_thread_id &&
    managedCliTurnCompleted(run.tmux_session_name)
  ) {
    return { ...base, action: "park" };
  }
  if (
    review &&
    run.run_state === "running" &&
    run.autonomous_successor_active !== 0 &&
    run.project_item_status === review &&
    run.owner_state === "cli" &&
    run.tmux_session_name &&
    run.codex_thread_id
  ) {
    return { ...base, action: "park" };
  }
  if (
    run.run_state === "running" &&
    run.interaction_policy === "human_control" &&
    run.autonomous_successor_active === 0 &&
    run.owner_state === "cli" &&
    run.tmux_session_name &&
    run.codex_thread_id
  ) {
    return { ...base, action: "handoff" };
  }
  if (
    run.run_state === "parked_review" &&
    run.owner_state === "cli" &&
    run.tmux_session_name &&
    run.codex_thread_id
  ) {
    return { ...base, action: "park" };
  }
  if (
    run.run_state === "stopping" &&
    run.owner_state === "cli" &&
    run.tmux_session_name
  ) {
    return { ...base, action: "cancel_cli" };
  }
  if (
    run.run_state === "stopping" &&
    run.tmux_session_name === null &&
    run.preview_lease_id
  ) {
    return { ...base, action: "preview_down" };
  }
  const retryMergedRelease =
    run.run_state === "needs_attention" &&
    ((run.stop_reason === "cancelled" &&
      run.latest_attention_reason === "worktree_release_blocked") ||
      (run.stop_reason === "completed" &&
        run.latest_attention_reason === "completion_waiting_for_merge"));
  if (
    (run.run_state === "stopping" || retryMergedRelease) &&
    run.tmux_session_name === null &&
    !run.preview_lease_id &&
    ["provisioned", "partial", "releasing"].includes(run.resource_state)
  ) {
    return { ...base, action: "release" };
  }
  return null;
}
