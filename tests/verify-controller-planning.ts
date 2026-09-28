import assert from "node:assert/strict";
import { planAutomatic } from "../src/orchestrator/runtime/automatic-plan.ts";
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

process.stdout.write(`${JSON.stringify({ ok: true, automaticPlanning: true })}\n`);
