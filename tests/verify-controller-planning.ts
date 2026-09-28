import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { planAutomatic } from "../src/orchestrator/runtime/automatic-plan.ts";
import {
  reconcileAfterAppliedAction,
  reconcileAfterCycle,
  reconcileBeforePlanning,
  type ControllerReconcilers,
} from "../src/orchestrator/runtime/controller-cycle.ts";
import { executePlannedAction, type ControllerActionEffects } from "../src/orchestrator/runtime/controller-execution.ts";
import type { OrchestratorConfig } from "../src/orchestrator/runtime/controller-types.ts";
import type { PlannedAction } from "../src/orchestrator/runtime/request-plan.ts";
import type { RunRow } from "../src/orchestrator/runtime/run-read-model.ts";

const registry = {
  projects: {
    example: { statuses: { backlog: "Backlog", active: "In progress", review: "Human Review" } },
  },
};

function run(overrides: Partial<RunRow> = {}): RunRow {
  return {
    run_id: "run-1",
    project: "example",
    issue_number: 42,
    interaction_policy: "autonomous",
    run_state: "admission_pending",
    stop_reason: null,
    owner_state: "none",
    resource_state: "planned",
    tmux_session_name: null,
    codex_thread_id: null,
    previous_codex_thread_id: null,
    preview_lease_id: null,
    preview_lease_state: null,
    preview_expires_at: null,
    preview_required: 0,
    preview_requirement_satisfied_at: null,
    preview_requirement_lease_id: null,
    preview_requirement_verified_head_sha: null,
    completion_requested_at: null,
    project_item_status: "In progress",
    has_newer_run: 0,
    completion_parked: 0,
    backlog_satisfied: 0,
    ci_pull_request_number: null,
    ci_pull_request_url: null,
    ci_head_sha: null,
    latest_autonomous_successor_state: null,
    latest_review_fix_state: null,
    latest_review_fix_round_id: null,
    latest_review_fix_codex_thread_id: null,
    latest_review_fix_failure_reason: null,
    latest_repair_state: null,
    latest_repair_failure_reason: null,
    latest_attention_reason: null,
    autonomous_successor_active: 0,
    project_poll_last_attempt_state: "succeeded",
    project_poll_last_captured_at: new Date().toISOString(),
    ...overrides,
  } as RunRow;
}

const noProbe = (): never => {
  throw new Error("Unrelated plan must not inspect tmux");
};

assert.equal(planAutomatic(run(), registry, noProbe)?.action, "provision");
assert.equal(
  planAutomatic(run({ project_poll_last_attempt_state: "failed" }), registry, noProbe),
  null,
  "stale discovery must not admit a writer",
);
assert.equal(
  planAutomatic(run({ run_state: "starting", resource_state: "provisioned" }), registry, noProbe)?.action,
  "start",
);
assert.equal(
  planAutomatic(run({ stop_reason: "cancelled", owner_state: "cli" }), registry, noProbe)?.action,
  "cancel_cli",
  "cancellation must outrank a fresh admission",
);
assert.equal(
  planAutomatic(run({
    stop_reason: "cancelled",
    owner_state: "cli",
    preview_lease_state: "running",
    preview_expires_at: "2020-01-01T00:00:00.000Z",
  }), registry, noProbe)?.action,
  "preview_expire",
  "expired preview must be reclaimed first",
);
assert.equal(
  planAutomatic(run({
    run_state: "parked_review",
    resource_state: "provisioned",
    completion_requested_at: "2026-09-01T00:00:00.000Z",
    preview_required: 1,
    preview_requirement_satisfied_at: "2026-09-01T00:00:00.000Z",
    preview_requirement_lease_id: "lease-1",
    preview_requirement_verified_head_sha: "exact-sha",
    ci_head_sha: "exact-sha",
  }), registry, noProbe)?.action,
  "preview_requirement_complete",
);

const running = run({
  run_state: "running",
  owner_state: "cli",
  resource_state: "provisioned",
  tmux_session_name: "cx-run-1",
  codex_thread_id: "thread-1",
});
let probed = 0;
assert.equal(planAutomatic(running, registry, () => { probed++; return false; }), null);
assert.equal(probed, 1);
assert.equal(planAutomatic(running, registry, () => true)?.action, "park");
assert.equal(
  planAutomatic({ ...running, stop_reason: "cancelled" }, registry, noProbe)?.action,
  "cancel_cli",
);

const database = {} as DatabaseSync;
const config = {} as OrchestratorConfig;
const calls: string[] = [];
const record = (name: string) => (received: DatabaseSync) => {
  assert.equal(received, database);
  calls.push(name);
};
const reconcilers: ControllerReconcilers = {
  ciRepair: record("ci_repair"),
  reviewFix: record("review_fix"),
  aiReview: record("ai_review"),
  controlEvents: record("control_events"),
  progressCards: (received, selectedConfig) => {
    assert.equal(received, database);
    assert.equal(selectedConfig, config);
    calls.push("progress_cards");
  },
};
reconcileBeforePlanning(database, config, reconcilers);
assert.deepEqual(calls.splice(0), ["ci_repair", "review_fix", "ai_review", "control_events", "progress_cards"]);
reconcileAfterAppliedAction(database, config, reconcilers);
assert.deepEqual(calls.splice(0), ["ci_repair", "review_fix", "progress_cards", "control_events"]);
reconcileAfterCycle(database, config, reconcilers);
assert.deepEqual(calls, ["control_events", "progress_cards"]);

const effects: ControllerActionEffects = {
  internal: (received, plan) => {
    assert.equal(received, database);
    calls.push(`internal:${plan.action}`);
    return { action: "remote_claimed" };
  },
  external: (plan) => {
    calls.push(`external:${plan.action}`);
    return { action: plan.action === "discard_cancelled" ? "discarded_local_work" : "handoff_completed" };
  },
  complete: (received, requestId, state) => {
    assert.equal(received, database);
    calls.push(`complete:${requestId}:${state}`);
  },
};
const action = (actionName: PlannedAction["action"], requestOutcome?: PlannedAction["requestOutcome"]): PlannedAction => ({
  action: actionName,
  runId: "run-1",
  project: "example",
  issueNumber: 42,
  requestId: "rq-1",
  requestOutcome,
});
calls.length = 0;
executePlannedAction(database, action("claim_remote"), effects);
assert.deepEqual(calls.splice(0), ["internal:claim_remote"]);
executePlannedAction(database, action("handoff"), effects);
assert.deepEqual(calls.splice(0), ["external:handoff", "complete:rq-1:applied"]);
executePlannedAction(database, action("preview_expire", "rejected"), effects);
assert.deepEqual(calls.splice(0), ["external:preview_expire", "complete:rq-1:rejected"]);
executePlannedAction(database, action("discard_cancelled"), effects);
assert.deepEqual(calls.splice(0), ["external:discard_cancelled", "complete:rq-1:applied"]);
executePlannedAction(database, action("discard_published_cancelled"), effects);
assert.deepEqual(calls, ["external:discard_published_cancelled", "complete:rq-1:rejected"]);
calls.length = 0;
assert.throws(
  () => executePlannedAction(database, action("handoff"), {
    ...effects,
    external: () => {
      calls.push("external:failed");
      throw new Error("tmux failed");
    },
  }),
  /tmux failed/u,
);
assert.deepEqual(calls, ["external:failed"], "Failed external work must not complete the owner request");

process.stdout.write(`${JSON.stringify({ ok: true, automaticPlanning: true, reconciliationOrder: true, actionExecution: true, failedExternalReceiptPreserved: true })}\n`);
