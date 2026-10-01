import { execFileSync } from "node:child_process";
import { isProtocolThread } from "../integrations/codex/task-store.ts";
import { protocolRemoteBlocker } from "../projects/sessions/protocol-session.ts";
import type { DatabaseSync } from "node:sqlite";
import type { ControllerAction, PlannedAction } from "./request-plan.ts";
import { previewCompletionOwnershipStable } from "./run-predicates.ts";
import {
  autonomousSuccessorPath,
  cancelResolutionPath,
  fail,
  orchestratorHome,
  previewManagerPath,
  previewRuntimePath,
  projectStatusPath,
  provisionerPath,
  releaserPath,
  reviewFixManagerPath,
  reviewManagerPath,
  sessionManagerPath,
} from "./controller-context.ts";

export function externalCommand(
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
    case "recover_managed_task":
      if (!requestId) fail("Managed task recovery requires a request ID");
      return [
        sessionManagerPath,
        "recover-managed-task",
        "--run-id",
        runId,
        "--request-id",
        requestId,
        "--apply",
      ];
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
    case "project_review":
      return [projectStatusPath, "review", "--run-id", runId, "--apply"];
    default:
      return null;
  }
}

export function completeRequest(
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

export function hasReconcilableReviewFixOperation(
  database: DatabaseSync,
  plan: PlannedAction,
): boolean {
  if (plan.action !== "recover_managed_task" || !plan.requestId) return false;
  return Boolean(
    database
      .prepare(
        `SELECT 1 FROM run_review_fix_operations o
         JOIN run_review_fix_rounds f USING (round_id)
         WHERE f.run_id=? AND o.operation_kind='managed_recovery'
           AND o.request_id=?
           AND o.operation_state IN ('claimed','side_effect_succeeded')`,
      )
      .get(plan.runId, plan.requestId),
  );
}

export function applyInternal(database: DatabaseSync, plan: PlannedAction): unknown {
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
      const mapping = database.prepare("SELECT codex_thread_id FROM run_resources WHERE run_id=?").get(plan.runId) as {codex_thread_id:string|null};
      if (isProtocolThread(database,mapping?.codex_thread_id ?? null)) fail(protocolRemoteBlocker);
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
        WHERE run_id = ? AND state NOT IN ('rejected', 'cancelled', 'archived')
      `,
        )
        .run(plan.runId);
      if (changed.changes !== 1 && current.state !== "stopping")
        fail("Run changed before stop request");
      database
        .prepare(
          `UPDATE run_control_requests
           SET request_state='rejected',
               result_json=json_object('reason', 'cancellation_requested'),
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE run_id=? AND request_id<>?
             AND request_state IN ('pending','processing')`,
        )
        .run(plan.runId, plan.requestId!);
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
                 ci.head_sha, r.preview_requirement_satisfied_at,
                 pl.lease_id, pl.verified_head_sha, pl.reviewed_at
          FROM runs r
          LEFT JOIN run_ci_snapshots ci USING (run_id)
          LEFT JOIN preview_leases pl
            ON pl.lease_id = r.preview_requirement_lease_id
          WHERE r.run_id = ? AND r.preview_required = 1
            AND r.completion_requested_at IS NOT NULL
            AND r.preview_requirement_satisfied_at IS NOT NULL
        `)
        .get(plan.runId) as
        | {
            state: string;
            owner_state: string;
            completion_source_event_id: string | null;
            head_sha: string | null;
            lease_id: string | null;
            verified_head_sha: string | null;
            reviewed_at: string | null;
          }
        | undefined;
      if (
        !evidence ||
        !previewCompletionOwnershipStable(evidence.state, evidence.owner_state) ||
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
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE run_id = ?
            AND ((state = 'parked_review' AND owner_state = 'none')
              OR (state = 'remote_owned' AND owner_state = 'remote'))
            AND stop_reason IS NULL AND preview_requirement_satisfied_at IS NOT NULL
        `)
        .run(plan.runId);
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

export function runExternal(plan: PlannedAction): unknown {
  const args = externalCommand(plan.action, plan.runId, plan.requestId, plan.roundId);
  if (!args) fail(`No external command for ${plan.action}`);
  const stdout = execFileSync(process.execPath, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      KURAMI_HOME: orchestratorHome,
      KURAMI_CONTROLLER_ACTION: plan.action,
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const lastLine = stdout.split("\n").filter(Boolean).at(-1);
  return lastLine ? JSON.parse(lastLine) : null;
}

export type ControllerActionEffects = {
  internal: (database: DatabaseSync, plan: PlannedAction) => unknown;
  external: (plan: PlannedAction) => unknown;
  complete: typeof completeRequest;
};

const productionEffects: ControllerActionEffects = {
  internal: applyInternal,
  external: runExternal,
  complete: completeRequest,
};

export function executePlannedAction(
  database: DatabaseSync,
  plan: PlannedAction,
  effects: ControllerActionEffects = productionEffects,
): unknown {
  const internal = [
    "claim_remote",
    "request_stop",
    "resume_stop",
    "preview_requirement_complete",
    "request_complete",
    "request_reject",
  ].includes(plan.action);
  const result = internal
    ? effects.internal(database, plan)
    : effects.external(plan);
  if (
    plan.requestId &&
    ["handoff", "successor_start", "preview_up", "preview_down", "preview_expire", "preview_extend", "repair_start", "review_start", "review_fix_start", "recover_managed_task"].includes(plan.action)
  ) {
    effects.complete(database, plan.requestId, plan.requestOutcome ?? "applied", result);
  }
  if (
    plan.requestId &&
    ["discard_cancelled", "discard_published_cancelled"].includes(plan.action)
  ) {
    const action = (result as { action?: string } | null)?.action;
    effects.complete(
      database,
      plan.requestId,
      ["discarded_local_work", "discarded_published_work"].includes(action ?? "")
        ? "applied"
        : "rejected",
      result,
    );
  }
  return result;
}
