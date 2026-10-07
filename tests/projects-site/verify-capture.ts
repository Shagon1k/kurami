// Backlog capture: a managed project gets an issue on its board in Backlog, Kurami a plain issue; input is
// checked again on the server; a repeated submit returns the same issue; only Kurami pages count as a source;
// the share target and the shortcut land on the prefilled form.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureSource, captureTargets, createCaptureAction } from "../../src/projects-site/capture.ts";
import { renderCaptureDialog } from "../../src/projects-site/render.ts";
import { resolveWebRoute } from "../../src/web/routes.ts";
import type { BacklogTarget } from "../../src/orchestrator/integrations/github/backlog-capture.ts";
import type { ProjectsSnapshot } from "../../src/projects-site/model.ts";

const home = mkdtempSync(join(tmpdir(), "kurami-capture-"));
try {
  mkdirSync(join(home, "config"));
  writeFileSync(join(home, "config/projects.yaml"), `version: 1\nprojects:\n  pickflick:\n    owner: Shagon1k\n    project_number: 3\n    repository: Shagon1k/PickFlick\n    status_field: Status\n    statuses: {backlog: Backlog, active: In progress, review: Human Review, done: Done, deferred: Deferred}\n`);
  assert.deepEqual(captureTargets(home).map(target => [target.key, target.name, target.target.board?.backlog ?? null]), [["pickflick", "PickFlick", "Backlog"], ["kurami", "Kurami", null]]);

  const created: { target: BacklogTarget; title: string; body: string }[] = [];
  const capture = createCaptureAction({ home, client: { create: async (target, title, body) => { created.push({ target, title, body }); return { number: 41 + created.length, url: `https://github.com/${target.repository}/issues/${41 + created.length}`, onBoard: Boolean(target.board) }; } } });
  const result = await capture({ key: "capture-key-1", project: "pickflick", title: "  Watchlist   loses order ", note: "After a refresh.", shared: "line one\nline two", source: "https://kurami.shagon1k.win/ru/digest/" }, "owner");
  assert.deepEqual(result, { state: "created", project: "pickflick", number: 42, url: "https://github.com/Shagon1k/PickFlick/issues/42", onBoard: true });
  assert.equal(created[0]!.title, "Watchlist loses order");
  assert.equal(created[0]!.body, "After a refresh.\n\n> line one\n> line two\n\nСтраница: https://kurami.shagon1k.win/ru/digest/\n\n_Записано через Kurami._");
  assert.deepEqual(await capture({ key: "capture-key-1", project: "pickflick", title: "Watchlist loses order" }, "owner"), result, "a repeated submit returns the same issue");
  assert.equal(created.length, 1);
  assert.equal(((await capture({ key: "capture-key-2", project: "kurami", title: "Idea for Hub" }, "owner")) as { onBoard: boolean }).onBoard, false, "Kurami ideas are plain issues");
  for (const bad of [{ project: "unknown", title: "Valid title" }, { project: "kurami", title: "ab" }, { project: "kurami", title: "x".repeat(201) }, { project: "kurami", title: "Valid", note: "x".repeat(4001) }, { project: "kurami", title: "Valid", key: "short" }])
    await assert.rejects(capture({ key: "capture-key-3", ...bad }, "owner"));
  const failing = createCaptureAction({ home, client: { create: async () => { throw new Error("HTTP 502 with private details"); } } });
  await assert.rejects(failing({ key: "capture-key-4", project: "kurami", title: "Valid title" }, "owner"), (error: Error) => /GitHub сейчас недоступен/.test(error.message) && !/private/.test(error.message));

  assert.equal(captureSource("https://kurami.shagon1k.win/en/"), "https://kurami.shagon1k.win/en/");
  assert.equal(captureSource("https://example.org/phish"), null, "only Kurami pages are cited");

  // Entry points: Share → Kurami and the shortcut open the prefilled form.
  assert.deepEqual(resolveWebRoute("/share?title=Bug&text=Steps&url=https%3A%2F%2Fexample.org%2Fx"), { redirect: "/en/projects/?capture=1&title=Bug&text=Steps&url=https%3A%2F%2Fexample.org%2Fx" });
  assert.deepEqual(resolveWebRoute("/?open=capture"), { redirect: "/en/projects/?capture=1" });
  const snapshot = { generatedAt: "2026-10-07T05:00:00Z", available: true, projects: [{ key: "pickflick", name: "PickFlick" }], items: [] } as unknown as ProjectsSnapshot;
  const dialog = renderCaptureDialog(snapshot, new URLSearchParams({ lang: "ru", capture: "1", title: "Bug <b>", text: "Steps", source: "https://kurami.shagon1k.win/ru/" }));
  assert.match(dialog, /<dialog data-open-on-load id="projects-capture"/);
  assert.match(dialog, /value="Bug &lt;b&gt;"/, "shared text is escaped");
  assert.match(dialog, /<option value="kurami" selected>Kurami<\/option>/, "a report from a Kurami page goes to Kurami");
  assert.doesNotMatch(renderCaptureDialog(snapshot, new URLSearchParams()), /data-open-on-load/);
  console.log(JSON.stringify({ ok: true, capture: "board vs plain issue, server checks, idempotent submit, safe source, share target, shortcut, prefill" }));
} finally { rmSync(home, { recursive: true, force: true }); }
