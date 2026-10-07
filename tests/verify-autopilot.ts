// Autopilot: the next step is decided from the same facts as Projects (CI repair once, AI Review per commit,
// one round of fixes for major findings, nothing while work is busy or outside Human Review); a pass asks
// once per commit through the owner's request paths, retries a refusal a few times, and does nothing for a
// project that is off. The CLI keeps a revision so two panels cannot overwrite each other.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { nextAutopilotStep, runAutopilot, type AutopilotDeps } from "../src/orchestrator/runtime/autopilot.ts";
import type { CurrentProjectRun } from "../src/orchestrator/projects/status-read-model.ts";

const head = "abcdef1234567";
const run = (patch: Partial<CurrentProjectRun> & Record<string, unknown> = {}): CurrentProjectRun => ({
  run_id: "r_1", project: "pickflick", issue_number: 9, repository: "Shagon1k/PickFlick", pull_request_url: "https://github.com/Shagon1k/PickFlick/pull/90",
  item_status: "Human Review", run_state: "parked_review", stage: null, ci_head_sha: head, ci_aggregate_state: "passed", ci_repair_state: null,
  ai_review_state: null, ai_review_head_sha: null, ai_review_critical_count: 0, ai_review_important_count: 0, ai_review_suggestion_count: 0,
  review_fix_state: null, review_fix_request_active_count: 0, ci_repair_attempt_count: 0, ...patch,
} as CurrentProjectRun);
const step = (patch: Parameters<typeof run>[0]) => nextAutopilotStep(run(patch), "Human Review")?.action ?? null;

assert.equal(step({ ci_aggregate_state: "failed" }), "ci_repair");
assert.equal(step({ ci_aggregate_state: "failed", ci_repair_attempt_count: 1 }), null, "one CI repair per task");
assert.equal(step({ ci_aggregate_state: "failed", ci_repair_state: "running", ci_repair_head_sha: head }), null, "a running repair is left alone");
assert.equal(step({}), "ai_review", "a passed commit without a review gets one");
assert.equal(step({ ai_review_state: "running", ai_review_head_sha: "0000000aaaaaa" }), null, "a review in progress is not doubled");
assert.equal(step({ ai_review_state: "ready", ai_review_head_sha: head, ai_review_important_count: 2 }), "review_fix");
assert.equal(step({ ai_review_state: "ready", ai_review_head_sha: head, ai_review_suggestion_count: 5 }), null, "suggestions alone wait for the owner");
assert.equal(step({ ai_review_state: "ready", ai_review_head_sha: head, ai_review_critical_count: 1, review_fix_state: "completed" }), null, "one round of fixes per task");
assert.equal(step({ ci_aggregate_state: "pending" }), null);
assert.equal(step({ item_status: "In progress" }), null, "only tasks in Human Review");
assert.equal(step({ run_state: "running" }), null);
assert.equal(step({ pull_request_url: null }), null);

const app = resolve(import.meta.dirname, ".."), home = mkdtempSync(join(tmpdir(), "kurami-autopilot-"));
try {
  mkdirSync(join(home, "config"));
  writeFileSync(join(home, "config/projects.yaml"), `version: 1\nprojects:\n  pickflick:\n    repository: Shagon1k/PickFlick\n    statuses: {backlog: Backlog, active: In progress, review: Human Review, done: Done, deferred: Deferred}\n  tailortales:\n    repository: Shagon1k/TailorTales\n    statuses: {backlog: Backlog, active: In progress, review: Human Review, done: Done, deferred: Deferred}\n`);
  const env = { ...process.env, KURAMI_HOME: home, ORCHESTRATOR_MIGRATIONS_DIR: resolve(app, "migrations") };
  execFileSync(process.execPath, [resolve(app, "src/orchestrator/state/init-run-store.ts")], { env, stdio: ["ignore", "ignore", "pipe"] });
  const database = new DatabaseSync(join(home, "state/orchestrator.db"));
  database.exec(`INSERT INTO project_items (project,item_id,content_id,content_type,repository,issue_number,title,url,status,present,first_seen_at,last_seen_at)
      VALUES ('pickflick','item-9','content-9','Issue','Shagon1k/PickFlick',9,'Task','https://github.com/Shagon1k/PickFlick/issues/9','Human Review',1,'2026-10-01T00:00:00Z','2026-10-07T00:00:00Z');
    INSERT INTO project_events (event_id,observed_at,project,item_id,content_id,content_type,repository,issue_number,title,url,from_status,to_status,payload_json,processing_state)
      VALUES ('event-9','2026-10-06T00:00:00Z','pickflick','item-9','content-9','Issue','Shagon1k/PickFlick',9,'Task','https://github.com/Shagon1k/PickFlick/issues/9','In progress','Human Review','{}','processed');
    INSERT INTO runs (run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode)
      VALUES ('r_9','event-9','pickflick','item-9','content-9','Shagon1k/PickFlick',9,'autonomous','parked_review','none','live');
    INSERT INTO run_ci_snapshots (run_id,repository,pull_request_number,pull_request_url,pull_request_title,head_sha,aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at)
      VALUES ('r_9','Shagon1k/PickFlick',90,'https://github.com/Shagon1k/PickFlick/pull/90','Task','${head}','passed','[]','d','2026-10-06T00:00:00Z','2026-10-07T00:00:00Z','2026-10-07T00:00:00Z');`);
  database.close();

  const cli = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [resolve(app, "src/orchestrator/runtime/autopilot.ts"), ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  assert.deepEqual(cli("status"), { ok: true, action: "status", revision: 0, projects: { pickflick: false, tailortales: false }, names: { pickflick: "PickFlick", tailortales: "TailorTales" } });

  const calls: string[] = [];
  let refuse = false;
  const deps: AutopilotDeps = {
    review: input => { calls.push(`review ${JSON.stringify(input)}`); if (refuse) throw new Error("stale"); },
    action: input => { calls.push(`action ${JSON.stringify(input)}`); },
    fingerprint: () => ({ fingerprint: "f".repeat(64), enabled: new Set(["ci_repair", "review_fix"]) }),
  };
  const now = new Date("2026-10-07T05:00:00Z"), later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  assert.deepEqual(await runAutopilot(home, now, deps), [], "off by default");
  assert.deepEqual(calls, []);

  assert.equal(cli("apply", "--projects", "pickflick", "--expected-revision", "0", "--actor-id", "7").action, "applied");
  assert.throws(() => cli("apply", "--projects", "", "--expected-revision", "0", "--actor-id", "7"), /changed since this panel opened/);
  refuse = true;
  assert.deepEqual(await runAutopilot(home, now, deps), [], "a refused request is not counted as asked");
  assert.deepEqual(await runAutopilot(home, later(5), deps), [], "and is not retried within 15 minutes");
  assert.equal(calls.length, 1);
  refuse = false;
  const asked = await runAutopilot(home, later(20), deps);
  assert.deepEqual(asked.map(entry => [entry.action, entry.itemId]), [["ai_review", "item-9"]]);
  const input = JSON.parse((calls as string[]).at(-1)!.slice(7)) as { key: string; head: string };
  assert.equal(input.head, head); assert.match(input.key, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.deepEqual(await runAutopilot(home, later(60), deps), [], "asked once per commit");
  assert.equal(calls.length, 2);
  console.log(JSON.stringify({ ok: true, autopilot: "step rules, off by default, revisioned settings, once per commit, retry spacing" }));
} finally { rmSync(home, { recursive: true, force: true }); }
