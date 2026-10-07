// The ideas pool: only the gist is required; a repeated submit returns the same idea; the journal is
// append-only; "task" needs the issue link; Projects captures, notes, moves and turns an idea into an issue
// in the chosen project; the block and the capture form render both kinds; the CLI speaks JSON; all words
// are translated.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AddressInfo } from "node:net";
import { addIdeaNote, captureIdea, ideasPath, listIdeas, readIdea, setIdeaStatus } from "../../src/system/ideas/ideas.ts";
import { collectIdeasView, createIdeasAction, renderIdeasBlock } from "../../src/projects-site/ideas.ts";
import { renderCaptureDialog } from "../../src/projects-site/render.ts";
import { createProjectsServer } from "../../src/projects-site/server.ts";
import { browserMessages } from "../../src/projects-site/i18n.ts";
import type { BacklogTarget } from "../../src/orchestrator/integrations/github/backlog-capture.ts";
import type { ProjectsSnapshot } from "../../src/projects-site/model.ts";

const app = resolve(import.meta.dirname, "../.."), home = mkdtempSync(join(tmpdir(), "kurami-ideas-"));
try {
  // Store: nothing yet is an empty pool, not an error.
  assert.deepEqual(listIdeas(home), { available: true, ideas: [], openCount: 0 });
  const bare = captureIdea(home, { summary: "  A  tiny   idea " }, "owner", new Date("2026-10-07T10:00:00Z"));
  assert.deepEqual([bare.summary, bare.status, bare.source, bare.context, bare.area, bare.horizon], ["A tiny idea", "new", "cli", null, null, null], "only the gist is required");
  assert.throws(() => captureIdea(home, { summary: "ab" }, "owner"), /at least 3/);
  assert.throws(() => captureIdea(home, { summary: "Valid", horizon: "tomorrow" }, "owner"), /When must be one of/);
  assert.throws(() => captureIdea(home, { summary: "Valid", area: "../etc" }, "owner"), /Area/);
  const keyed = captureIdea(home, { summary: "Keyed idea", key: "idea-key-0001", area: "kurami", horizon: "month" }, "owner");
  assert.equal(captureIdea(home, { summary: "Keyed idea again", key: "idea-key-0001" }, "owner").id, keyed.id, "a repeated submit returns the same idea");
  addIdeaNote(home, keyed.id, "first note", "owner");
  setIdeaStatus(home, keyed.id, "thinking", "owner");
  assert.throws(() => setIdeaStatus(home, keyed.id, "task", "owner"), /GitHub issue link/);
  assert.deepEqual(readIdea(home, keyed.id)!.notes.map(note => [note.kind, note.text]), [["status", "new"], ["note", "first note"], ["status", "thinking"]]);
  const database = new DatabaseSync(ideasPath(home));
  assert.throws(() => database.exec("UPDATE idea_notes SET text = 'rewritten'"), /append-only/);
  assert.throws(() => database.exec("DELETE FROM idea_notes"), /append-only/);
  database.close();
  setIdeaStatus(home, bare.id, "parked", "owner");
  const open = listIdeas(home, { open: true, notes: true });
  assert.deepEqual([open.openCount, open.ideas.map(idea => idea.id)], [1, [keyed.id]], "parked ideas leave the open list");

  // CLI for the Hermes skill.
  const cli = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [resolve(app, "src/system/ideas/ideas.ts"), ...args], { env: { ...process.env, KURAMI_HOME: home }, encoding: "utf8" }));
  const fromDiscord = cli("capture", "--summary", "Idea from Discord", "--original", "сырое сообщение", "--when", "soon");
  assert.deepEqual([fromDiscord.idea.source, fromDiscord.idea.original, fromDiscord.idea.horizon], ["discord", "сырое сообщение", "soon"]);
  assert.equal(cli("list", "--open").openCount, 2);
  assert.throws(() => execFileSync(process.execPath, [resolve(app, "src/system/ideas/ideas.ts"), "capture", "--summary", "x"], { env: { ...process.env, KURAMI_HOME: home }, stdio: "pipe" }), (error: { status: number; stderr: Buffer }) => error.status === 2 && /"ok":false/.test(error.stderr.toString()));

  // Projects actions: capture from the site keeps shared text and a Kurami page as the original; task files an issue once.
  mkdirSync(join(home, "config"), { recursive: true });
  writeFileSync(join(home, "config/projects.yaml"), "version: 1\nprojects:\n  pickflick:\n    owner: Shagon1k\n    project_number: 3\n    repository: Shagon1k/PickFlick\n    status_field: Status\n    statuses: {backlog: Backlog, active: In progress, review: Human Review, done: Done, deferred: Deferred}\n");
  const created: { target: BacklogTarget; title: string; body: string }[] = [];
  const act = createIdeasAction({ home, client: { create: async (target, title, body) => { created.push({ target, title, body }); return { number: 7, url: `https://github.com/${target.repository}/issues/7`, onBoard: Boolean(target.board) }; } } });
  const site = await act({ action: "capture", key: "site-key-0001", summary: "Watch party mode", context: "Friends asked", area: "pickflick", shared: "a link", source: "https://kurami.shagon1k.win/en/projects/" }, "owner") as { idea: { id: number; original: string; source: string } };
  assert.deepEqual([site.idea.source, site.idea.original], ["site", "a link\n\nСтраница: https://kurami.shagon1k.win/en/projects/"]);
  await act({ action: "note", id: site.idea.id, note: "Maybe after v2" }, "owner");
  await assert.rejects(act({ action: "status", id: site.idea.id, status: "task" }, "owner"), /Некорректный запрос/, "task only through the task action");
  await assert.rejects(act({ action: "capture", summary: "ab" }, "owner"), /Суть идеи — от 3 до 200 символов/);
  await assert.rejects(act({ action: "task", id: site.idea.id, target: "unknown" }, "owner"), /Выбери проект/);
  await assert.rejects(act({ action: "note", id: 999, note: "x" }, "owner"), /Идея не найдена/);
  const task = await act({ action: "task", id: site.idea.id, target: "pickflick" }, "owner") as { url: string; onBoard: boolean };
  assert.deepEqual([task.url, task.onBoard, created[0]!.title], ["https://github.com/Shagon1k/PickFlick/issues/7", true, "Watch party mode"]);
  assert.match(created[0]!.body, /\*\*Что натолкнуло:\*\* Friends asked[\s\S]*> a link[\s\S]*идея #\d+/);
  assert.equal(((await act({ action: "task", id: site.idea.id, target: "pickflick" }, "owner")) as { url: string }).url, task.url);
  assert.equal(created.length, 1, "a second request does not file another issue");
  assert.equal(readIdea(home, site.idea.id)!.status, "task");

  // Rendering: the capture form offers Task and Idea; the idea set starts disabled so its required gist cannot block a task.
  const snapshot = { generatedAt: "2026-10-07T10:00:00Z", available: true, projects: [{ key: "pickflick", name: "PickFlick" }], items: [] } as unknown as ProjectsSnapshot;
  const dialog = renderCaptureDialog(snapshot, new URLSearchParams({ lang: "ru" }));
  assert.match(dialog, /data-capture-kind="task" aria-pressed="true"[\s\S]*data-capture-kind="idea" aria-pressed="false"/);
  assert.match(dialog, /<fieldset class="projects-capture__fields" data-capture-fields="idea" disabled hidden>/);
  assert.match(dialog, /Суть одной фразой[\s\S]*Что натолкнуло[\s\S]*Куда относится[\s\S]*<option value="other" selected>Другое<\/option>/);
  const view = collectIdeasView(home);
  const block = renderIdeasBlock(view, snapshot.projects, "ru");
  assert.match(block, /<section class="projects-ideas" id="projects-ideas"/);
  assert.match(block, /data-disclosure-key="idea:\d+"/);
  assert.match(block, /data-idea-form="task"[\s\S]*<option value="kurami" selected>Kurami<\/option>/, "Kurami ideas default to a Kurami issue");
  assert.doesNotMatch(block, /data-idea-form="task"[^]*<option value="other"/, "a life idea cannot become a project issue");
  const hostile = renderIdeasBlock({ available: true, openCount: 1, ideas: [{ ...view.ideas[0]!, summary: "<script>x</script>", context: "<b>", notes: [] }] }, snapshot.projects, "en");
  assert.doesNotMatch(hostile, /<script>x|<b>/, "idea text is escaped");
  assert.match(renderIdeasBlock({ available: true, openCount: 0, ideas: [] }, [], "en"), /No open ideas/);
  assert.match(renderIdeasBlock({ available: false, openCount: 0, ideas: [] }, [], "en"), /cannot be read/);

  // Server: /api/ideas is a same-origin JSON action like the others.
  const server = createProjectsServer({ authorize: async () => "owner", origin: "https://kurami.example", snapshot: () => snapshot, ideas: async input => ({ state: "captured", echo: (input as { summary: string }).summary }) });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ideas`, headers = { "content-type": "application/json", origin: "https://kurami.example" };
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ action: "capture", summary: "Via server" }) });
    assert.deepEqual([response.status, await response.json()], [201, { state: "captured", echo: "Via server" }]);
    assert.equal((await fetch(url, { method: "POST", headers: { ...headers, origin: "https://evil.example" }, body: "{}" })).status, 403);
  } finally { server.close(); }

  // Every word on the block and the form exists in Russian.
  const ru = browserMessages("ru");
  for (const key of ["Ideas", "Idea", "Save idea", "The gist in one phrase", "Make it a task in", "Idea saved. It is in the Ideas block under the tasks.", "The idea became a task."]) assert.notEqual(ru[key], key, `${key} is translated`);
  console.log(JSON.stringify({ ok: true, ideas: "store, journal, CLI, Projects actions, issue once, form and block, escaping, server route, Russian" }));
} finally { rmSync(home, { recursive: true, force: true }); }
