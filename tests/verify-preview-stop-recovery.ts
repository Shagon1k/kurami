import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { availableRunControls, requestRunControl } from "../src/orchestrator/controls/run.ts";
import { completeRequest, executePlannedAction, externalCommand } from "../src/orchestrator/runtime/controller-execution.ts";
import { planForRequest, type RequestRow } from "../src/orchestrator/runtime/request-plan.ts";
import { baseRunSelect } from "../src/orchestrator/runtime/run-read-model.ts";

// Only disposable stores and injected external effects: never invoke a manager,
// controller CLI, Docker or a reviewer for recovery regression coverage.
const home = mkdtempSync(resolve(tmpdir(), "kurami-preview-stop-recovery-"));
const app = resolve(import.meta.dirname, "..");
mkdirSync(resolve(home, "config"));
copyFileSync(resolve(app, "deploy/config/projects.yaml"), resolve(home, "config/projects.yaml"));
const path = resolve(home, "fixture.db");
const db = new DatabaseSync(path);
const other = new DatabaseSync(path);
db.exec("PRAGMA foreign_keys=ON");
other.exec("PRAGMA foreign_keys=ON");
try {
  for (const name of readdirSync(resolve(app, "migrations")).filter(name => /^\d+_.*\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(resolve(app, "migrations", name), "utf8"));
  }
  const addRun = (id: string, issue: number) => {
    db.prepare(`INSERT INTO project_events (
      event_id, observed_at, project, item_id, content_id, content_type,
      repository, issue_number, title, url, to_status, payload_json, processing_state
    ) VALUES (?, '2026-10-10T09:00:00Z', 'tailortales', ?, ?, 'Issue',
      'example/repo', ?, 'Fixture', 'https://example.invalid/issue', 'Human Review', '{}', 'processed')`)
      .run(id, id, id, issue);
    db.prepare(`INSERT INTO runs (run_id, trigger_event_id, project, item_id, content_id,
      repository, issue_number, interaction_policy, state, owner_state, execution_mode)
      VALUES (?, ?, 'tailortales', ?, ?, 'example/repo', ?, 'autonomous', 'parked_review', 'none', 'live')`)
      .run(id, id, id, id, issue);
    db.prepare(`INSERT INTO run_resources (run_id, resource_state, worktree_path, branch_name, codex_thread_id)
      VALUES (?, 'provisioned', ?, ?, ?)`).run(id, `/fixture/${id}`, `fixture-${id}`, `thread-${id}`);
    db.prepare(`INSERT INTO run_ci_snapshots (run_id, repository, pull_request_number, pull_request_url,
      head_sha, aggregate_state, checks_json, content_digest, first_observed_at, last_observed_at, completed_at)
      VALUES (?, 'example/repo', 160, 'https://example.invalid/pull/160',
        '26578729daa0899fb63e3bf8279d444962745972', 'passed', '[]', 'fixture',
        '2026-10-10T09:00:00Z', '2026-10-10T09:00:00Z', '2026-10-10T09:00:00Z')`).run(id);
  };
  const request = (id: string, action: Parameters<typeof requestRunControl>[2], apply = true, database = db) =>
    requestRunControl(database, id, action, "discord", apply, { home });
  const row = (id: string): RequestRow => db.prepare(`
    SELECT base.*, q.request_id, q.action AS requested_action
    FROM (${baseRunSelect()}) base JOIN run_control_requests q ON q.run_id=base.run_id
    WHERE q.request_id=?`).get(id) as RequestRow;
  const receipt = (id: string) => db.prepare("SELECT * FROM run_control_requests WHERE request_id=?").get(id)!;
  const plan = (id: string) => planForRequest(row(id), { limits: { preview_expiry_warning_hours: 2 } });
  const lease = (id: string, slot: number) => {
    db.prepare(`INSERT INTO preview_leases (lease_id, run_id, slot_number, state, compose_project_name)
      VALUES (?, ?, ?, 'leased', ?)`).run(`lease-${id}`, id, slot, `fixture-${id}`);
    db.prepare("UPDATE run_resources SET preview_id=? WHERE run_id=?").run(`preview-${slot}`, id);
  };
  const preserved = (id: string) => db.prepare(`SELECT r.state, r.owner_state, r.stop_reason,
    rr.resource_state, rr.worktree_path, rr.branch_name, rr.codex_thread_id
    FROM runs r JOIN run_resources rr USING(run_id) WHERE run_id=?`).get(id);

  addRun("r_stuck", 1);
  addRun("r_other", 2);
  const start = String(request("r_stuck", "preview_start").requestId);
  const unrelated = String(request("r_other", "preview_start").requestId);
  const sameRunUnrelated = String(request("r_stuck", "take_control").requestId);
  assert.ok((availableRunControls(db, "r_stuck", { home }).available_actions as string[]).includes("preview_stop"),
    "Stop must be exposed for a pending Start before allocation");
  const prBefore = db.prepare("SELECT * FROM run_ci_snapshots WHERE run_id='r_stuck'").get();
  lease("r_stuck", 1);
  const before = preserved("r_stuck");
  const staleStart = plan(start);
  assert.equal(staleStart.action, "preview_up");
  request("r_stuck", "preview_stop", false);
  assert.equal(receipt(start).request_state, "pending", "dry run must not supersede Start");
  // Nested owner transactions must preserve the atomic start/stop boundary.
  db.exec("BEGIN IMMEDIATE");
  request("r_stuck", "preview_stop");
  db.exec("ROLLBACK");
  assert.equal(receipt(start).request_state, "pending");
  assert.equal(db.prepare("SELECT count(*) n FROM run_control_requests WHERE action='preview_stop'").get()!.n, 0);

  const stop = String(request("r_stuck", "preview_stop").requestId);
  assert.equal(receipt(start).request_state, "rejected");
  assert.ok(receipt(start).completed_at);
  assert.deepEqual(JSON.parse(String(receipt(start).result_json)), {
    reason: "preview_start_superseded_by_stop", supersededByRequestId: stop,
  });
  assert.equal(receipt(unrelated).request_state, "pending");
  assert.equal(receipt(sameRunUnrelated).request_state, "pending", "Stop must not cancel unrelated controls on the same run");
  const repeated = request("r_stuck", "preview_stop");
  assert.equal(repeated.action, "existing");
  assert.equal(repeated.request_id, stop);
  assert.equal(plan(stop).action, "preview_down");
  assert.ok(externalCommand("preview_down", "r_stuck")!.includes("down"));
  let calls = 0;
  const effects = {
    internal: () => { throw new Error("Unexpected internal effect"); },
    complete: completeRequest,
    external: () => { calls++; return {}; },
  };
  assert.throws(() => executePlannedAction(db, staleStart, effects), /changed before execution/);
  assert.equal(calls, 0, "superseded plans must not invoke startup");
  executePlannedAction(db, plan(stop), { ...effects, external: action => {
    assert.equal(action.action, "preview_down");
    assert.equal(receipt(stop).request_state, "processing");
    assert.equal(request("r_stuck", "preview_stop", true, other).request_id, stop,
      "repeated Stop while cleanup is active must reuse its request");
    // Model the supported runtime down/release postconditions in this fixture only.
    db.prepare("UPDATE preview_leases SET state='released', released_at='2026-10-10T10:00:00Z' WHERE run_id=?").run(action.runId);
    db.prepare("UPDATE run_resources SET preview_id=NULL WHERE run_id=?").run(action.runId);
    return { action: "preview_stopped" };
  }});
  assert.equal(receipt(stop).request_state, "applied");
  assert.equal(row(stop).preview_lease_id, null);
  assert.deepEqual(preserved("r_stuck"), before, "Stop must preserve the run and managed work");
  assert.deepEqual(db.prepare("SELECT * FROM run_ci_snapshots WHERE run_id='r_stuck'").get(), prBefore,
    "Stop must preserve PR and exact CI-head evidence");
  const absentStop = String(request("r_stuck", "preview_stop").requestId);
  assert.equal(plan(absentStop).action, "request_complete", "Stop after cleanup is an idempotent no-op");
  completeRequest(db, absentStop, "applied", { reason: "preview_already_absent" });
  const review = String(request("r_stuck", "ai_review").requestId);
  assert.equal(plan(review).action, "review_start", "review can be queued/planned after cleanup, never started here");

  // Claim first wins: a concurrent owner cannot supersede an active external start.
  addRun("r_processing", 3);
  const activeStart = String(request("r_processing", "preview_start").requestId);
  executePlannedAction(db, plan(activeStart), { ...effects, external: action => {
    assert.equal(action.action, "preview_allocate");
    assert.equal(receipt(activeStart).request_state, "processing");
    assert.ok(!(availableRunControls(other, "r_processing", { home }).available_actions as string[]).includes("preview_stop"));
    assert.throws(() => request("r_processing", "preview_stop", true, other), /conflicts with queued preview_start/);
    lease("r_processing", 2);
    return { action: "allocated" };
  }});
  assert.equal(receipt(activeStart).request_state, "pending", "allocation returns Start for its next step");
  const startup = plan(activeStart);
  assert.throws(() => executePlannedAction(db, startup, { ...effects, external: () => {
    assert.equal(receipt(activeStart).request_state, "processing");
    assert.throws(() => request("r_processing", "preview_stop", true, other), /conflicts with queued preview_start/);
    throw new Error("Preview worktree HEAD does not match the observed pull-request head");
  }}), /HEAD does not match/);
  assert.equal(receipt(activeStart).request_state, "failed");
  assert.ok(receipt(activeStart).completed_at);
  assert.equal(row(activeStart).preview_lease_state, "leased", "failure retains cleanup ownership");
  assert.throws(() => executePlannedAction(db, startup, effects), /changed before execution/);
  const failedStop = String(request("r_processing", "preview_stop").requestId);
  assert.equal(plan(failedStop).action, "preview_down");
  assert.throws(() => executePlannedAction(db, plan(failedStop), { ...effects, external: () => { throw new Error("cleanup failed"); } }), /cleanup failed/);
  assert.equal(receipt(failedStop).request_state, "pending", "failed cleanup remains retryable, not silently released");

  addRun("r_protected", 4);
  const protectedStart = String(request("r_protected", "preview_start").requestId);
  db.prepare(`INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key)
    VALUES ('rq_fix', 'r_protected', 'review_fix', 'discord', 'protected-fix')`).run();
  assert.throws(() => request("r_protected", "preview_stop"), /conflicts with queued review_fix/);
  assert.equal(receipt(protectedStart).request_state, "pending");
  assert.equal(receipt("rq_fix").request_state, "pending");
  assert.equal(receipt(unrelated).request_state, "pending");
  console.log(JSON.stringify({ ok: true, isolatedPreviewStopRecovery: true, pendingSuperseded: true,
    stalePlanRefused: true, processingRaceRefused: true, terminalStartupFailure: true,
    cleanupRetryPreserved: true, nestedRollback: true, reviewPlannedNotStarted: true }));
} finally {
  other.close();
  db.close();
  rmSync(home, { recursive: true, force: true });
}
