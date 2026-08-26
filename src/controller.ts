import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import {
  loadEffectiveOrchestratorConfig,
  type RuntimeSettingsBaseConfig,
} from "./runtime-settings.ts";

process.umask(0o077);

type OrchestratorConfig = RuntimeSettingsBaseConfig & {
  limits: RuntimeSettingsBaseConfig["limits"] & {
    max_llm_running_global: number;
    preview_expiry_warning_hours: number;
    main_writer_timeout_minutes: number;
    technical_worker_timeout_minutes: number;
  };
};

type ProjectConfig = {
  statuses: { backlog: string; review: string };
};

type ProjectsRegistry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};

type RunRow = {
  run_id: string;
  project: string;
  issue_number: number;
  interaction_policy: "autonomous" | "human_control";
  run_state: string;
  stop_reason: "cancelled" | "completed" | null;
  owner_state: string;
  resource_state: string;
  tmux_session_name: string | null;
  codex_thread_id: string | null;
  previous_codex_thread_id: string | null;
  preview_id: string | null;
  preview_lease_id: string | null;
  preview_lease_state: string | null;
  preview_expires_at: string | null;
  preview_reviewed_at: string | null;
  preview_verified_head_sha: string | null;
  preview_required: number;
  preview_required_label: string | null;
  completion_requested_at: string | null;
  completion_source_event_id: string | null;
  preview_requirement_satisfied_at: string | null;
  project_item_status: string | null;
  has_newer_run: number;
  backlog_satisfied: number;
  takeover_pending: number;
  ci_head_sha: string | null;
  ci_aggregate_state: string | null;
  repair_attempt_count: number;
  repair_active_count: number;
  latest_repair_state: string | null;
  latest_repair_number: number | null;
  latest_repair_failure_reason: string | null;
  review_active_count: number;
  latest_review_state: string | null;
  latest_review_head_sha: string | null;
  review_fix_active_count: number;
  autonomous_successor_active: number;
  latest_review_fix_state: string | null;
  latest_review_fix_number: number | null;
  latest_review_fix_round_id: string | null;
  latest_review_fix_codex_thread_id: string | null;
  latest_review_fix_failure_reason: string | null;
  latest_attention_reason: string | null;
  project_poll_last_captured_at: string | null;
  project_poll_last_attempt_state: string | null;
};

type RequestRow = RunRow & {
  request_id: string;
  requested_action:
    | "take_control"
    | "preview_start"
    | "preview_stop"
    | "stop"
    | "discard_local"
    | "discard_published"
    | "ci_repair"
    | "ai_review"
    | "review_fix";
};

type ControllerAction =
  | "provision"
  | "start"
  | "successor_start"
  | "repair_start"
  | "repair_cleanup"
  | "review_start"
  | "review_fix_start"
  | "review_fix_resolve"
  | "review_fix_cleanup"
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
  | "project_backlog";

type PlannedAction = {
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

type ProgressRow = RunRow & {
  title: string | null;
};

const orchestratorHome = resolve(
  process.env.KURAMI_HOME ?? process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const configPath = resolve(orchestratorHome, "config/orchestrator.yaml");
const projectsPath = resolve(orchestratorHome, "config/projects.yaml");
const provisionerPath = resolve(import.meta.dirname, "provision-worktree.ts");
const sessionManagerPath = resolve(import.meta.dirname, "session-manager.ts");
const releaserPath = resolve(import.meta.dirname, "release-worktree.ts");
const previewManagerPath = resolve(import.meta.dirname, "preview-manager.ts");
const previewRuntimePath = resolve(import.meta.dirname, "preview-runtime.ts");
const cancelResolutionPath = resolve(import.meta.dirname, "cancel-resolution.ts");
const projectStatusPath = resolve(import.meta.dirname, "project-status.ts");
const reviewManagerPath = resolve(import.meta.dirname, "review-manager.ts");
const reviewFixManagerPath = resolve(import.meta.dirname, "review-fix-manager.ts");
const autonomousSuccessorPath = resolve(
  import.meta.dirname,
  "autonomous-successor.ts",
);
const projectDiscoveryMaxAgeMs = 2 * 60 * 1_000;

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(): { apply: boolean } {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply")) {
    fail("Usage: controller.ts [--apply]");
  }
  return { apply: args.includes("--apply") };
}

function baseRunSelect(): string {
  return `
    SELECT r.run_id, r.project, r.issue_number, r.interaction_policy,
           r.state AS run_state, r.stop_reason, r.owner_state,
           rr.resource_state, rr.tmux_session_name, rr.codex_thread_id,
           rr.previous_codex_thread_id,
           rr.preview_id, pl.lease_id AS preview_lease_id,
           pl.state AS preview_lease_state,
           pl.expires_at AS preview_expires_at,
           pl.reviewed_at AS preview_reviewed_at,
           pl.verified_head_sha AS preview_verified_head_sha,
           r.preview_required, r.preview_required_label,
           r.completion_requested_at, r.completion_source_event_id,
           r.preview_requirement_satisfied_at,
           pi.status AS project_item_status,
           EXISTS (
             SELECT 1 FROM runs newer
             WHERE newer.project = r.project
               AND newer.item_id = r.item_id
               AND newer.rowid > r.rowid
           ) AS has_newer_run,
           EXISTS (
             SELECT 1 FROM run_state_history backlog_history
             WHERE backlog_history.run_id = r.run_id
               AND backlog_history.reason IN (
                 'cancelled_item_returned_to_backlog',
                 'cancelled_item_already_backlog'
               )
           ) AS backlog_satisfied,
           EXISTS (
             SELECT 1 FROM run_control_requests takeover_request
             WHERE takeover_request.run_id = r.run_id
               AND takeover_request.action = 'take_control'
               AND takeover_request.request_state IN ('pending', 'processing')
           ) AS takeover_pending,
           ci.head_sha AS ci_head_sha,
           ci.aggregate_state AS ci_aggregate_state,
           (SELECT COUNT(*) FROM run_ci_repair_attempts repair_count
            WHERE repair_count.run_id = r.run_id) AS repair_attempt_count,
           (SELECT COUNT(*) FROM run_ci_repair_attempts repair_active
            WHERE repair_active.run_id = r.run_id
              AND repair_active.attempt_state IN ('running', 'waiting_ci'))
             AS repair_active_count,
           (SELECT attempt_state FROM run_ci_repair_attempts repair_latest
            WHERE repair_latest.run_id = r.run_id
            ORDER BY repair_latest.attempt_number DESC LIMIT 1)
             AS latest_repair_state,
           (SELECT attempt_number FROM run_ci_repair_attempts repair_latest
            WHERE repair_latest.run_id = r.run_id
            ORDER BY repair_latest.attempt_number DESC LIMIT 1)
             AS latest_repair_number
           ,(SELECT failure_reason FROM run_ci_repair_attempts repair_latest
             WHERE repair_latest.run_id = r.run_id
             ORDER BY repair_latest.attempt_number DESC LIMIT 1)
              AS latest_repair_failure_reason
           ,(SELECT COUNT(*) FROM run_ai_reviews review_active
             WHERE review_active.run_id = r.run_id
               AND review_active.review_state = 'running') AS review_active_count
           ,(SELECT review_state FROM run_ai_reviews review_latest
             WHERE review_latest.run_id = r.run_id
             ORDER BY review_latest.review_number DESC LIMIT 1)
              AS latest_review_state
           ,(SELECT head_sha FROM run_ai_reviews review_latest
             WHERE review_latest.run_id = r.run_id
             ORDER BY review_latest.review_number DESC LIMIT 1)
              AS latest_review_head_sha
           ,(SELECT COUNT(*) FROM run_review_fix_rounds fix_active
             WHERE fix_active.run_id = r.run_id
               AND fix_active.round_state IN ('running','waiting_ci','resolving'))
              AS review_fix_active_count
           ,EXISTS (
             SELECT 1 FROM run_autonomous_successions successor_active
             WHERE successor_active.run_id = r.run_id
               AND successor_active.succession_state IN ('starting','running')
           ) AS autonomous_successor_active
           ,(SELECT round_state FROM run_review_fix_rounds fix_latest
             WHERE fix_latest.run_id = r.run_id
             ORDER BY fix_latest.round_number DESC LIMIT 1)
              AS latest_review_fix_state
           ,(SELECT round_number FROM run_review_fix_rounds fix_latest
             WHERE fix_latest.run_id = r.run_id
             ORDER BY fix_latest.round_number DESC LIMIT 1)
              AS latest_review_fix_number
           ,(SELECT round_id FROM run_review_fix_rounds fix_latest
             WHERE fix_latest.run_id = r.run_id
             ORDER BY fix_latest.round_number DESC LIMIT 1)
              AS latest_review_fix_round_id
           ,(SELECT codex_thread_id FROM run_review_fix_rounds fix_latest
             WHERE fix_latest.run_id = r.run_id
             ORDER BY fix_latest.round_number DESC LIMIT 1)
              AS latest_review_fix_codex_thread_id
           ,(SELECT failure_reason FROM run_review_fix_rounds fix_latest
             WHERE fix_latest.run_id = r.run_id
             ORDER BY fix_latest.round_number DESC LIMIT 1)
              AS latest_review_fix_failure_reason
           ,(SELECT reason FROM run_state_history attention_latest
             WHERE attention_latest.run_id = r.run_id
               AND attention_latest.to_state = 'needs_attention'
             ORDER BY attention_latest.sequence DESC LIMIT 1)
              AS latest_attention_reason
           ,pps.last_captured_at AS project_poll_last_captured_at
           ,pps.last_attempt_state AS project_poll_last_attempt_state
    FROM runs r
    JOIN run_resources rr USING (run_id)
    LEFT JOIN run_ci_snapshots ci USING (run_id)
    LEFT JOIN preview_leases pl
      ON pl.run_id = r.run_id AND pl.state <> 'released'
    LEFT JOIN project_items pi
      ON pi.project = r.project AND pi.item_id = r.item_id
    LEFT JOIN project_poll_state pps ON pps.project = r.project
  `;
}

function projectDiscoveryFresh(run: RunRow, now = Date.now()): boolean {
  if (run.project_poll_last_attempt_state !== "succeeded") return false;
  if (!run.project_poll_last_captured_at) return false;
  const capturedAt = Date.parse(run.project_poll_last_captured_at);
  return (
    Number.isFinite(capturedAt) &&
    capturedAt <= now &&
    now - capturedAt <= projectDiscoveryMaxAgeMs
  );
}

function runningLlmCount(database: DatabaseSync): number {
  const owned = Number(
    (
      database
        .prepare(
          `
      SELECT COUNT(*) AS count FROM runs
      WHERE owner_state = 'cli'
        AND state IN ('starting', 'running', 'handoff_pending', 'parked_review', 'stopping')
    `,
        )
        .get() as { count: number }
    ).count,
  );
  const reviews = Number(
    (
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM run_ai_reviews
           WHERE review_state = 'running'`,
        )
        .get() as { count: number }
    ).count,
  );
  return owned + reviews;
}

function externalCommand(
  action: ControllerAction,
  runId: string,
  requestId?: string,
  roundId?: string,
): string[] | null {
  switch (action) {
    case "provision":
      return [provisionerPath, "--run-id", runId, "--apply"];
    case "start":
      return [sessionManagerPath, "start", "--run-id", runId, "--apply"];
    case "successor_start":
      if (!requestId) fail("Autonomous successor start requires a request ID");
      return [
        autonomousSuccessorPath,
        "start",
        "--run-id",
        runId,
        "--request-id",
        requestId,
        "--apply",
      ];
    case "repair_start":
      if (!requestId) fail("CI repair start requires a request ID");
      return [
        sessionManagerPath,
        "repair",
        "--run-id",
        runId,
        "--request-id",
        requestId,
        "--apply",
      ];
    case "repair_cleanup":
      return [
        sessionManagerPath,
        "cleanup-repair",
        "--run-id",
        runId,
        "--apply",
      ];
    case "review_start":
      if (!requestId) fail("AI review start requires a request ID");
      return [
        reviewManagerPath,
        "start",
        "--run-id",
        runId,
        "--request-id",
        requestId,
        "--apply",
      ];
    case "review_fix_start":
      if (!requestId) fail("Review fix start requires a request ID");
      return [
        sessionManagerPath,
        "review-fix",
        "--run-id",
        runId,
        "--request-id",
        requestId,
        "--apply",
      ];
    case "review_fix_resolve":
      if (!roundId) fail("Review fix resolution requires a round ID");
      return [reviewFixManagerPath, "resolve", "--round-id", roundId, "--apply"];
    case "review_fix_cleanup":
      return [sessionManagerPath, "cleanup-review-fix", "--run-id", runId, "--apply"];
    case "sync":
      return [sessionManagerPath, "sync", "--run-id", runId, "--apply"];
    case "cancel_cli":
      return [sessionManagerPath, "cancel", "--run-id", runId, "--apply"];
    case "park":
      return [sessionManagerPath, "park", "--run-id", runId, "--apply"];
    case "handoff":
      return [sessionManagerPath, "handoff", "--run-id", runId, "--apply"];
    case "preview_allocate":
      return [previewManagerPath, "allocate", "--run-id", runId, "--apply"];
    case "preview_up":
      return [previewRuntimePath, "up", "--run-id", runId, "--apply"];
    case "preview_down":
      return [previewRuntimePath, "down", "--run-id", runId, "--apply"];
    case "preview_expire":
      return [
        previewRuntimePath,
        "down",
        "--run-id",
        runId,
        "--release-reason",
        "preview_ttl_expired",
        "--apply",
      ];
    case "preview_extend":
      return [previewManagerPath, "extend", "--run-id", runId, "--apply"];
    case "release":
      return [releaserPath, "--run-id", runId, "--apply"];
    case "discard_cancelled":
      return [cancelResolutionPath, "discard", "--run-id", runId, "--apply"];
    case "discard_published_cancelled":
      return [
        cancelResolutionPath,
        "discard-published",
        "--run-id",
        runId,
        "--apply",
      ];
    case "project_backlog":
      return [projectStatusPath, "backlog", "--run-id", runId, "--apply"];
    default:
      return null;
  }
}

function previewNeedsExtension(
  run: RunRow,
  warningHours: number,
  now = Date.now(),
): boolean {
  if (run.preview_lease_state !== "running" || !run.preview_expires_at) return false;
  const expiresAt = Date.parse(run.preview_expires_at);
  return (
    Number.isFinite(expiresAt) &&
    expiresAt > now &&
    expiresAt - now <= warningHours * 60 * 60 * 1_000
  );
}

function previewExpired(run: RunRow, now = Date.now()): boolean {
  if (run.preview_lease_state !== "running" || !run.preview_expires_at) return false;
  const expiresAt = Date.parse(run.preview_expires_at);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

function previewRequirementSatisfied(run: RunRow): boolean {
  return (
    run.preview_required === 1 &&
    run.completion_requested_at !== null &&
    run.preview_lease_id !== null &&
    run.preview_lease_state === "running" &&
    run.preview_reviewed_at !== null &&
    run.ci_head_sha !== null &&
    run.preview_verified_head_sha === run.ci_head_sha
  );
}

function previewCompletionOwnershipStable(
  state: string,
  ownerState: string,
): boolean {
  return (
    (state === "parked_review" && ownerState === "none") ||
    (state === "remote_owned" && ownerState === "remote")
  );
}

function planForRequest(
  request: RequestRow,
  config: OrchestratorConfig,
): PlannedAction {
  const base = {
    runId: request.run_id,
    project: request.project,
    issueNumber: request.issue_number,
    requestId: request.request_id,
  };
  switch (request.requested_action) {
    case "take_control":
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
        request.review_active_count === 0 &&
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
  }
}

function planAutomatic(
  run: RunRow,
  registry: ProjectsRegistry,
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
    run.preview_requirement_satisfied_at === null &&
    previewRequirementSatisfied(run)
  ) {
    return {
      ...base,
      action: "preview_requirement_complete",
      reason: "exact_preview_reviewed",
    };
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
    run.latest_review_fix_failure_reason !== "runtime_budget_exceeded"
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
  if (
    run.run_state === "stopping" &&
    run.tmux_session_name === null &&
    !run.preview_lease_id &&
    ["provisioned", "partial", "releasing"].includes(run.resource_state)
  ) {
    return { ...base, action: "release" };
  }
  return null;
}

function buildPlans(
  database: DatabaseSync,
  registry: ProjectsRegistry,
  config: OrchestratorConfig,
): PlannedAction[] {
  const requests = database
    .prepare(
      `
    SELECT base.*, q.request_id, q.action AS requested_action
    FROM (${baseRunSelect()}) AS base
    JOIN run_control_requests q ON q.run_id = base.run_id
    WHERE q.request_state = 'pending'
    ORDER BY q.created_at, q.request_id
  `,
    )
    .all() as RequestRow[];
  const requestedRuns = new Set(requests.map((row) => row.run_id));
  const automatic = database
    .prepare(
      `
    ${baseRunSelect()}
    WHERE r.state NOT IN ('rejected', 'failed')
      AND (r.state <> 'needs_attention'
           OR rr.previous_codex_thread_id IS NOT NULL
           OR (pl.state = 'running'
               AND pl.expires_at IS NOT NULL
               AND pl.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))
      AND (r.state <> 'archived'
           OR rr.previous_codex_thread_id IS NOT NULL)
    ORDER BY r.created_at, r.run_id
  `,
    )
    .all() as RunRow[];
  const plans: PlannedAction[] = [];
  const expiryPlanned = new Set<string>();
  for (const request of requests) {
    if (previewExpired(request)) {
      if (expiryPlanned.has(request.run_id)) continue;
      expiryPlanned.add(request.run_id);
      const pendingPreviewAction = ["preview_start", "preview_stop"].includes(
        request.requested_action,
      );
      plans.push({
        runId: request.run_id,
        project: request.project,
        issueNumber: request.issue_number,
        action: "preview_expire",
        requestId: pendingPreviewAction ? request.request_id : undefined,
        requestOutcome:
          request.requested_action === "preview_start"
            ? "rejected"
            : request.requested_action === "preview_stop"
              ? "applied"
              : undefined,
        reason: "preview_ttl_expired",
      });
    } else {
      plans.push(planForRequest(request, config));
    }
  }
  for (const run of automatic) {
    if (requestedRuns.has(run.run_id)) continue;
    const plan = planAutomatic(run, registry);
    if (plan) plans.push(plan);
  }
  return plans.map((plan) => {
    const command = externalCommand(plan.action, plan.runId, plan.requestId, plan.roundId);
    return command ? { ...plan, command: command.join(" ") } : plan;
  });
}

function reconcileCiRepairAttempts(database: DatabaseSync): void {
  const attempts = database
    .prepare(
      `SELECT a.attempt_id, a.run_id, a.attempt_number, a.source_head_sha,
              a.attempt_state, a.updated_at, r.state AS run_state,
              r.owner_state, rr.tmux_session_name,
              ci.head_sha, ci.aggregate_state
       FROM run_ci_repair_attempts a
       JOIN runs r USING (run_id)
       JOIN run_resources rr USING (run_id)
       LEFT JOIN run_ci_snapshots ci USING (run_id)
       WHERE a.attempt_state IN ('running', 'waiting_ci')
       ORDER BY a.created_at, a.attempt_id`,
    )
    .all() as Array<{
    attempt_id: string;
    run_id: string;
    attempt_number: number;
    source_head_sha: string;
    attempt_state: "running" | "waiting_ci";
    updated_at: string;
    run_state: string;
    owner_state: string;
    tmux_session_name: string | null;
    head_sha: string | null;
    aggregate_state: string | null;
  }>;
  for (const attempt of attempts) {
    if (
      attempt.attempt_state === "running" &&
      attempt.run_state === "parked_review" &&
      attempt.owner_state === "none" &&
      attempt.tmux_session_name === null
    ) {
      database
        .prepare(
          `UPDATE run_ci_repair_attempts
           SET attempt_state = 'waiting_ci',
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE attempt_id = ? AND attempt_state = 'running'`,
        )
        .run(attempt.attempt_id);
      continue;
    }
    if (attempt.attempt_state !== "waiting_ci") continue;
    const newHead =
      Boolean(attempt.head_sha) && attempt.head_sha !== attempt.source_head_sha;
    if (newHead && attempt.aggregate_state === "passed") {
      database
        .prepare(
          `UPDATE run_ci_repair_attempts
           SET attempt_state = 'succeeded', result_head_sha = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE attempt_id = ? AND attempt_state = 'waiting_ci'`,
        )
        .run(attempt.head_sha, attempt.attempt_id);
      continue;
    }
    if (
      newHead &&
      ["failed", "missing"].includes(attempt.aggregate_state ?? "")
    ) {
      const terminal = attempt.attempt_number >= 2;
      database
        .prepare(
          `UPDATE run_ci_repair_attempts
           SET attempt_state = ?, result_head_sha = ?, failure_reason = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE attempt_id = ? AND attempt_state = 'waiting_ci'`,
        )
        .run(
          terminal ? "needs_attention" : "failed",
          attempt.head_sha,
          `CI ${attempt.aggregate_state} on repaired SHA`,
          attempt.attempt_id,
        );
      if (terminal) markRepairNeedsAttention(database, attempt.run_id, "ci_repair_attempt_budget_exhausted", attempt);
      continue;
    }
    const ageMinutes =
      (Date.now() - Date.parse(attempt.updated_at)) / (60 * 1_000);
    if (!newHead && ageMinutes >= 10) {
      database
        .prepare(
          `UPDATE run_ci_repair_attempts
           SET attempt_state = 'needs_attention',
               failure_reason = 'No new PR head appeared after the fixer task',
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE attempt_id = ? AND attempt_state = 'waiting_ci'`,
        )
        .run(attempt.attempt_id);
      markRepairNeedsAttention(database, attempt.run_id, "ci_repair_no_new_head", attempt);
      continue;
    }
    if (
      newHead &&
      ["pending", "unknown"].includes(attempt.aggregate_state ?? "") &&
      ageMinutes >= 30
    ) {
      database
        .prepare(
          `UPDATE run_ci_repair_attempts
           SET attempt_state = 'needs_attention', result_head_sha = ?,
               failure_reason = 'CI did not settle within the bounded wait',
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE attempt_id = ? AND attempt_state = 'waiting_ci'`,
        )
        .run(attempt.head_sha, attempt.attempt_id);
      markRepairNeedsAttention(
        database,
        attempt.run_id,
        "ci_repair_ci_timeout",
        attempt,
      );
    }
  }
}

function markReviewFixNeedsAttention(
  database: DatabaseSync,
  round: { round_id: string; run_id: string; round_number: number; source_head_sha: string },
  reason: string,
  failure: string,
  resultHeadSha: string | null,
): void {
  database
    .prepare(
      `UPDATE run_review_fix_rounds
       SET round_state='needs_attention', result_head_sha=?, failure_reason=?,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE round_id=? AND round_state IN ('running','waiting_ci','resolving')`,
    )
    .run(resultHeadSha, failure, round.round_id);
  const current = database
    .prepare(`SELECT state FROM runs WHERE run_id=?`)
    .get(round.run_id) as { state: string };
  const changed = database
    .prepare(
      `UPDATE runs SET state='needs_attention', owner_state='none',
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE run_id=? AND state='parked_review' AND owner_state='none'`,
    )
    .run(round.run_id);
  if (changed.changes === 1)
    database
      .prepare(
        `INSERT INTO run_state_history (
           run_id, from_state, to_state, reason, details_json
         ) VALUES (?, ?, 'needs_attention', ?, ?)`,
      )
      .run(
        round.run_id,
        current.state,
        reason,
        JSON.stringify({
          roundId: round.round_id,
          roundNumber: round.round_number,
          sourceHeadSha: round.source_head_sha,
          resultHeadSha,
          failure,
        }),
      );
}

function reconcileReviewFixRounds(database: DatabaseSync): void {
  const exhaustedResolution = database
    .prepare(
      `SELECT round_id, run_id, round_number, source_head_sha, result_head_sha
       FROM run_review_fix_rounds
       WHERE round_state='resolving' AND resolution_attempt_count >= 3`,
    )
    .all() as Array<{
    round_id: string;
    run_id: string;
    round_number: number;
    source_head_sha: string;
    result_head_sha: string | null;
  }>;
  for (const round of exhaustedResolution)
    markReviewFixNeedsAttention(
      database,
      round,
      "review_fix_resolution_exhausted",
      "GitHub thread reconciliation failed after 3 attempts",
      round.result_head_sha,
    );
  const rounds = database
    .prepare(
      `SELECT f.round_id, f.run_id, f.round_number, f.source_head_sha,
              f.round_state, f.updated_at, r.state AS run_state,
              r.owner_state, rr.tmux_session_name,
              ci.head_sha, ci.aggregate_state
       FROM run_review_fix_rounds f
       JOIN runs r USING (run_id)
       JOIN run_resources rr USING (run_id)
       LEFT JOIN run_ci_snapshots ci USING (run_id)
       WHERE f.round_state IN ('running','waiting_ci')
       ORDER BY f.created_at, f.round_id`,
    )
    .all() as Array<{
    round_id: string;
    run_id: string;
    round_number: number;
    source_head_sha: string;
    round_state: "running" | "waiting_ci";
    updated_at: string;
    run_state: string;
    owner_state: string;
    tmux_session_name: string | null;
    head_sha: string | null;
    aggregate_state: string | null;
  }>;
  for (const round of rounds) {
    if (
      round.round_state === "running" &&
      round.run_state === "parked_review" &&
      round.owner_state === "none" &&
      round.tmux_session_name === null
    ) {
      database
        .prepare(
          `UPDATE run_review_fix_rounds SET round_state='waiting_ci',
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE round_id=? AND round_state='running'`,
        )
        .run(round.round_id);
      continue;
    }
    if (round.round_state !== "waiting_ci") continue;
    const newHead = Boolean(round.head_sha) && round.head_sha !== round.source_head_sha;
    if (newHead && round.aggregate_state === "passed") {
      database
        .prepare(
          `UPDATE run_review_fix_rounds
           SET round_state='resolving', result_head_sha=?,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE round_id=? AND round_state='waiting_ci'`,
        )
        .run(round.head_sha, round.round_id);
      continue;
    }
    if (newHead && ["failed", "missing"].includes(round.aggregate_state ?? "")) {
      markReviewFixNeedsAttention(
        database,
        round,
        "review_fix_ci_failed",
        `CI ${round.aggregate_state} on review-fix SHA`,
        round.head_sha,
      );
      continue;
    }
    const ageMinutes = (Date.now() - Date.parse(round.updated_at)) / 60_000;
    if (!newHead && ageMinutes >= 10) {
      markReviewFixNeedsAttention(
        database,
        round,
        "review_fix_no_new_head",
        "No new PR head appeared after the review fixer task",
        null,
      );
      continue;
    }
    if (
      newHead &&
      ["pending", "unknown"].includes(round.aggregate_state ?? "") &&
      ageMinutes >= 30
    )
      markReviewFixNeedsAttention(
        database,
        round,
        "review_fix_ci_timeout",
        "CI did not settle within the bounded wait",
        round.head_sha,
      );
  }
}

function tmuxSessionAlive(name: string): boolean {
  if (!/^rv-[a-z0-9-]+$/u.test(name)) return false;
  const result = spawnSync("tmux", ["has-session", "-t", `=${name}`], {
    env: process.env,
    stdio: ["ignore", "ignore", "ignore"],
  });
  return result.status === 0;
}

function reconcileAiReviews(database: DatabaseSync): void {
  const running = database
    .prepare(
      `SELECT review_id, tmux_session_name, created_at
       FROM run_ai_reviews WHERE review_state='running'`,
    )
    .all() as Array<{
    review_id: string;
    tmux_session_name: string;
    created_at: string;
  }>;
  for (const review of running) {
    const ageSeconds = (Date.now() - Date.parse(review.created_at)) / 1_000;
    if (ageSeconds < 15 || tmuxSessionAlive(review.tmux_session_name)) continue;
    database
      .prepare(
        `UPDATE run_ai_reviews
         SET review_state='failed',
             failure_reason='AI review worker exited before recording a result',
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE review_id=? AND review_state='running'`,
      )
      .run(review.review_id);
  }
}

function markRepairNeedsAttention(
  database: DatabaseSync,
  runId: string,
  reason: string,
  attempt: { attempt_id: string; attempt_number: number; source_head_sha: string },
): void {
  const current = database
    .prepare(`SELECT state FROM runs WHERE run_id = ?`)
    .get(runId) as { state: string };
  const changed = database
    .prepare(
      `UPDATE runs SET state = 'needs_attention', owner_state = 'none',
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE run_id = ? AND state = 'parked_review' AND owner_state = 'none'`,
    )
    .run(runId);
  if (changed.changes === 1) {
    database
      .prepare(
        `INSERT INTO run_state_history (
           run_id, from_state, to_state, reason, details_json
         ) VALUES (?, ?, 'needs_attention', ?, ?)`,
      )
      .run(
        runId,
        current.state,
        reason,
        JSON.stringify({
          attemptId: attempt.attempt_id,
          attemptNumber: attempt.attempt_number,
          sourceHeadSha: attempt.source_head_sha,
        }),
      );
  }
}

function ensureControlEvents(database: DatabaseSync): void {
  database
    .prepare(
      `
    INSERT OR IGNORE INTO run_control_events (
      event_id, run_id, event_kind, payload_json
    )
    SELECT 'ce_' || r.run_id || '_review_' || COALESCE((
             SELECT MAX(h.sequence) FROM run_state_history h
             WHERE h.run_id = r.run_id
               AND h.reason = 'codex_cli_park_completed'
           ), 0),
           r.run_id, 'review_ready',
           json_object('project', r.project, 'issueNumber', r.issue_number)
    FROM runs r
    JOIN run_resources rr USING (run_id)
    WHERE r.state = 'parked_review' AND r.owner_state = 'none'
      AND rr.tmux_session_name IS NULL AND rr.codex_thread_id IS NOT NULL
  `,
    )
    .run();
  database
    .prepare(
      `
    INSERT OR IGNORE INTO run_control_events (
      event_id, run_id, event_kind, payload_json
    )
    SELECT 'ce_' || r.run_id || '_human_' || COALESCE((
             SELECT MAX(h.sequence) FROM run_state_history h
             WHERE h.run_id = r.run_id
               AND h.reason = 'codex_cli_handoff_completed'
           ), 0),
           r.run_id,
           'human_control_ready',
           json_object('project', r.project, 'issueNumber', r.issue_number)
    FROM runs r
    JOIN run_resources rr USING (run_id)
    WHERE r.interaction_policy = 'human_control'
      AND r.state = 'remote_owned' AND r.owner_state = 'remote'
      AND rr.tmux_session_name IS NULL AND rr.codex_thread_id IS NOT NULL
  `,
    )
    .run();
  database
    .prepare(
      `
    INSERT OR IGNORE INTO run_control_events (
      event_id, run_id, event_kind, payload_json
    )
    SELECT 'ce_' || r.run_id || '_preview_' || pl.lease_id || '_ready',
           r.run_id, 'preview_ready',
           json_object('project', r.project, 'issueNumber', r.issue_number,
                       'leaseId', pl.lease_id, 'slotNumber', pl.slot_number)
    FROM runs r
    JOIN preview_leases pl ON pl.run_id = r.run_id
    WHERE pl.state = 'running'
  `,
    )
    .run();
  database
    .prepare(
      `
    INSERT OR IGNORE INTO run_control_events (
      event_id, run_id, event_kind, payload_json
    )
    SELECT 'ce_' || r.run_id || '_preview_' || pl.lease_id || '_failed',
           r.run_id, 'preview_failed',
           json_object('project', r.project, 'issueNumber', r.issue_number,
                       'leaseId', pl.lease_id, 'slotNumber', pl.slot_number)
    FROM runs r
    JOIN preview_leases pl ON pl.run_id = r.run_id
    WHERE pl.state = 'failed'
  `,
    )
    .run();
  database
    .prepare(
      `
    INSERT OR IGNORE INTO run_control_events (
      event_id, run_id, event_kind, payload_json
    )
    SELECT 'ce_' || r.run_id || '_ci_' || ci.head_sha,
           r.run_id, 'attention_required',
           json_object(
             'source', 'ci',
             'state', ci.aggregate_state,
             'headSha', ci.head_sha,
             'pullRequestUrl', ci.pull_request_url,
             'pullRequestTitle', ci.pull_request_title,
             'checks', json(ci.checks_json)
           )
    FROM runs r
    JOIN run_ci_snapshots ci USING (run_id)
    WHERE ci.aggregate_state IN ('failed', 'missing')
      AND ci.head_sha IS NOT NULL
      AND r.state NOT IN ('rejected', 'cancelled', 'archived')
  `,
    )
    .run();
}

function progressFor(
  run: ProgressRow,
  config: OrchestratorConfig,
): { stage: string; detail: string } {
  if (
    run.preview_required === 1 &&
    run.completion_requested_at !== null &&
    run.preview_requirement_satisfied_at === null
  ) {
    if (!run.preview_lease_id) {
      return {
        stage: "preview_required",
        detail:
          "Completion is paused by the preview-required policy. Start a preview for the current pull request SHA, inspect it, and mark it reviewed.",
      };
    }
    if (run.preview_lease_state === "leased") {
      return {
        stage: "preview_required",
        detail: "Completion is paused while the required preview waits to build.",
      };
    }
    if (run.preview_lease_state === "provisioning") {
      return {
        stage: "preview_required",
        detail: "Completion is paused while the required preview builds and passes health checks.",
      };
    }
    if (
      run.preview_lease_state === "running" &&
      (!run.ci_head_sha || run.preview_verified_head_sha !== run.ci_head_sha)
    ) {
      return {
        stage: "preview_required",
        detail:
          "The running preview does not match the current pull request SHA. Stop it, start a fresh preview, then inspect and mark it reviewed.",
      };
    }
    if (run.preview_lease_state === "running" && !run.preview_reviewed_at) {
      return {
        stage: "preview_required",
        detail:
          "The required preview matches the current pull request SHA. Inspect it and mark it reviewed to continue completion.",
      };
    }
    if (previewRequirementSatisfied(run)) {
      return {
        stage: "preview_required",
        detail: "The exact preview was reviewed; guarded completion is queued.",
      };
    }
    return {
      stage: "preview_required",
      detail: "Completion is paused until the required exact preview is reviewed.",
    };
  }
  if (run.preview_lease_state === "failed") {
    return {
      stage: "needs_attention",
      detail: "Preview failed; inspect the preview runtime logs.",
    };
  }
  if (run.preview_lease_state === "running") {
    if (previewNeedsExtension(run, config.limits.preview_expiry_warning_hours)) {
      return {
        stage: "preview_ready",
        detail: "Preview expires soon. Extend it or it will be removed automatically.",
      };
    }
    return {
      stage: "preview_ready",
      detail: "Preview is running and ready to open.",
    };
  }
  if (run.preview_lease_state === "provisioning") {
    return {
      stage: "preview_building",
      detail: "Building and health-checking the requested preview.",
    };
  }
  if (run.preview_lease_state === "leased") {
    return {
      stage: "preview_queued",
      detail: "Preview slot allocated; publication is queued.",
    };
  }
  if (
    ["admission_pending", "starting"].includes(run.run_state) &&
    !projectDiscoveryFresh(run)
  ) {
    return {
      stage: "waiting_github",
      detail:
        "GitHub Project is temporarily unavailable; waiting for a fresh status snapshot before starting Codex.",
    };
  }
  if (run.run_state === "admission_pending") {
    return {
      stage: "preparing",
      detail: "Run accepted; preparing an isolated worktree.",
    };
  }
  if (run.run_state === "starting") {
    return {
      stage: "starting",
      detail: "Worktree is ready; starting the managed Codex task.",
    };
  }
  if (
    run.latest_review_fix_state === "running" &&
    run.run_state === "parked_review"
  ) {
    return {
      stage: "review_fix_working",
      detail: `Fresh Codex task is fixing the owner-approved review snapshot (round ${run.latest_review_fix_number}).`,
    };
  }
  if (
    run.latest_review_fix_state === "waiting_ci" &&
    run.run_state === "parked_review"
  ) {
    return {
      stage: "review_fix_waiting",
      detail: `Review fixes from round ${run.latest_review_fix_number} were pushed. Waiting for CI on the new exact SHA.`,
    };
  }
  if (
    run.latest_review_fix_state === "resolving" &&
    run.run_state === "parked_review"
  ) {
    return {
      stage: "review_fix_resolving",
      detail: "CI passed; replying to and resolving the snapshotted GitHub review threads.",
    };
  }
  if (
    run.latest_repair_state === "running" &&
    run.run_state === "parked_review"
  ) {
    return {
      stage: "ci_repair_working",
      detail: `Fresh Codex task is fixing the exact failed CI evidence (attempt ${run.latest_repair_number}/2).`,
    };
  }
  if (
    run.latest_repair_state === "waiting_ci" &&
    run.run_state === "parked_review"
  ) {
    return {
      stage: "ci_repair_waiting",
      detail: `Fix attempt ${run.latest_repair_number}/2 was pushed. Waiting for checks to start.`,
    };
  }
  if (
    run.takeover_pending !== 0 &&
    ["cli", "remote"].includes(run.owner_state) &&
    run.stop_reason !== "cancelled"
  ) {
    return {
      stage:
        run.owner_state === "remote"
          ? "autonomous_successor_pending"
          : "handoff_pending",
      detail:
        run.owner_state === "remote"
          ? "Autonomous continuation requested; starting a fresh managed Codex task after the owner's explicit Remote-task boundary."
          : "Take control requested; safely interrupting the active Codex turn and preparing handoff.",
    };
  }
  if (run.run_state === "running" && run.owner_state === "cli") {
    return {
      stage: "working",
      detail: "Codex is working autonomously in the isolated worktree.",
    };
  }
  if (run.run_state === "remote_owned") {
    return {
      stage: "human_control",
      detail: "The existing Codex task is under human control.",
    };
  }
  if (run.run_state === "parked_review" && run.owner_state === "cli") {
    return {
      stage: "finalizing_review",
      detail:
        "GitHub is in Human Review; waiting for the active Codex turn to finish before releasing CLI ownership.",
    };
  }
  if (run.run_state === "parked_review" && run.owner_state === "none") {
    return {
      stage: "review_ready",
      detail: "Autonomous work is parked and ready for review.",
    };
  }
  if (run.run_state === "waiting_human") {
    return {
      stage: "waiting_human",
      detail: "The run is waiting for Alex's decision.",
    };
  }
  if (run.run_state === "stopping") {
    return {
      stage: "stopping",
      detail: "Stopping active resources and checking cleanup safety.",
    };
  }
  if (run.run_state === "archived") {
    return {
      stage: "completed",
      detail: "Run completed and managed resources were released.",
    };
  }
  if (run.run_state === "cancelled") {
    return {
      stage: "cancelled",
      detail: "Run was cancelled and is no longer active.",
    };
  }
  if (run.run_state === "needs_attention" && run.stop_reason === "cancelled") {
    return {
      stage: "cancelled_work_preserved",
      detail:
        "Automation stopped, but unpublished local work was preserved. Discard it explicitly to finish cancellation.",
    };
  }
  if (["failed", "needs_attention"].includes(run.run_state)) {
    const timeoutLabels: Record<string, string> = {
      main_writer_runtime_budget_exceeded: `Main Codex writer exceeded its ${config.limits.main_writer_timeout_minutes}-minute limit. The worktree, branch, thread reference, and terminal evidence were preserved.`,
      ci_repair_runtime_budget_exceeded: `CI repair worker exceeded its ${config.limits.technical_worker_timeout_minutes}-minute limit. The worktree, thread reference, and terminal evidence were preserved.`,
      review_fix_runtime_budget_exceeded: `Review-fix worker exceeded its ${config.limits.technical_worker_timeout_minutes}-minute limit. The worktree, thread reference, and terminal evidence were preserved.`,
      ai_review_runtime_budget_exceeded: `AI review worker exceeded its ${config.limits.technical_worker_timeout_minutes}-minute limit. Its terminal evidence and the run worktree were preserved.`,
    };
    return {
      stage: "needs_attention",
      detail:
        timeoutLabels[run.latest_attention_reason ?? ""] ??
        "The run needs attention before it can continue.",
    };
  }
  return { stage: run.run_state, detail: `Run state: ${run.run_state}.` };
}

function reconcileProgressCards(
  database: DatabaseSync,
  config: OrchestratorConfig,
): void {
  const runs = database
    .prepare(
      `
    SELECT base.*, pe.title
    FROM (${baseRunSelect()}) AS base
    JOIN runs r ON r.run_id = base.run_id
    JOIN project_events pe ON pe.event_id = r.trigger_event_id
    WHERE base.run_state NOT IN ('rejected', 'archived', 'cancelled')
       OR EXISTS (
         SELECT 1 FROM run_progress_cards pc WHERE pc.run_id = base.run_id
       )
  `,
    )
    .all() as ProgressRow[];
  const upsert = database.prepare(`
    INSERT INTO run_progress_cards (run_id, stage, detail, content_digest)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      stage = excluded.stage,
      detail = excluded.detail,
      content_digest = excluded.content_digest,
      delivery_state = CASE
        WHEN run_progress_cards.content_digest = excluded.content_digest
          THEN run_progress_cards.delivery_state
        ELSE 'pending'
      END,
      last_error = CASE
        WHEN run_progress_cards.content_digest = excluded.content_digest
          THEN run_progress_cards.last_error
        ELSE NULL
      END,
      updated_at = CASE
        WHEN run_progress_cards.content_digest = excluded.content_digest
          THEN run_progress_cards.updated_at
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      END
  `);
  const heartbeatStages = new Set([
    "preparing",
    "starting",
    "waiting_github",
    "working",
    "ci_repair_working",
    "ci_repair_waiting",
    "review_fix_working",
    "review_fix_waiting",
    "review_fix_resolving",
    "handoff_pending",
    "autonomous_successor_pending",
    "finalizing_review",
    "preview_queued",
    "preview_extending",
    "preview_building",
    "stopping",
  ]);
  const heartbeatBucket = Math.floor(Date.now() / (5 * 60 * 1_000));
  for (const run of runs) {
    const progress = progressFor(run, config);
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          stage: progress.stage,
          detail: progress.detail,
          heartbeat: heartbeatStages.has(progress.stage)
            ? heartbeatBucket
            : null,
        }),
      )
      .digest("hex");
    upsert.run(run.run_id, progress.stage, progress.detail, digest);
  }
}

function completeRequest(
  database: DatabaseSync,
  requestId: string,
  state: "applied" | "rejected" | "failed",
  result: unknown,
): void {
  database
    .prepare(
      `
    UPDATE run_control_requests
    SET request_state = ?, result_json = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE request_id = ? AND request_state IN ('pending', 'processing')
  `,
    )
    .run(state, JSON.stringify(result), requestId);
}

function applyInternal(database: DatabaseSync, plan: PlannedAction): unknown {
  if (
    !["resume_stop", "preview_requirement_complete"].includes(plan.action) &&
    !plan.requestId
  ) {
    fail(`Internal action requires a request ID`);
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    let result: Record<string, unknown>;
    if (plan.action === "claim_remote") {
      const current = database
        .prepare(`SELECT state FROM runs WHERE run_id = ?`)
        .get(plan.runId) as { state: string };
      const changed = database
        .prepare(
          `
        UPDATE runs SET state = 'remote_owned', owner_state = 'remote',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ? AND owner_state = 'none'
          AND state IN ('parked_review', 'waiting_human')
      `,
        )
        .run(plan.runId);
      if (changed.changes !== 1) fail("Run changed before Remote claim");
      database
        .prepare(
          `INSERT INTO run_state_history (
             run_id, from_state, to_state, reason, details_json
           ) VALUES (?, ?, 'remote_owned', 'remote_claim_completed', ?)`,
        )
        .run(
          plan.runId,
          current.state,
          JSON.stringify({ requestId: plan.requestId }),
        );
      result = { action: "remote_claimed" };
      completeRequest(database, plan.requestId!, "applied", result);
    } else if (plan.action === "request_stop") {
      const current = database
        .prepare(`SELECT state FROM runs WHERE run_id = ?`)
        .get(plan.runId) as { state: string };
      const changed = database
        .prepare(
          `
        UPDATE runs SET state = 'stopping', stop_reason = 'cancelled',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ? AND state NOT IN ('rejected', 'cancelled', 'archived', 'stopping')
      `,
        )
        .run(plan.runId);
      if (changed.changes !== 1 && current.state !== "stopping")
        fail("Run changed before stop request");
      result = { action: "stopping", previousState: current.state };
      completeRequest(database, plan.requestId!, "applied", result);
    } else if (plan.action === "resume_stop") {
      const changed = database
        .prepare(
          `
        UPDATE runs SET state = 'stopping',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ? AND stop_reason = 'cancelled'
          AND state NOT IN ('cancelled', 'archived', 'needs_attention')
      `,
        )
        .run(plan.runId);
      if (changed.changes !== 1) fail("Cancellation intent changed before recovery");
      result = { action: "stopping_restored" };
    } else if (plan.action === "preview_requirement_complete") {
      const evidence = database
        .prepare(`
          SELECT r.state, r.owner_state, r.completion_source_event_id,
                 ci.head_sha, pl.lease_id, pl.state AS lease_state,
                 pl.verified_head_sha, pl.reviewed_at
          FROM runs r
          LEFT JOIN run_ci_snapshots ci USING (run_id)
          LEFT JOIN preview_leases pl
            ON pl.run_id = r.run_id AND pl.state <> 'released'
          WHERE r.run_id = ? AND r.preview_required = 1
            AND r.completion_requested_at IS NOT NULL
            AND r.preview_requirement_satisfied_at IS NULL
        `)
        .get(plan.runId) as
        | {
            state: string;
            owner_state: string;
            completion_source_event_id: string | null;
            head_sha: string | null;
            lease_id: string | null;
            lease_state: string | null;
            verified_head_sha: string | null;
            reviewed_at: string | null;
          }
        | undefined;
      if (
        !evidence ||
        !previewCompletionOwnershipStable(evidence.state, evidence.owner_state) ||
        evidence.lease_state !== "running" ||
        !evidence.lease_id ||
        !evidence.reviewed_at ||
        !evidence.head_sha ||
        evidence.verified_head_sha !== evidence.head_sha
      )
        fail("Preview requirement changed before guarded completion");
      const changed = database
        .prepare(`
          UPDATE runs
          SET state = 'stopping', owner_state = 'none', stop_reason = 'completed',
              preview_requirement_satisfied_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
              preview_requirement_lease_id = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE run_id = ?
            AND ((state = 'parked_review' AND owner_state = 'none')
              OR (state = 'remote_owned' AND owner_state = 'remote'))
            AND stop_reason IS NULL AND preview_requirement_satisfied_at IS NULL
        `)
        .run(evidence.lease_id, plan.runId);
      if (changed.changes !== 1)
        fail("Run changed before guarded preview completion");
      database
        .prepare(`
          INSERT INTO run_state_history (
            run_id, from_state, to_state, reason, source_event_id, details_json
          ) VALUES (?, ?, 'stopping',
                    'preview_requirement_satisfied', ?, ?)
        `)
        .run(
          plan.runId,
          evidence.state,
          evidence.completion_source_event_id,
          JSON.stringify({
            leaseId: evidence.lease_id,
            headSha: evidence.head_sha,
            reviewedAt: evidence.reviewed_at,
          }),
        );
      result = {
        action: "preview_requirement_satisfied",
        leaseId: evidence.lease_id,
        headSha: evidence.head_sha,
      };
    } else {
      result = { action: plan.reason ?? plan.action };
      completeRequest(
        database,
        plan.requestId!,
        plan.action === "request_reject" ? "rejected" : "applied",
        result,
      );
    }
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function runExternal(plan: PlannedAction): unknown {
  const args = externalCommand(plan.action, plan.runId, plan.requestId, plan.roundId);
  if (!args) fail(`No external command for ${plan.action}`);
  const stdout = execFileSync(process.execPath, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      KURAMI_HOME: orchestratorHome,
      ORCHESTRATOR_HOME: orchestratorHome,
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const lastLine = stdout.split("\n").filter(Boolean).at(-1);
  return lastLine ? JSON.parse(lastLine) : null;
}

async function main(): Promise<void> {
  const { apply } = parseArguments();
  const config = await loadEffectiveOrchestratorConfig<OrchestratorConfig>(
    orchestratorHome,
  );
  const registry = parse(
    await readFile(projectsPath, "utf8"),
  ) as ProjectsRegistry;
  if (config.version !== 1) fail("Unsupported orchestrator config version");
  if (
    !Number.isInteger(config.limits.preview_expiry_warning_hours) ||
    config.limits.preview_expiry_warning_hours < 1 ||
    config.limits.preview_expiry_warning_hours > 24 * 7
  )
    fail("Invalid preview_expiry_warning_hours");
  if (
    !Number.isInteger(config.limits.main_writer_timeout_minutes) ||
    config.limits.main_writer_timeout_minutes < 30 ||
    config.limits.main_writer_timeout_minutes > 24 * 60
  )
    fail("Invalid main_writer_timeout_minutes");
  if (
    !Number.isInteger(config.limits.technical_worker_timeout_minutes) ||
    config.limits.technical_worker_timeout_minutes < 15 ||
    config.limits.technical_worker_timeout_minutes > 12 * 60
  )
    fail("Invalid technical_worker_timeout_minutes");
  if (registry.version !== 1) fail("Unsupported projects registry version");
  if (config.mode !== "live" && apply)
    fail(`Refusing mutation in mode=${config.mode}`);

  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (apply) {
    reconcileCiRepairAttempts(database);
    reconcileReviewFixRounds(database);
    reconcileAiReviews(database);
    ensureControlEvents(database);
    reconcileProgressCards(database, config);
  }
  let llmCount = runningLlmCount(database);
  const plans = buildPlans(database, registry, config);

  if (!apply) {
    database.close();
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: false, activeLlm: llmCount, plans })}\n`,
    );
    return;
  }

  const results: Array<
    PlannedAction & {
      status: "applied" | "deferred";
      result?: unknown;
      reason?: string;
    }
  > = [];
  for (const plan of plans) {
    if (
      ["start", "successor_start", "repair_start", "review_start", "review_fix_start"].includes(plan.action) &&
      llmCount >= config.limits.max_llm_running_global
    ) {
      results.push({ ...plan, status: "deferred", reason: "LLM cap reached" });
      continue;
    }
    try {
      const internal = [
        "claim_remote",
        "request_stop",
        "resume_stop",
        "preview_requirement_complete",
        "request_complete",
        "request_reject",
      ].includes(plan.action);
      const result = internal
        ? applyInternal(database, plan)
        : runExternal(plan);
      if (
        plan.requestId &&
        ["handoff", "successor_start", "preview_up", "preview_down", "preview_expire", "preview_extend", "repair_start", "review_start", "review_fix_start"].includes(
          plan.action,
        )
      ) {
        completeRequest(
          database,
          plan.requestId,
          plan.requestOutcome ?? "applied",
          result,
        );
      }
      if (
        plan.requestId &&
        ["discard_cancelled", "discard_published_cancelled"].includes(
          plan.action,
        )
      ) {
        const action = (result as { action?: string } | null)?.action;
        completeRequest(
          database,
          plan.requestId,
          ["discarded_local_work", "discarded_published_work"].includes(
            action ?? "",
          )
            ? "applied"
            : "rejected",
          result,
        );
      }
      results.push({ ...plan, status: "applied", result });
      if (["start", "successor_start", "repair_start", "review_start", "review_fix_start"].includes(plan.action))
        llmCount += 1;
      reconcileCiRepairAttempts(database);
      reconcileReviewFixRounds(database);
      reconcileProgressCards(database, config);
      ensureControlEvents(database);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (process.env.CONTROLLER_QUIET === "1") {
        process.stderr.write(
          `${JSON.stringify({
            ok: false,
            runId: plan.runId,
            project: plan.project,
            issueNumber: plan.issueNumber,
            action: plan.action,
            reason,
          })}\n`,
        );
      }
      if (["successor_start", "review_start", "review_fix_start"].includes(plan.action) && plan.requestId) {
        completeRequest(database, plan.requestId, "failed", {
          action:
            plan.action === "successor_start"
              ? "autonomous_successor_start_failed"
              : plan.action === "review_start"
              ? "ai_review_start_failed"
              : "review_fix_start_failed",
          reason,
        });
      }
      results.push({ ...plan, status: "deferred", reason });
    }
  }
  ensureControlEvents(database);
  reconcileProgressCards(database, config);
  database.close();

  if (process.env.CONTROLLER_QUIET !== "1") {
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: true, activeLlm: llmCount, results })}\n`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
