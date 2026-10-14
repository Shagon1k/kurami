import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse, stringify } from "yaml";
import { persistProjectSnapshot } from "../src/orchestrator/projects/poll-projects.ts";
import { buildTriageFacts, type RawTriageItem } from "../src/orchestrator/projects/triage/snapshot.ts";
import { rankTriageFacts } from "../src/orchestrator/projects/triage/rank.ts";
import { candidateFromFact } from "../src/orchestrator/projects/metadata/proposals/manager.ts";
import { collectProjectsSnapshot } from "../src/projects-site/snapshot.ts";
import { canStartTask, taskStartProgress } from "../src/projects-site/task-start.ts";
import { needsOwner, projectStageLabel } from "../src/projects-site/model.ts";
import { renderProjectsPage } from "../src/projects-site/render.ts";

const app = resolve(import.meta.dirname, "..");
const home = mkdtempSync(resolve(tmpdir(), "kurami-no-auto-"));
let database: DatabaseSync | undefined;
try {
  mkdirSync(resolve(home, "config"));
  const registry = parse(readFileSync(resolve(app, "deploy/config/projects.yaml"), "utf8"));
  for (const [key, config] of Object.entries(registry.projects) as [string, { workspace: { worktree_root: string } }][]) {
    config.workspace.worktree_root = resolve(home, "worktrees", key);
    mkdirSync(config.workspace.worktree_root, { recursive: true });
  }
  writeFileSync(resolve(home, "config/projects.yaml"), stringify(registry));
  writeFileSync(resolve(home, "config/orchestrator.yaml"), readFileSync(resolve(app, "deploy/config/orchestrator.yaml")));
  const env = { ...process.env, KURAMI_HOME: home, ORCHESTRATOR_MIGRATIONS_DIR: resolve(app, "migrations") };
  execFileSync(process.execPath, [resolve(app, "src/orchestrator/state/init-run-store.ts")], { env, stdio: "pipe" });
  database = new DatabaseSync(resolve(home, "state/orchestrator.db"));
  let tick = 0;
  const item = { project: "tailortales", itemId: "external-task", contentId: "issue-9990", contentType: "Issue", repository: "Shagon1k/TailorTales",
    number: 9990, title: "Independent task", url: "https://github.com/Shagon1k/TailorTales/issues/9990", status: "Backlog",
    issueState: "OPEN", labels: ["no-auto", "human-control", "preview-required"], hasDescription: true };
  function poll() {
    return persistProjectSnapshot(database!, "tailortales", new Date(Date.UTC(2026, 9, 14, 0, 0, tick++)).toISOString(), 1, [item], null);
  }
  function consume(quiet = false) {
    return execFileSync(process.execPath, [resolve(app, "src/orchestrator/projects/process-project-events.ts")], {
      env: { ...env, CONSUMER_QUIET: quiet ? "1" : "0" }, encoding: "utf8", stdio: "pipe",
    });
  }
  assert.equal(poll().mode, "baseline");
  assert.equal(database.prepare("SELECT automation_excluded FROM project_items").get()!.automation_excluded, 1);
  for (const status of ["In progress", "Human Review", "Done", "Backlog", "Deferred", "In progress"]) {
    item.status = status;
    assert.equal(poll().transitions.length, 1);
    assert.equal(consume(true), "", "Excluded transitions emit no trigger feedback");
  }
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM project_events WHERE processing_state='ignored' AND processing_note LIKE '%no-auto%'").get()!.n, 6);
  for (const table of ["runs", "run_resources", "run_state_history", "run_progress_cards", "run_control_requests"])
    assert.equal(database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0, "Excluded events create no " + table);

  const view = collectProjectsSnapshot({ home, now: new Date(Date.UTC(2026, 9, 14, 0, 0, tick)), statusEnabled: true });
  assert.equal(view.available, true);
  const task = view.items[0]!, project = view.projects.find(project => project.key === "tailortales")!;
  assert.equal(task.automationExcluded, true);
  assert.equal(task.taskStart, undefined, "Independent active tasks do not look blocked or awaiting launch");
  assert.equal(canStartTask({ ...task, status: "Backlog" }, project), false);
  assert.equal(taskStartProgress(task, project, undefined, null, undefined, null, null), undefined);
  assert.equal(needsOwner({ ...task, status: "Human Review" }, project), false);
  for (const lang of ["en", "ru"] as const) {
    assert.equal(projectStageLabel(task, lang), lang === "ru" ? "Автоматизация отключена" : "Automation off");
    const backlog = { ...view, items: [{ ...task, status: "Backlog" }] };
    const html = renderProjectsPage(backlog, new URLSearchParams({ lang, item: task.id }));
    assert.doesNotMatch(html, /data-start-task/, "Independent tasks retain status editing without a start-agent button");
    assert.match(html, /data-status-form/);
  }

  const raw: RawTriageItem = { itemId: item.itemId, contentType: "Issue", repository: item.repository, issueNumber: item.number,
    title: item.title, url: item.url, issueState: "OPEN", status: "Backlog", priority: null, effort: null, labels: ["no-auto"],
    labelsTotalCount: 1, hasDescription: true, bodyDigest: "a".repeat(64), createdAt: null, closedAt: null,
    blockedByOpenCount: 0, blockingOpenCount: 0, blockedByTotalCount: 0, blockingTotalCount: 0, blockedBy: [], blocking: [] };
  const facts = buildTriageFacts("tailortales", registry.projects.tailortales, [raw], []);
  assert.equal(facts.items[0]!.eligible, false);
  assert.ok(facts.items[0]!.eligibilityReasons.includes("automation_excluded"));
  assert.equal(rankTriageFacts(facts, "a".repeat(64)).selected, null);
  assert.equal(candidateFromFact(facts, facts.items[0]!), null, "No AI metadata assessment for independent tasks");

  item.labels = [];
  assert.equal(poll().transitions.length, 0, "Removing the label alone never starts a task");
  assert.equal(database.prepare("SELECT automation_excluded FROM project_items").get()!.automation_excluded, 0);
  assert.equal(JSON.parse(consume()).processed, 0);
  item.status = "Backlog"; poll(); consume();
  item.status = "In progress"; poll();
  assert.equal(JSON.parse(consume()).results[0].action, "created", "A new unlabelled activation follows normal admission");
  const ordinaryFacts = buildTriageFacts("tailortales", registry.projects.tailortales, [{ ...raw, labels: [], labelsTotalCount: 0 }], []);
  assert.equal(ordinaryFacts.items[0]!.eligible, true);
  assert.ok(candidateFromFact(ordinaryFacts, ordinaryFacts.items[0]!));

  const run = database.prepare("SELECT * FROM runs").get();
  item.labels = ["no-auto"];
  assert.equal(poll().transitions.length, 0);
  item.status = "Backlog"; poll(); consume(true);
  assert.deepEqual(database.prepare("SELECT * FROM runs").get(), run, "The label does not cancel or mutate an already admitted run");
  console.log("no-auto: observed board transitions, zero launches/resources/feedback, label-only sync, owner UI, triage exclusions and normal opt-in verified");
} finally {
  database?.close();
  rmSync(home, { recursive: true, force: true });
}
