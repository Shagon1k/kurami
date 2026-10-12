import { parseReviewProfile, type ReviewProfile } from "../projects/reviews/profiles.ts";
import {LATEST_ATTENTION_SQL,LATEST_SUCCESSOR_STATE_SQL,LATEST_SUCCESSOR_THREAD_SQL,ACTIVE_SUCCESSOR_COUNT_SQL} from "../runtime/run-projections.ts";
import { technicalWorkerDiagnostic } from "../integrations/codex/worker-diagnostic.ts";
import { aiReviewStable } from "./ai-review.ts";
import {hasActivePrRequest} from "./pr-boundary.ts";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveKuramiHome } from "../../core/kurami-home.ts";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import {
  isFailedAutonomousSuccessorRecovery,
  isNeedsAttentionCliHandoff,
  type RecoverySnapshot,
} from "../runtime/recovery.ts";
import {
  inspectManagedReviewFixRecovery,
  loadManagedReviewFixRecoverySnapshot,
} from "../runtime/managed-task-recovery.ts";
import { openOrchestratorDatabase } from "../state/database.ts";

process.umask(0o077);

export type Action =
  | "take_control"
  | "preview_start"
  | "preview_stop"
  | "stop"
  | "discard_local"
  | "discard_published"
  | "ci_repair"
  | "ai_review"
  | "review_fix"
  | "recover_managed_task";
type Command = "status" | "request" | "controls";
export type RequestSource = "telegram" | "discord" | "cli" | "projects";

const pendingPresentations: Partial<
  Record<Action, { stage: string; detail: string }>
> = {
  take_control: {
    stage: "handoff_pending",
    detail:
      "Take control requested; safely interrupting the active Codex turn and preparing handoff.",
  },
  preview_start: {
    stage: "preview_queued",
    detail: "Preview start requested; waiting for runtime reconciliation.",
  },
  preview_stop: {
    stage: "preview_stopping",
    detail: "Preview stop requested; waiting for safe runtime cleanup.",
  },
  stop: {
    stage: "stopping",
    detail: "Stopping active resources and checking cleanup safety.",
  },
  discard_local: {
    stage: "discarding_cancelled",
    detail: "Discard confirmed; checking the preserved local result before cleanup.",
  },
  discard_published: {
    stage: "discarding_cancelled",
    detail:
      "Published discard confirmed; verifying the exact draft pull request and managed branch.",
  },
  ci_repair: {
    stage: "ci_repair_queued",
    detail:
      "CI fix requested; waiting to start a fresh bounded Codex task on the exact failed SHA.",
  },
  review_fix: {
    stage: "review_fix_queued",
    detail:
      "Review fix requested; capturing the current unresolved GitHub review threads before starting a fresh Codex task.",
  },
  recover_managed_task: {
    stage: "review_fix_recovery_queued",
    detail:
      "Recovery requested; revalidating the exact preserved review-fix task, pushed head, and fresh CI evidence.",
  },
};

const orchestratorHome = resolveKuramiHome(
  resolve(import.meta.dirname, "../../../.."),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");

type ProjectsRegistry = {
  projects: Record<
    string,
    {
      repository: string;
      preview?: Record<string, unknown>;
      workspace: { worktree_root: string };
    }
  >;
};

type OrchestratorConfig = {
  limits: { preview_expiry_warning_hours: number };
};

function previewExtensionAvailable(expiresAt: unknown, home = orchestratorHome, now = Date.now()): boolean {
  if (typeof expiresAt !== "string") return false;
  const config = parse(readFileSync(resolve(home,"config/orchestrator.yaml"), "utf8")) as OrchestratorConfig;
  const expiry = Date.parse(expiresAt);
  return (
    Number.isFinite(expiry) &&
    expiry > now &&
    expiry - now <=
      config.limits.preview_expiry_warning_hours * 60 * 60 * 1_000
  );
}

function projectSupportsPreview(project: string, home = orchestratorHome): boolean {
  const registry = parse(
    readFileSync(resolve(home,"config/projects.yaml"), "utf8"),
  ) as ProjectsRegistry;
  return Boolean(registry.projects?.[project]?.preview);
}

function fail(message: string): never {
  throw new Error(message);
}

function recoverySnapshot(run: {
  state: string;
  owner_state: string;
  execution_mode: string;
  resource_state: string;
  worktree_path: string | null;
  branch_name: string | null;
  tmux_session_name: string | null;
  codex_thread_id: string | null;
  previous_codex_thread_id: string | null;
  latest_attention_reason: string | null;
  latest_autonomous_successor_state: string | null;
  latest_autonomous_successor_predecessor_thread_id: string | null;
  autonomous_successor_active: number;
}): RecoverySnapshot {
  return {
    runState: run.state,
    ownerState: run.owner_state,
    executionMode: run.execution_mode,
    resourceState: run.resource_state,
    worktreePath: run.worktree_path,
    branchName: run.branch_name,
    tmuxSessionName: run.tmux_session_name,
    codexThreadId: run.codex_thread_id,
    previousCodexThreadId: run.previous_codex_thread_id,
    latestAttentionReason: run.latest_attention_reason,
    latestSuccessorState: run.latest_autonomous_successor_state,
    latestSuccessorPredecessorThreadId:
      run.latest_autonomous_successor_predecessor_thread_id,
    autonomousSuccessorActive: run.autonomous_successor_active,
  };
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1]?.trim() : undefined;
}

function parseArguments(): {
  command: Command;
  runId?: string;
  action?: Action;
  via: RequestSource;
  profile: ReviewProfile;
  project?: string;
  issue?: number;
  discordThreadId?: string;
  apply: boolean;
} {
  const args = process.argv.slice(2);
  const command = args[0] as Command | undefined;
  const runId = valueAfter(args, "--run-id");
  const action = valueAfter(args, "--action") as Action | undefined;
  const profile = parseReviewProfile(valueAfter(args, "--profile"));
  if (args.includes("--profile") && (command !== "request" || !["ai_review", "review_fix"].includes(action ?? ""))) fail("--profile requires a review action");
  const via = (valueAfter(args, "--via") ?? "cli") as RequestSource;
  const project = valueAfter(args, "--project");
  const issueValue = valueAfter(args, "--issue");
  const issue = issueValue ? Number(issueValue) : undefined;
  const discordThreadId = valueAfter(args, "--discord-thread-id");
  const apply = args.includes("--apply");
  if (!command || !["status", "request", "controls"].includes(command)) {
    fail(
      "Usage: run-controls.ts <status|request|controls> [--run-id <run_id>] [--action <take_control|preview_start|preview_stop|stop|discard_local|discard_published|ci_repair|ai_review|review_fix|recover_managed_task>] [--via <telegram|discord|cli>] [--project <project>] [--issue <number>] [--discord-thread-id <id>] [--apply]",
    );
  }
  if (command !== "controls" && !runId) fail(`${command} requires --run-id`);
  if (runId && !/^r_[a-zA-Z0-9_]+$/u.test(runId)) fail("Invalid run ID");
  if (command === "status" && (action || apply || args.includes("--via"))) {
    fail("status accepts only --run-id");
  }
  if (
    command === "request" &&
    (!action ||
      ![
        "take_control",
        "preview_start",
        "preview_stop",
        "stop",
        "discard_local",
        "discard_published",
        "ci_repair",
        "ai_review",
        "review_fix",
        "recover_managed_task",
      ].includes(action))
  ) {
    fail("request requires a supported --action");
  }
  if (!(["telegram", "discord", "cli"] as string[]).includes(via))
    fail("Unsupported request source");
  if (command === "controls") {
    if (runId || action || apply || args.includes("--via"))
      fail("controls accepts only --project, --issue, or --discord-thread-id");
    if (project && !/^[a-z0-9_-]+$/u.test(project)) fail("Invalid project");
    if (issue !== undefined && (!Number.isInteger(issue) || issue <= 0))
      fail("Invalid issue number");
    if (discordThreadId && !/^\d+$/u.test(discordThreadId))
      fail("Invalid Discord thread ID");
  } else if (project || issue !== undefined || discordThreadId) {
    fail(`${command} does not accept controls lookup filters`);
  }
  return {
    command,
    runId,
    action,
    via,
    profile,
    project,
    issue,
    discordThreadId,
    apply,
  };
}

export function runControlStatus(
  database: DatabaseSync,
  runId: string,
  profile: ReviewProfile = "general",
): Record<string, unknown> {
  const run = database
    .prepare(
      `
    SELECT r.run_id, r.project, r.item_id, r.repository, r.issue_number,
           pe.title, pe.url AS issue_url, r.interaction_policy,
           r.execution_mode,
           r.state, r.owner_state, r.stop_reason,
           r.preview_required, r.preview_required_label,
           r.completion_requested_at,
           r.preview_requirement_satisfied_at,
           r.preview_requirement_lease_id,
           rr.resource_state, rr.branch_name, rr.worktree_path,
           rr.codex_thread_id, rr.previous_codex_thread_id,
           rr.tmux_session_name, rr.preview_id,
           ${LATEST_ATTENTION_SQL},
           ${LATEST_SUCCESSOR_STATE_SQL},
           ${LATEST_SUCCESSOR_THREAD_SQL},
           ${ACTIVE_SUCCESSOR_COUNT_SQL},
           pl.lease_id AS preview_lease_id,
           ps.hostname AS preview_hostname,
           pl.state AS preview_state,
           pl.expires_at AS preview_expires_at,
           pl.extension_count AS preview_extension_count,
           pl.reviewed_at AS preview_reviewed_at,
           pl.reviewed_by AS preview_reviewed_by,
           pl.reviewed_via AS preview_reviewed_via,
           pl.verified_head_sha AS preview_verified_head_sha,
           pl.runtime_adapter AS preview_runtime_adapter,
           pl.artifact_root AS preview_artifact_root,
           pl.artifact_digest AS preview_artifact_digest,
           pl.artifact_file_count AS preview_artifact_file_count,
           pl.artifact_total_bytes AS preview_artifact_total_bytes,
           ci.pull_request_number AS ci_pull_request_number,
           ci.pull_request_url AS ci_pull_request_url,
           ci.head_sha AS ci_head_sha,
           ci.aggregate_state AS ci_aggregate_state,
           ci.checks_json AS ci_checks_json,
           (SELECT COUNT(*) FROM run_ci_repair_attempts a
            WHERE a.run_id = r.run_id) AS ci_repair_attempt_count,
           (SELECT attempt_state FROM run_ci_repair_attempts a
            WHERE a.run_id = r.run_id
            ORDER BY a.attempt_number DESC LIMIT 1) AS ci_repair_state,
           (SELECT COUNT(*) FROM run_ai_reviews a WHERE a.run_id=r.run_id AND a.review_state='running') AS review_active_count,
           (SELECT review_state FROM run_ai_reviews ar
            WHERE ar.run_id = r.run_id AND ar.review_profile='${profile}'
            ORDER BY ar.review_number DESC LIMIT 1) AS ai_review_state,
           (SELECT head_sha FROM run_ai_reviews ar
            WHERE ar.run_id = r.run_id AND ar.review_profile='${profile}'
            ORDER BY ar.review_number DESC LIMIT 1) AS ai_review_head_sha,
           (SELECT critical_count FROM run_ai_reviews ar
            WHERE ar.run_id = r.run_id AND ar.review_profile='${profile}'
            ORDER BY ar.review_number DESC LIMIT 1) AS ai_review_critical_count,
           (SELECT important_count FROM run_ai_reviews ar
            WHERE ar.run_id = r.run_id AND ar.review_profile='${profile}'
            ORDER BY ar.review_number DESC LIMIT 1) AS ai_review_important_count,
           (SELECT suggestion_count FROM run_ai_reviews ar
            WHERE ar.run_id = r.run_id AND ar.review_profile='${profile}'
            ORDER BY ar.review_number DESC LIMIT 1) AS ai_review_suggestion_count
           ,(SELECT round_state FROM run_review_fix_rounds rf
             WHERE rf.run_id = r.run_id
             ORDER BY rf.round_number DESC LIMIT 1) AS review_fix_state
           ,(SELECT round_number FROM run_review_fix_rounds rf
             WHERE rf.run_id = r.run_id
             ORDER BY rf.round_number DESC LIMIT 1) AS review_fix_round_number
    FROM runs r
    JOIN run_resources rr USING (run_id)
    JOIN project_events pe ON pe.event_id = r.trigger_event_id
    LEFT JOIN preview_leases pl
      ON pl.run_id = r.run_id AND pl.state <> 'released'
    LEFT JOIN preview_slots ps USING (slot_number)
    LEFT JOIN run_ci_snapshots ci USING (run_id)
    WHERE r.run_id = ?
  `,
    )
    .get(runId) as Record<string, unknown> | undefined;
  if (!run) fail(`Run not found: ${runId}`);
  const requests = database
    .prepare(
      `
    SELECT request_id, action, review_profile, request_state, requested_via, result_json,
           created_at, completed_at
    FROM run_control_requests
    WHERE run_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `,
    )
    .all(runId);
  return {
    ...run,
    technical_worker_diagnostic: technicalWorkerDiagnostic(database, runId),
    preview_url: run.preview_hostname
      ? `https://${String(run.preview_hostname)}`
      : null,
    requests,
  };
}

function presentPendingRequest(
  database: DatabaseSync,
  runId: string,
  action: Action,
): void {
  let presentation = pendingPresentations[action];
  if (action === "take_control") {
    const ownership = database
      .prepare(`
        SELECT r.state, r.owner_state, r.execution_mode, rr.resource_state,
               rr.worktree_path, rr.branch_name,
               rr.tmux_session_name, rr.codex_thread_id,
               rr.previous_codex_thread_id,
               ${LATEST_ATTENTION_SQL},
               ${LATEST_SUCCESSOR_STATE_SQL},
               ${LATEST_SUCCESSOR_THREAD_SQL},
               ${ACTIVE_SUCCESSOR_COUNT_SQL}
        FROM runs r JOIN run_resources rr USING (run_id)
        WHERE r.run_id=?
      `)
      .get(runId) as Parameters<typeof recoverySnapshot>[0] | undefined;
    if (
      ownership &&
      ((ownership.state === "remote_owned" &&
        ownership.owner_state === "remote") ||
        isFailedAutonomousSuccessorRecovery(recoverySnapshot(ownership)))
    ) {
      presentation = {
        stage: "autonomous_successor_pending",
        detail:
          "Autonomous continuation requested; starting a fresh managed Codex task after the owner's explicit Remote-task boundary.",
      };
    }
  }
  if (action === "preview_start") {
    const active = database
      .prepare(`
        SELECT state FROM preview_leases
        WHERE run_id = ? AND state <> 'released'
        ORDER BY leased_at DESC LIMIT 1
      `)
      .get(runId) as { state: string } | undefined;
    if (active?.state === "running") {
      presentation = {
        stage: "preview_extending",
        detail: "Preview extension requested; validating the active lease and expiry window.",
      };
    }
  }
  if (!presentation) return;
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        runId,
        action,
        stage: presentation.stage,
        detail: presentation.detail,
      }),
    )
    .digest("hex");
  database
    .prepare(
      `
      INSERT INTO run_progress_cards (
        run_id, stage, detail, content_digest, delivery_state
      ) VALUES (?, ?, ?, ?, 'pending')
      ON CONFLICT(run_id) DO UPDATE SET
        stage = excluded.stage,
        detail = excluded.detail,
        content_digest = excluded.content_digest,
        delivery_state = 'pending',
        last_error = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `,
    )
    .run(runId, presentation.stage, presentation.detail, digest);
}

export function requestRunControl(
  database: DatabaseSync,
  runId: string,
  action: Action,
  via: RequestSource,
  apply: boolean,
  options: { home?: string; idempotencyKey?: string; profile?: ReviewProfile } = {},
): Record<string, unknown> {
  const profile = parseReviewProfile(options.profile);
  if (profile !== "general" && !["ai_review", "review_fix"].includes(action)) fail("Profile requires a review action");
  const ownsTransaction = !database.isTransaction;
  if (ownsTransaction) database.exec("BEGIN IMMEDIATE");
  const home = options.home ?? orchestratorHome;
  const projectsPath = resolve(home,"config/projects.yaml");
  try {
    if(hasActivePrRequest(database,runId))fail("A GitHub PR action is still pending; check its result in Projects first");
    const run = database
      .prepare(
        `
      SELECT r.project, r.state, r.owner_state, r.stop_reason,
             r.execution_mode, rr.resource_state, rr.worktree_path,
             rr.branch_name, rr.tmux_session_name, rr.codex_thread_id,
             rr.previous_codex_thread_id,
             ${LATEST_ATTENTION_SQL},
             ${LATEST_SUCCESSOR_STATE_SQL},
             ${LATEST_SUCCESSOR_THREAD_SQL},
             ${ACTIVE_SUCCESSOR_COUNT_SQL}
      FROM runs r JOIN run_resources rr USING (run_id)
      WHERE r.run_id = ?
    `,
      )
      .get(runId) as
      | {
          project: string;
          state: string;
          owner_state: string;
          stop_reason: string | null;
          execution_mode: string;
          resource_state: string;
          worktree_path: string | null;
          branch_name: string | null;
          tmux_session_name: string | null;
          codex_thread_id: string | null;
          previous_codex_thread_id: string | null;
          latest_attention_reason: string | null;
          latest_autonomous_successor_state: string | null;
          latest_autonomous_successor_predecessor_thread_id: string | null;
          autonomous_successor_active: number;
        }
      | undefined;
    if (!run) fail(`Run not found: ${runId}`);
    const recovery = recoverySnapshot(run);
    const failedSuccessorRecovery =
      isFailedAutonomousSuccessorRecovery(recovery);
    const requestIntent =
      action === "take_control" &&
      ((run.state === "remote_owned" && run.owner_state === "remote") ||
        failedSuccessorRecovery)
        ? "autonomous_successor"
        : undefined;
    if (["rejected", "cancelled", "archived"].includes(run.state)) {
      fail(`Run is terminal: ${run.state}`);
    }
    const conflictingRequest = database
      .prepare(
        `SELECT action FROM run_control_requests
         WHERE run_id = ? AND request_state IN ('pending','processing')
           AND NOT (? = 'preview_stop' AND action = 'preview_start' AND request_state = 'pending')
           AND (
             action = 'review_fix' OR
             action = 'recover_managed_task' OR
             (? IN ('review_fix','recover_managed_task')
               AND action IN ('take_control','ci_repair','ai_review','review_fix','recover_managed_task')) OR
             (action IN ('preview_start','preview_stop') AND ? IN ('preview_start','preview_stop'))
           )
         LIMIT 1`,
      )
      .get(runId, action, action, action) as { action: string } | undefined;
    if (conflictingRequest && action !== "stop" && conflictingRequest.action !== action)
      fail(`Action conflicts with queued ${conflictingRequest.action}`);
    if (action === "stop" && run.stop_reason === "cancelled") {
      fail("Run cancellation is already in progress or awaiting resolution");
    }
    if (action === "take_control" && run.stop_reason === "cancelled") {
      fail("Takeover is unavailable after cancellation was requested");
    }
    if (action === "take_control" && run.previous_codex_thread_id !== null) {
      fail("Takeover is unavailable while a technical fix task cleanup is pending");
    }
    if (action === "take_control" && run.state === "needs_attention") {
      const cliHandoff = isNeedsAttentionCliHandoff(recovery);
      if (
        run.execution_mode !== "live" ||
        (!cliHandoff &&
          !(
            failedSuccessorRecovery &&
            Boolean(run.worktree_path) &&
            Boolean(run.branch_name)
          ))
      ) {
        fail("Needs-attention run has no safe managed recovery action");
      }
    }
    if (action === "take_control" && run.owner_state === "remote") {
      if (
        run.state !== "remote_owned" ||
        run.resource_state !== "provisioned" ||
        run.tmux_session_name !== null ||
        !run.codex_thread_id ||
        !run.worktree_path ||
        !run.branch_name ||
        run.autonomous_successor_active !== 0
      ) {
        fail(
          "Autonomous continuation requires one finished Remote task, a provisioned worktree, and no active managed writer",
        );
      }
    }
    if (action === "recover_managed_task") {
      const existingRecovery = database
        .prepare(
          `SELECT request_id FROM run_control_requests
           WHERE run_id=? AND action='recover_managed_task'
             AND request_state IN ('pending','processing')
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(runId) as { request_id: string } | undefined;
      const recoverySnapshot = loadManagedReviewFixRecoverySnapshot(
        database,
        runId,
        existingRecovery?.request_id ?? null,
      );
      const recoveryInspection = recoverySnapshot
        ? inspectManagedReviewFixRecovery(
            recoverySnapshot,
            (parse(readFileSync(projectsPath, "utf8")) as ProjectsRegistry)
              .projects[run.project],
          )
        : { eligible: false as const, reason: "run_not_found" };
      if (!recoveryInspection.eligible)
        fail(
          `Run is not eligible for managed review-fix recovery: ${recoveryInspection.reason}`,
        );
    }
    if (
      ["discard_local", "discard_published"].includes(action) &&
      !(
        run.state === "needs_attention" &&
        run.owner_state === "none" &&
        run.stop_reason === "cancelled"
      )
    ) {
      fail(
        "Preserved work can be resolved only after a cancelled run is safely stopped for attention",
      );
    }
    if (
      ["preview_start", "preview_stop"].includes(action) &&
      !projectSupportsPreview(run.project,home)
    ) {
      fail(`Preview is not configured for project: ${run.project}`);
    }
    if (action === "preview_start") {
      const activeReviewFix = database
        .prepare(
          `SELECT COUNT(*) AS count FROM run_review_fix_rounds
           WHERE run_id=? AND round_state IN ('running','waiting_ci','resolving')`,
        )
        .get(runId) as { count: number };
      if (activeReviewFix.count > 0)
        fail("Preview cannot start while review fixes are being applied or validated");
    }
    if (action === "ci_repair") {
      const eligibility = database
        .prepare(
          `SELECT rr.resource_state, rr.tmux_session_name,
                  rr.codex_thread_id, rr.previous_codex_thread_id,
                  ci.head_sha, ci.aggregate_state,
                  (SELECT COUNT(*) FROM run_ci_repair_attempts a
                   WHERE a.run_id = r.run_id) AS attempt_count,
                  (SELECT COUNT(*) FROM run_ci_repair_attempts a
                   WHERE a.run_id = r.run_id
                     AND a.attempt_state IN ('running', 'waiting_ci'))
                    AS active_count
           FROM runs r JOIN run_resources rr USING (run_id)
           LEFT JOIN run_ci_snapshots ci USING (run_id)
           WHERE r.run_id = ?`,
        )
        .get(runId) as {
        resource_state: string;
        tmux_session_name: string | null;
        codex_thread_id: string | null;
        previous_codex_thread_id: string | null;
        head_sha: string | null;
        aggregate_state: string | null;
        attempt_count: number;
        active_count: number;
      };
      if (
        run.state !== "parked_review" ||
        run.owner_state !== "none" ||
        eligibility.resource_state !== "provisioned" ||
        eligibility.tmux_session_name !== null ||
        !eligibility.codex_thread_id ||
        eligibility.previous_codex_thread_id !== null ||
        !eligibility.head_sha ||
        !["failed", "missing"].includes(eligibility.aggregate_state ?? "") ||
        eligibility.attempt_count >= 2 ||
        eligibility.active_count !== 0
      ) {
        fail("Run is not eligible for a bounded CI repair attempt");
      }
    }
    if (action === "ai_review") {
      const eligibility = database
        .prepare(
          `SELECT rr.resource_state, rr.tmux_session_name, rr.worktree_path,
                  rr.branch_name,
                  (SELECT COUNT(*) FROM run_ci_repair_attempts repair
                   WHERE repair.run_id = r.run_id
                     AND repair.attempt_state IN ('running', 'waiting_ci'))
                    AS active_repair_count,
                  (SELECT COUNT(*) FROM run_ai_reviews review
                   WHERE review.run_id = r.run_id
                     AND review.review_state = 'running') AS active_review_count
           FROM runs r JOIN run_resources rr USING (run_id)
           WHERE r.run_id = ?`,
        )
        .get(runId) as {
        resource_state: string;
        tmux_session_name: string | null;
        worktree_path: string | null;
        branch_name: string | null;
        active_repair_count: number;
        active_review_count: number;
      };
      if (!aiReviewStable({ ...eligibility, state: run.state, owner_state: run.owner_state }))
        fail("Run is not eligible for AI Code Review");
    }
    if (action === "review_fix") {
      const eligibility = database
        .prepare(
          `SELECT rr.resource_state, rr.tmux_session_name, rr.worktree_path,
                  rr.branch_name, ci.head_sha,
                  (SELECT COUNT(*) FROM run_ci_repair_attempts repair
                   WHERE repair.run_id = r.run_id
                     AND repair.attempt_state IN ('running','waiting_ci')) AS active_repair_count,
                  (SELECT COUNT(*) FROM run_ai_reviews review
                   WHERE review.run_id = r.run_id
                     AND review.review_state = 'running') AS active_review_count,
                  (SELECT COUNT(*) FROM run_review_fix_rounds fix
                   WHERE fix.run_id = r.run_id
                     AND fix.round_state IN ('running','waiting_ci','resolving')) AS active_fix_count
           FROM runs r JOIN run_resources rr USING (run_id)
           LEFT JOIN run_ci_snapshots ci USING (run_id)
           WHERE r.run_id = ?`,
        )
        .get(runId) as {
        resource_state: string;
        tmux_session_name: string | null;
        worktree_path: string | null;
        branch_name: string | null;
        head_sha: string | null;
        active_repair_count: number;
        active_review_count: number;
        active_fix_count: number;
      };
      if (
        run.state !== "parked_review" ||
        run.owner_state !== "none" ||
        eligibility.resource_state !== "provisioned" ||
        eligibility.tmux_session_name !== null ||
        !eligibility.worktree_path ||
        !eligibility.branch_name ||
        !eligibility.head_sha ||
        eligibility.active_repair_count !== 0 ||
        eligibility.active_review_count !== 0 ||
        eligibility.active_fix_count !== 0 ||
        run.previous_codex_thread_id !== null
      )
        fail("Run is not eligible for Fix Review");
    }
    if (
      action === "preview_start" &&
      !(
        (run.owner_state === "none" &&
          ["parked_review", "waiting_human"].includes(run.state)) ||
        (run.owner_state === "remote" && run.state === "remote_owned")
      )
    ) {
      fail(
        "Preview can start only after autonomous work reaches a stable review state",
      );
    }
    const existing = database
      .prepare(
        `
      SELECT request_id, request_state, review_profile
      FROM run_control_requests
      WHERE run_id = ? AND action = ?
        AND request_state IN ('pending', 'processing')
      ORDER BY created_at DESC LIMIT 1
    `,
      )
      .get(runId, action) as
      | { request_id: string; request_state: string; review_profile: string }
      | undefined;
    if (existing) {
      if (existing.review_profile !== profile) fail("Another review profile is already queued; wait for its result");
      if (apply) presentPendingRequest(database, runId, action);
      if (ownsTransaction) database.exec("COMMIT");
      return {
        action: "existing",
        runId,
        requestedAction: action,
        ...(requestIntent ? { intent: requestIntent } : {}),
        ...existing,
      };
    }

    const idempotencyKey = options.idempotencyKey ?? `${via}:${runId}:${action}:${randomUUID()}`;
    const plan = {
      requestId: `rq_${randomUUID().replaceAll("-", "")}`,
      runId,
      requestedAction: action,
      profile,
      via,
      idempotencyKey,
    };
    if (!apply) {
      if (ownsTransaction) database.exec("ROLLBACK");
      return {
        action: "create",
        ...plan,
        ...(requestIntent ? { intent: requestIntent } : {}),
      };
    }
    database
      .prepare(
        `
      INSERT INTO run_control_requests (
        request_id, run_id, action, requested_via, idempotency_key, review_profile
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `,
      )
      .run(plan.requestId, runId, action, via, idempotencyKey, profile);
    const stored = database
      .prepare(
        `
      SELECT request_id, request_state FROM run_control_requests
      WHERE idempotency_key = ?
    `,
      )
      .get(idempotencyKey) as { request_id: string; request_state: string };
    if (action === "preview_stop" && stored.request_id === plan.requestId) {
      // Supersede only unclaimed starts, atomically with the supported stop request.
      // A processing start remains a conflict: its runtime side effect may be active.
      database.prepare(`
        UPDATE run_control_requests
        SET request_state = 'rejected',
            result_json = json_object('reason', 'preview_start_superseded_by_stop',
                                      'supersededByRequestId', ?),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ? AND action = 'preview_start' AND request_state = 'pending'
      `).run(stored.request_id, runId);
    }
    presentPendingRequest(database, runId, action);
    if (ownsTransaction) database.exec("COMMIT");
    return {
      action: stored.request_id === plan.requestId ? "created" : "existing",
      runId,
      requestedAction: action,
      ...(requestIntent ? { intent: requestIntent } : {}),
      requestId: stored.request_id,
      requestState: stored.request_state,
    };
  } catch (error) {
    if (ownsTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

function controls(
  database: DatabaseSync,
  filters: {
    project?: string;
    issue?: number;
    discordThreadId?: string;
  },
): Record<string, unknown> {
  const conditions = [
    "r.state NOT IN ('rejected', 'cancelled', 'archived', 'failed')",
  ];
  const parameters: Array<string | number> = [];
  if (filters.project) {
    conditions.push("r.project = ?");
    parameters.push(filters.project);
  }
  if (filters.issue !== undefined) {
    conditions.push("r.issue_number = ?");
    parameters.push(filters.issue);
  }
  if (filters.discordThreadId) {
    conditions.push("ds.thread_id = ?");
    parameters.push(filters.discordThreadId);
  }
  const rows = database
    .prepare(
      `
      SELECT r.run_id
      FROM runs r
      LEFT JOIN run_discord_surfaces ds USING (run_id)
      WHERE ${conditions.join(" AND ")}
      ORDER BY r.created_at DESC, r.run_id DESC
      LIMIT 2
    `,
    )
    .all(...parameters) as Array<{ run_id: string }>;
  if (rows.length === 0)
    fail("No eligible nonterminal run matches the filters");
  if (rows.length > 1)
    fail(
      "Multiple eligible runs match; provide project, issue, or Discord thread",
    );
  return availableRunControls(database,rows[0]!.run_id);
}

/** The existing control menu, reusable by owner interfaces without starting a CLI. */
export function availableRunControls(database: DatabaseSync, runId: string, options: {home?:string;now?:number;profile?:ReviewProfile} = {}): Record<string,unknown> {
  const selected = runControlStatus(database,runId,parseReviewProfile(options.profile));
  if(hasActivePrRequest(database,runId))return {...selected,available_actions:["status"]};
  if (["rejected","cancelled","archived","failed"].includes(String(selected.state))) return {...selected,available_actions:["status"]};
  const home = options.home ?? orchestratorHome;
  const projectsPath = resolve(home,"config/projects.yaml");
  const runState = String(selected.state);
  const ownerState = String(selected.owner_state);
  const threadReady = Boolean(selected.codex_thread_id);
  const repairCleanupPending = Boolean(selected.previous_codex_thread_id);
  const previewState = selected.preview_state
    ? String(selected.preview_state)
    : null;
  const pendingActions = new Set(
    (
      selected.requests as Array<{ action?: unknown; request_state?: unknown }>
    )
      .filter((request) =>
        ["pending", "processing"].includes(String(request.request_state)),
      )
      .map((request) => String(request.action)),
  );
  const cancellationStarted = selected.stop_reason === "cancelled";
  const reviewFixBusy =
    pendingActions.has("review_fix") ||
    ["running", "waiting_ci", "resolving"].includes(
      String(selected.review_fix_state),
    );
  const selectedRecovery = recoverySnapshot(
    selected as unknown as Parameters<typeof recoverySnapshot>[0],
  );
  const attentionCliHandoff = isNeedsAttentionCliHandoff(selectedRecovery);
  const failedSuccessorRecovery =
    isFailedAutonomousSuccessorRecovery(selectedRecovery);
  const availableActions = ["status"];
  const managedRecoverySnapshot = loadManagedReviewFixRecoverySnapshot(
    database,
    String(selected.run_id),
  );
  const managedRecoveryInspection = managedRecoverySnapshot
    ? inspectManagedReviewFixRecovery(
        managedRecoverySnapshot,
        (parse(readFileSync(projectsPath, "utf8")) as ProjectsRegistry)
          .projects[String(selected.project)],
      )
    : { eligible: false as const, reason: "run_not_found" };
  if (
    managedRecoveryInspection.eligible &&
    !pendingActions.has("recover_managed_task")
  )
    availableActions.push("recover_managed_task");
  if (
    !reviewFixBusy &&
    threadReady &&
    !repairCleanupPending &&
    ((ownerState === "cli" && runState !== "needs_attention") ||
      attentionCliHandoff ||
      failedSuccessorRecovery ||
      (ownerState === "remote" && runState === "remote_owned") ||
      (ownerState === "none" &&
        ["parked_review", "waiting_human"].includes(runState)))
  )
    if (!pendingActions.has("take_control"))
      availableActions.push("take_control");
  if (projectSupportsPreview(String(selected.project),home)) {
    const previewStartProcessing = (
      selected.requests as Array<{ action?: unknown; request_state?: unknown }>
    ).some(request => request.action === "preview_start" && request.request_state === "processing");
    if (!reviewFixBusy && !previewStartProcessing &&
        (previewState || pendingActions.has("preview_start")) && !pendingActions.has("preview_stop"))
      availableActions.push("preview_stop");
    if (
      !reviewFixBusy &&
      previewState === "running" &&
      previewExtensionAvailable(selected.preview_expires_at,home,options.now) &&
      !pendingActions.has("preview_start")
    )
      availableActions.push("preview_start");
    else if (
      !reviewFixBusy &&
      !previewState &&
      !pendingActions.has("preview_start") &&
      ownerState === "none" &&
      ["parked_review", "waiting_human"].includes(runState)
    )
      availableActions.push("preview_start");
  }
  if (
    runState === "parked_review" &&
    !reviewFixBusy &&
    ownerState === "none" &&
    Boolean(selected.codex_thread_id) &&
    !repairCleanupPending &&
    Boolean(selected.ci_head_sha) &&
    ["failed", "missing"].includes(String(selected.ci_aggregate_state)) &&
    Number(selected.ci_repair_attempt_count) < 2 &&
    !["running", "waiting_ci"].includes(String(selected.ci_repair_state)) &&
    !pendingActions.has("ci_repair")
  )
    availableActions.push("ci_repair");
  if (
    runState === "parked_review" &&
    !reviewFixBusy &&
    ownerState === "none" &&
    Boolean(selected.worktree_path) &&
    Boolean(selected.branch_name) &&
    !repairCleanupPending &&
    Number(selected.review_active_count) === 0 &&
    !(
      String(selected.ai_review_state) === "ready" &&
      (!selected.ci_head_sha ||
        selected.ai_review_head_sha === selected.ci_head_sha)
    ) &&
    !pendingActions.has("ai_review")
  )
    availableActions.push("ai_review");
  const currentAiReviewHasFindings =
    String(selected.ai_review_state) === "ready" &&
    Boolean(selected.ci_head_sha) &&
    selected.ai_review_head_sha === selected.ci_head_sha &&
    Number(selected.ai_review_critical_count) +
      Number(selected.ai_review_important_count) +
      Number(selected.ai_review_suggestion_count) >
      0;
  if (
    runState === "parked_review" &&
    ownerState === "none" &&
    Boolean(selected.codex_thread_id) &&
    !repairCleanupPending &&
    currentAiReviewHasFindings &&
    Number(selected.review_active_count) === 0 &&
    !["running", "waiting_ci", "resolving"].includes(
      String(selected.review_fix_state),
    ) &&
    !pendingActions.has("review_fix")
  )
    availableActions.push("review_fix");
  if (!cancellationStarted && !pendingActions.has("stop"))
    availableActions.push("stop");
  return { ...selected, available_actions: availableActions,
    take_control_autonomous: (ownerState === "remote" && runState === "remote_owned") || failedSuccessorRecovery };
}

export function runRunControlsCli(): void {
  const args = parseArguments();
  const database = openOrchestratorDatabase(databasePath);
  try {
    const result =
      args.command === "status"
        ? runControlStatus(database, args.runId!)
        : args.command === "controls"
          ? controls(database, {
              project: args.project,
              issue: args.issue,
              discordThreadId: args.discordThreadId,
            })
          : requestRunControl(database, args.runId!, args.action!, args.via, args.apply, {profile:args.profile});
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  try {
    runRunControlsCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  }
}
