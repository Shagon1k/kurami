// Quick capture worker: issue forms are read from the repository (config.yml skipped); the model's answer must
// name a real form, use its field labels and fill required fields; the body keeps the owner's own words; a
// queued request is filed once with the form's labels; a model failure files the note as written; a GitHub
// failure marks the request failed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { captureInstructions, captureTargets, checkFilledIssue, issueBody, loadIssueForms, plainIssue, processCapture } from "../src/orchestrator/projects/capture/quick-capture.ts";
import { createCaptureAction } from "../src/projects-site/capture.ts";
import type { BacklogTarget } from "../src/orchestrator/integrations/github/backlog-capture.ts";

const app = resolve(import.meta.dirname, ".."), home = mkdtempSync(join(tmpdir(), "kurami-quick-capture-"));
try {
  const workspace = join(home, "PickFlick"), forms = join(workspace, ".github/ISSUE_TEMPLATE");
  mkdirSync(forms, { recursive: true }); mkdirSync(join(home, "config")); mkdirSync(join(home, "state"));
  writeFileSync(join(forms, "bug.yml"), `name: Bug\ndescription: Something is broken\ntitle: "[Bug]: "\nlabels: [bug, triage]\nbody:\n  - type: markdown\n    attributes: {value: "Thanks"}\n  - type: textarea\n    id: what\n    attributes: {label: What happened}\n    validations: {required: true}\n  - type: dropdown\n    id: area\n    attributes: {label: Area, options: [Web, API]}\n`);
  writeFileSync(join(forms, "feature.yml"), `name: Feature\ndescription: An idea\nlabels: enhancement\nbody:\n  - type: textarea\n    id: want\n    attributes: {label: What do you want}\n    validations: {required: true}\n`);
  writeFileSync(join(forms, "config.yml"), "blank_issues_enabled: false\n");
  writeFileSync(join(home, "config/projects.yaml"), `version: 1\nprojects:\n  pickflick:\n    owner: Shagon1k\n    project_number: 3\n    repository: Shagon1k/PickFlick\n    status_field: Status\n    statuses: {backlog: Backlog, active: In progress, review: Human Review, done: Done, deferred: Deferred}\n    workspace: {canonical_repository: ${workspace}}\n`);
  execFileSync(process.execPath, [resolve(app, "src/orchestrator/state/init-run-store.ts")], { env: { ...process.env, KURAMI_HOME: home, ORCHESTRATOR_MIGRATIONS_DIR: resolve(app, "migrations") }, stdio: ["ignore", "ignore", "pipe"] });

  // Forms and instructions.
  const loaded = loadIssueForms(workspace);
  assert.deepEqual(loaded.map(form => [form.file, form.labels, form.fields.map(field => [field.label, field.required])]), [["bug.yml", ["bug", "triage"], [["What happened", true], ["Area", false]]], ["feature.yml", ["enhancement"], [["What do you want", true]]]]);
  assert.deepEqual(loadIssueForms(join(home, "missing")), []);
  const target = captureTargets(home).find(entry => entry.key === "pickflick")!;
  const instructions = captureInstructions(target, loaded, "Список теряет порядок", null);
  assert.match(instructions, /PickFlick \(Shagon1k\/PickFlick\)[\s\S]*bug\.yml[\s\S]*Список теряет порядок/);
  assert.match(captureInstructions(captureTargets(home).at(-1)!, [], "idea", null), /template to null[\s\S]*«Что», «Зачем»/, "no forms: a three-part body");

  // The model's answer is checked against the forms.
  const good = { template: "bug.yml", title: "[Bug]: Список теряет порядок", sections: [{ label: "What happened", value: "После обновления порядок сбрасывается." }, { label: "Area", value: "Web" }] };
  assert.deepEqual(checkFilledIssue(good, loaded), { template: "bug.yml", title: "[Bug]: Список теряет порядок", sections: good.sections, labels: ["bug", "triage"] });
  assert.equal(checkFilledIssue("```json\n" + JSON.stringify(good) + "\n```", loaded).template, "bug.yml", "a fenced JSON answer is read");
  assert.throws(() => checkFilledIssue({ ...good, template: "evil.yml" }, loaded), /Unknown issue form/);
  assert.throws(() => checkFilledIssue({ ...good, sections: [{ label: "Hacked", value: "x" }, ...good.sections] }, loaded), /Unknown field/);
  assert.throws(() => checkFilledIssue({ ...good, sections: [{ label: "Area", value: "Web" }] }, loaded), /Required field missing: What happened/);
  assert.throws(() => checkFilledIssue({ ...good, title: "x" }, loaded), /Invalid title/);
  assert.match(issueBody({ sections: good.sections }, "Список теряет порядок", "a link", null), /^### What happened\n\nПосле обновления[\s\S]*### Area\n\nWeb[\s\S]*<summary>Исходная заметка<\/summary>\n\nСписок теряет порядок\n\n> a link[\s\S]*_Записано через Kurami\._$/);
  assert.deepEqual(plainIssue("\n  First line of the note\nsecond line"), { title: "First line of the note", sections: [] });

  // A queued request is filed once, with the form's labels; the page sees the result.
  const capture = createCaptureAction({ home, start: async () => {} });
  const created: { target: BacklogTarget; title: string; body: string; labels?: string[] }[] = [];
  const client = { create: async (target: BacklogTarget, title: string, body: string, labels?: string[]) => { created.push({ target, title, body, labels }); return { number: 50 + created.length, url: `https://github.com/${target.repository}/issues/${50 + created.length}`, onBoard: Boolean(target.board) }; } };
  await capture.submit({ key: "quick-key-0001", project: "pickflick", text: "Список теряет порядок после обновления" }, "owner");
  assert.deepEqual(await processCapture(home, "quick-key-0001", { fill: async () => good, client }), { state: "created", number: 51, filledBy: "kurami" });
  assert.deepEqual([created[0]!.title, created[0]!.labels, created[0]!.target.board?.backlog], ["[Bug]: Список теряет порядок", ["bug", "triage"], "Backlog"]);
  assert.deepEqual(capture.status("quick-key-0001"), { key: "quick-key-0001", state: "created", project: "pickflick", number: 51, url: "https://github.com/Shagon1k/PickFlick/issues/51", onBoard: true, filledBy: "kurami", error: null });
  assert.deepEqual(await processCapture(home, "quick-key-0001", { fill: async () => good, client }), { state: "skipped" }, "a second worker files nothing");
  assert.equal(created.length, 1);

  // The model fails twice: the note is filed as written, and why is kept.
  await capture.submit({ key: "quick-key-0002", project: "kurami", text: "Kurami should remember my last filter\nand reopen it" }, "owner");
  let calls = 0;
  assert.deepEqual(await processCapture(home, "quick-key-0002", { fill: async () => { calls++; throw new Error("usage limit"); }, client }), { state: "created", number: 52, filledBy: "plain" });
  assert.equal(calls, 2, "one retry");
  assert.deepEqual([created[1]!.title, created[1]!.labels, created[1]!.target.repository], ["Kurami should remember my last filter", [], "Shagon1k/kurami"]);
  const row = new DatabaseSync(join(home, "state/orchestrator.db"), { readOnly: true }).prepare("SELECT filled_by, error FROM project_capture_requests WHERE capture_key='quick-key-0002'").get() as { filled_by: string; error: string };
  assert.deepEqual([row.filled_by, row.error], ["plain", "usage limit"]);

  // GitHub refuses: the request is failed, with a reason the page can show.
  await capture.submit({ key: "quick-key-0003", project: "kurami", text: "Something else" }, "owner");
  assert.equal((await processCapture(home, "quick-key-0003", { fill: async () => ({ template: null, title: "Something else", sections: [{ label: "Что", value: "x" }] }), client: { create: async () => { throw new Error("502"); } } })).state, "failed");
  assert.deepEqual([(capture.status("quick-key-0003") as { state: string; error: string }).state, (capture.status("quick-key-0003") as { error: string }).error], ["failed", "GitHub сейчас недоступен."]);
  console.log(JSON.stringify({ ok: true, quickCapture: "forms, instructions, checked answers, body, filed once with labels, plain fallback, GitHub failure" }));
} finally { rmSync(home, { recursive: true, force: true }); }
