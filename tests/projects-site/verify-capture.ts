// Quick capture: the request is checked on the server and queued once per key; the worker starts outside the
// service; a failed start marks the request and says so; only Kurami pages count as a source; the share target
// and the shortcut land on the prefilled form; the "+" belongs to Projects.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { captureSource, captureTargets, createCaptureAction } from "../../src/projects-site/capture.ts";
import { renderCaptureDialog } from "../../src/projects-site/render.ts";
import { resolveWebRoute } from "../../src/web/routes.ts";
import { execFileSync } from "node:child_process";
import type { ProjectsSnapshot } from "../../src/projects-site/model.ts";

const home = mkdtempSync(join(tmpdir(), "kurami-capture-"));
try {
  mkdirSync(join(home, "config")); mkdirSync(join(home, "state"));
  writeFileSync(join(home, "config/projects.yaml"), `version: 1\nprojects:\n  pickflick:\n    owner: Shagon1k\n    project_number: 3\n    repository: Shagon1k/PickFlick\n    status_field: Status\n    statuses: {backlog: Backlog, active: In progress, review: Human Review, done: Done, deferred: Deferred}\n    workspace: {canonical_repository: /nowhere/PickFlick}\n`);
  const app = resolve(import.meta.dirname, "../..");
  execFileSync(process.execPath, [resolve(app, "src/orchestrator/state/init-run-store.ts")], { env: { ...process.env, KURAMI_HOME: home, ORCHESTRATOR_MIGRATIONS_DIR: resolve(app, "migrations") }, stdio: ["ignore", "ignore", "pipe"] });
  assert.deepEqual(captureTargets(home).map(target => [target.key, target.name, target.target.board?.backlog ?? null]), [["pickflick", "PickFlick", "Backlog"], ["kurami", "Kurami", null]]);

  const started: string[] = [];
  const capture = createCaptureAction({ home, start: async (_home, key) => { started.push(key); } });
  const queued = await capture.submit({ key: "capture-key-1", project: "pickflick", text: "  Watchlist loses order after a refresh ", shared: "line one", source: "https://kurami.shagon1k.win/ru/digest/" }, "owner");
  assert.deepEqual(queued, { key: "capture-key-1", state: "queued", project: "pickflick" });
  assert.deepEqual(started, ["capture-key-1"], "the worker starts once");
  assert.deepEqual((await capture.submit({ key: "capture-key-1", project: "pickflick", text: "again" }, "owner") as { state: string }).state, "queued", "a repeated submit returns the queued request");
  assert.equal(started.length, 1);
  assert.deepEqual(capture.status("capture-key-1"), { key: "capture-key-1", state: "queued", project: "pickflick", number: null, url: null, onBoard: false, filledBy: null, error: null });
  for (const bad of [{ project: "unknown", text: "Valid text" }, { project: "kurami", text: "ab" }, { project: "kurami", text: "x".repeat(4001) }, { project: "kurami", text: "Valid", key: "short" }])
    await assert.rejects(capture.submit({ key: "capture-key-3", ...bad }, "owner"));
  assert.throws(() => capture.status("../../etc"), /Некорректный запрос/);
  assert.throws(() => capture.status("missing-key-1"), /Запрос не найден/);

  const failing = createCaptureAction({ home, start: async () => { throw new Error("no systemd"); } });
  await assert.rejects(failing.submit({ key: "capture-key-4", project: "kurami", text: "Valid text" }, "owner"), (error: Error) => /не может взяться/.test(error.message));
  assert.equal((failing.status("capture-key-4") as { state: string }).state, "failed", "a request that could not start is marked, not left queued");

  assert.equal(captureSource("https://kurami.shagon1k.win/en/"), "https://kurami.shagon1k.win/en/");
  assert.equal(captureSource("https://example.org/phish"), null, "only Kurami pages are cited");

  // Entry points: Share → Kurami and the shortcut open the prefilled form.
  assert.deepEqual(resolveWebRoute("/share?title=Bug&text=Steps&url=https%3A%2F%2Fexample.org%2Fx"), { redirect: "/en/projects/?capture=1&title=Bug&text=Steps&url=https%3A%2F%2Fexample.org%2Fx" });
  assert.deepEqual(resolveWebRoute("/?open=capture"), { redirect: "/en/projects/?capture=1" });
  const snapshot = { generatedAt: "2026-10-07T05:00:00Z", available: true, projects: [{ key: "pickflick", name: "PickFlick" }], items: [] } as unknown as ProjectsSnapshot;
  const dialog = renderCaptureDialog(snapshot, new URLSearchParams({ lang: "ru", capture: "1", title: "Bug <b>", text: "Steps", source: "https://kurami.shagon1k.win/ru/" }));
  assert.match(dialog, /<dialog data-open-on-load id="projects-capture"/);
  assert.match(dialog, /Быстрая задача[\s\S]*Что сделать\?[\s\S]*Bug &lt;b&gt;<\/textarea>/, "one field in the owner's words, escaped");
  assert.match(dialog, /Kurami оформит задачу по шаблону проекта[\s\S]*Передать Kurami/);
  assert.match(dialog, /<option value="kurami" selected>Kurami<\/option>/, "a report from a Kurami page goes to Kurami");
  assert.doesNotMatch(renderCaptureDialog(snapshot, new URLSearchParams()), /data-open-on-load/);
  console.log(JSON.stringify({ ok: true, capture: "server checks, queued once, worker start and its failure, status, safe source, share target, shortcut, header +, one-field form" }));
} finally { rmSync(home, { recursive: true, force: true }); }
