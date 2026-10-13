import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { projectRunStatus, readProjectStatus, type ProjectRunFacts } from "../src/orchestrator/projects/status-read-model.ts";
import { controlComponents } from "../src/orchestrator/controls/discord.ts";
import { createProjectStore } from "./hub/project-store.ts";

const base: ProjectRunFacts = {
  run_state: "parked_review", stage: "review_ready", ci_head_sha: "current-head", ci_aggregate_state: "failed",
  ci_repair_state: null, ci_repair_head_sha: null, ci_repair_result_head_sha: null, ci_repair_request_active_count: 0,
  ai_review_state: "ready", ai_review_head_sha: "current-head", ai_review_critical_count: 1,
  ai_review_important_count: 2, ai_review_suggestion_count: 3,
  review_fix_state: null, review_fix_request_active_count: 0,
};
const project = {repository: "Owner/Project", workspace: {branch_prefix: "PRJ", worktree_root: "/temporary/project"}};
const pullRequest = {url: "https://github.com/Owner/Project/pull/1", title: "Fixture", headSha: "current-head"};
function discord(facts: ProjectRunFacts): string {
  const card = {...facts, run_id: "r_shared", owner_state: "none", codex_thread_id: "fixture-thread", previous_codex_thread_id: null,
    ci_repair_attempt_count: 0, ai_review_request_active_count: 0, stop_reason: null} as Parameters<typeof controlComponents>[0];
  return JSON.stringify(controlComponents(card, project, pullRequest));
}
assert.deepEqual(projectRunStatus(base).attention.map(issue => issue.code), ["ci_unrepaired", "review_unrepaired"]);
assert(discord(base).includes("kurami:ci_repair:r_shared"));
assert(discord(base).includes("review_fix_all"));
for (const fields of [
  {ci_repair_state: "running", ci_repair_head_sha: "current-head"},
  {ci_repair_state: "waiting_ci", ci_repair_head_sha: "old-head", ci_repair_result_head_sha: "current-head"},
  {ci_repair_request_active_count: 1},
  {stage: "ci_repair_queued"},
]) {
  const facts = {...base, ...fields};
  assert.equal(projectRunStatus(facts).ciRepairBusy, true);
  assert(!projectRunStatus(facts).attention.some(issue => issue.code === "ci_unrepaired"));
  assert(!discord(facts).includes("kurami:ci_repair:r_shared"), "Hub and Discord agree on current or queued repair");
}
const oldRepair = {...base, ci_repair_state: "running", ci_repair_head_sha: "old-head"};
assert.equal(projectRunStatus(oldRepair).ciRepairCurrent, false);
assert.equal(projectRunStatus(oldRepair).ciRepairBusy, true);
assert(projectRunStatus(oldRepair).attention.some(issue => issue.code === "ci_unrepaired"));
assert(!discord(oldRepair).includes("kurami:ci_repair:r_shared"), "a stale running attempt cannot hide the alert or allow a concurrent repair");
for (const fields of [{review_fix_request_active_count: 1}, {review_fix_state: "resolving"}, {stage: "review_fix_queued"}]) {
  const facts = {...base, ...fields};
  assert.equal(projectRunStatus(facts).reviewFixBusy, true);
  assert.deepEqual(projectRunStatus(facts).attention, []);
  assert(!discord(facts).includes("review_fix_all"));
}
const staleReview = {...base, ai_review_head_sha: "old-head"};
assert.equal(projectRunStatus(staleReview).reviewFindings, 0);
assert(!discord(staleReview).includes("review_fix_all"));
const suggestions = {...base, ai_review_critical_count: 0, ai_review_important_count: 0};
assert(!projectRunStatus(suggestions).attention.some(issue => issue.code === "review_unrepaired"), "suggestions alone do not raise alerts");
assert(discord(suggestions).includes("review_fix_all"), "owner can still choose to fix suggestions");
for (const stage of ["cancelled", "completed", "cancelled_work_preserved"]) assert.deepEqual(projectRunStatus({...base, stage}).attention, []);
assert.equal(projectRunStatus({...base, run_state: "failed"}).attention[0].severity, "critical");
assert.equal(projectRunStatus({...base, run_state: "waiting_human"}).attention[0].code, "owner_input");
assert(projectRunStatus({...base, run_state:"parked_review",stage:"waiting_human"}).attention.some(issue=>issue.code==="owner_input"),"parked writers waiting for a decision count as owner input");

const home = mkdtempSync(join(tmpdir(), "kurami-project-status-"));
try {
  const path = join(home, "orchestrator.db");
  const db = new DatabaseSync(path);
  createProjectStore(db);
  const at = "2026-09-30T10:00:00Z";
  for (const [id, item, state, status, present] of [
    ["r_closed", "closed", "failed", "Closed", 1], ["r_later", "later", "failed", "Later", 1],
    ["r_missing", "missing", "failed", "Doing", 0], ["r_old", "ongoing", "failed", "Doing", 1],
    ["r_new", "ongoing", "running", "Doing", 1], ["r_review", "review", "parked_review", "Review", 1],
  ] as const) {
    db.prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?)").run(id, "project", 1, "Owner/Project", item, state, at);
    if (id !== "r_old") db.prepare("INSERT INTO project_items VALUES(?,?,?,?)").run("project", item, status, present);
  }
  db.prepare("INSERT INTO run_ci_snapshots(run_id,head_sha,aggregate_state) VALUES(?,?,?)").run("r_new", "current-head", "failed");
  db.prepare("INSERT INTO run_ci_snapshots(run_id,head_sha,aggregate_state) VALUES(?,?,?)").run("r_review", "review-head", "passed");
  db.prepare("INSERT INTO run_ci_repair_attempts VALUES(?,?,?,?,?)").run("r_new", "old-head", "waiting_ci", 1, "current-head");
  db.prepare("INSERT INTO run_ai_reviews(run_id,head_sha,review_state,review_number,critical_count,important_count,suggestion_count) VALUES(?,?,?,?,?,?,?)").run("r_review", "old-review", "ready", 1, 5, 0, 0);
  db.prepare("INSERT INTO run_ai_reviews(run_id,head_sha,review_state,review_number,critical_count,important_count,suggestion_count) VALUES(?,?,?,?,?,?,?)").run("r_review", "review-head", "ready", 2, 1, 2, 0);
  db.prepare("INSERT INTO project_poll_state VALUES(?,?,?)").run("project", at, "succeeded");
  const registry = {project: {statuses: {backlog: "Todo", active: "Doing", review: "Review", done: "Closed", deferred: "Later"}}};
  const model = readProjectStatus(path, registry, new Date(at));
  assert.equal(model.available, true);
  assert.deepEqual(model.runs.map(run => run.run_id).sort(), ["r_new", "r_review"]);
  assert.deepEqual(model.projects.project.runs, {working: 1, attention: 0, ciFailed: 1});
  assert.equal(model.projects.project.board.done, 1);
  assert.equal(model.projects.project.poll.state, "fresh");
  assert.deepEqual(model.runs.flatMap(run => projectRunStatus(run).attention).map(issue => issue.code), ["review_unrepaired"]);
  db.prepare("INSERT INTO run_control_requests(run_id,action,request_state) VALUES(?,?,?)").run("r_review", "review_fix", "pending");
  const queued = readProjectStatus(path, registry, new Date(at));
  assert.deepEqual(queued.runs.flatMap(run => projectRunStatus(run).attention), []);
  assert.equal(readProjectStatus(path, registry, new Date("2026-09-30T11:00:00Z")).projects.project.poll.state, "stale");
  db.close();
  writeFileSync(join(home, "corrupt.db"), "not sqlite");
  assert.equal(readProjectStatus(join(home, "corrupt.db"), registry, new Date(at)).available, false);
  assert.equal(readProjectStatus(join(home, "missing.db"), registry, new Date(at)).available, false);
} finally {rmSync(home, {recursive: true, force: true});}
console.log("Project status: shared SQL, cross-surface repair rules, current heads/runs, configured columns, queued work and unavailable sources verified");
