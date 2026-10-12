import { createHash } from "node:crypto";
import { lifecycleFeedbackKey } from "../projects/lifecycle-feedback.ts";
import type { DatabaseSync } from "node:sqlite";
import { baseRunSelect, previewNeedsExtension } from "./run-read-model.ts";
import { previewEvidenceCurrent, previewRequirementSatisfied, projectDiscoveryFresh } from "./run-predicates.ts";
import type { OrchestratorConfig, ProgressRow } from "./controller-types.ts";

export function ensureControlEvents(database: DatabaseSync): void {
  database
    .prepare(
      `
    INSERT OR IGNORE INTO run_control_events (
      event_id, run_id, event_kind, payload_json
    )
    SELECT 'ce_' || r.run_id || '_review_' || COALESCE((
             SELECT MAX(h.sequence) FROM run_state_history h
             WHERE h.run_id = r.run_id
               AND h.reason IN ('codex_cli_park_completed','codex_protocol_park_completed')
           ), 0),
           r.run_id, 'review_ready',
           json_object('project', r.project, 'issueNumber', r.issue_number)
    FROM runs r
    JOIN run_resources rr USING (run_id)
    WHERE r.state = 'parked_review' AND r.owner_state = 'none'
      AND rr.tmux_session_name IS NULL AND rr.codex_thread_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM run_ci_snapshots ci WHERE ci.run_id=r.run_id
        AND ci.pull_request_url IS NOT NULL AND ci.head_sha IS NOT NULL)
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
  if (run.run_state === "stopping") {
    return {
      stage: "stopping",
      detail: "Stopping active resources and checking cleanup safety.",
    };
  }
  if (
    run.run_state === "needs_attention" &&
    run.stop_reason === "completed" &&
    run.latest_attention_reason === "completion_waiting_for_merge"
  ) {
    return {
      stage: "needs_attention",
      detail: "Done has no verified merge. Work is preserved; merge the pull request or cancel the run.",
    };
  }
  if (
    run.preview_required === 1 &&
    run.completion_requested_at !== null &&
    !previewEvidenceCurrent(run)
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
    if (!run.ci_pull_request_url || !run.ci_head_sha) return {
      stage: "waiting_human",
      detail: "Codex stopped before delivering a reviewable PR. Local work is preserved.",
    };
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
      codex_waiting_on_approval:
        "Managed Codex unexpectedly requested interactive approval. No approval was applied; automation is paused so the policy can be investigated safely.",
      main_writer_runtime_budget_exceeded: `Main Codex writer exceeded its ${config.limits.main_writer_timeout_minutes}-minute limit. The worktree, branch, thread reference, and terminal evidence were preserved.`,
      ci_repair_runtime_budget_exceeded: `CI repair worker exceeded its ${config.limits.technical_worker_timeout_minutes}-minute limit. The worktree, thread reference, and terminal evidence were preserved.`,
      review_fix_runtime_budget_exceeded: `Review-fix worker exceeded its ${config.limits.technical_worker_timeout_minutes}-minute limit. The worktree, thread reference, and terminal evidence were preserved.`,
      ai_review_runtime_budget_exceeded: `AI review worker exceeded its ${config.limits.technical_worker_timeout_minutes}-minute limit. Its terminal evidence and the run worktree were preserved.`,
      autonomous_successor_start_failed:
        "The autonomous continuation could not start. The prior Codex thread, exact worktree, and branch were preserved; Continue autonomously can retry this guarded start.",
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

export function reconcileProgressCards(
  database: DatabaseSync,
  config: OrchestratorConfig,
): void {
  const runs = database
    .prepare(
      `
    SELECT base.*, pe.title, r.repository
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
    const feedback = database.prepare("SELECT delivery_error FROM github_lifecycle_feedback WHERE delivery_key=?").get(
      lifecycleFeedbackKey({ runId: run.run_id, endpoint: { repository: run.repository, issueNumber: run.issue_number } }),
    );
    if (feedback?.delivery_error) progress.detail += `\nTicket feedback pending: ${feedback.delivery_error}.`;
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
