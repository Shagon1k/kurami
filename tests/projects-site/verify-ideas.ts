// The ideas pool: only the gist is required; a repeated submit returns the same idea; the journal is
// append-only; "task" needs the issue link; ideas arrive through chats (the CLI behind the kurami-ideas skill,
// installed for Hermes, Claude Code and Codex); Projects notes, moves and turns an idea into an issue in the
// the block renders in both themes' terms; all words are translated.
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
import { PROJECTS_STYLES } from "../../src/projects-site/styles.ts";
import { mkdtempSync as tempDir, readFileSync, existsSync } from "node:fs";
import { createProjectsServer } from "../../src/projects-site/server.ts";
import { browserMessages } from "../../src/projects-site/i18n.ts";
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
  const fromDiscord = cli("capture", "--summary", "Idea from Discord", "--original", "сырое сообщение", "--when", "soon", "--source", "discord");
  assert.deepEqual([fromDiscord.idea.source, fromDiscord.idea.original, fromDiscord.idea.horizon], ["discord", "сырое сообщение", "soon"]);
  for (const source of ["telegram", "claude", "codex", "chat"]) assert.equal(cli("capture", "--summary", `From ${source}`, "--source", source).idea.source, source);
  assert.throws(() => captureIdea(home, { summary: "From a form", source: "site" }, "owner"), /Source must be one of/, "ideas come from chats, not a site form");
  for (const id of cli("list", "--open").ideas.filter((idea: { summary: string }) => idea.summary.startsWith("From ")).map((idea: { id: number }) => idea.id)) cli("status", String(id), "--to", "closed");
  assert.equal(cli("list", "--open").openCount, 2);
  assert.throws(() => execFileSync(process.execPath, [resolve(app, "src/system/ideas/ideas.ts"), "capture", "--summary", "x"], { env: { ...process.env, KURAMI_HOME: home }, stdio: "pipe" }), (error: { status: number; stderr: Buffer }) => error.status === 2 && /"ok":false/.test(error.stderr.toString()));

  // Projects actions: only a note. Capture, status and "make it a task" are chat requests (the skill and its CLI).
  const act = createIdeasAction({ home });
  const site = { idea: captureIdea(home, { summary: "Watch party mode", context: "Friends asked", area: "kurami", original: "a link", source: "chat" }, "owner") };
  await act({ action: "note", id: site.idea.id, note: "Maybe after v2" }, "owner");
  assert.equal(readIdea(home, site.idea.id)!.notes.at(-1)!.text, "Maybe after v2");
  for (const action of ["capture", "status", "task"]) await assert.rejects(act({ action, id: site.idea.id, status: "parked", target: "kurami", summary: "x".repeat(5) }, "owner"), /Некорректный запрос/, `${action} is not a page action`);
  await assert.rejects(act({ action: "note", id: site.idea.id, note: "" }, "owner"), /Проверь поля идеи/);
  await assert.rejects(act({ action: "note", id: 999, note: "x" }, "owner"), /Идея не найдена/);

  // Rendering: the capture form stays about tasks; the block is a framed panel (Neon dresses it) with numbered,
  // tagged rows, a handwritten Kurami note and an accent bar that glows only where the theme's mark-glow says so.
  const snapshot = { generatedAt: "2026-10-07T10:00:00Z", available: true, projects: [{ key: "pickflick", name: "PickFlick" }], items: [] } as unknown as ProjectsSnapshot;
  assert.doesNotMatch(renderCaptureDialog(snapshot, new URLSearchParams({ lang: "ru" })), /data-capture-kind|Идея/, "no idea form");
  const view = collectIdeasView(home);
  const block = renderIdeasBlock(view, snapshot.projects, "ru");
  assert.match(block, /<section class="projects-ideas" id="projects-ideas" aria-labelledby="projects-ideas-title" data-ui-surface="panel">/);
  assert.match(block, /<p class="projects-ideas__note">мысли на потом, не задачи<\/p>/);
  assert.match(block, /data-disclosure-key="idea:\d+"><summary><span class="projects-idea__head"><span class="projects-idea__number">#\d+<\/span><span class="projects-idea__gist">Keyed idea<\/span><span class="projects-idea__tags">.*Думаю.*Kurami.*В этом месяце/);
  assert.match(PROJECTS_STYLES, /\.projects-ideas__item::before \{[^}]*color: var\(--accent-data\)[^}]*box-shadow: var\(--mark-glow\)/);
  assert.match(PROJECTS_STYLES, /\.projects-ideas__note \{[^}]*var\(--font-note\)[^}]*text-shadow: var\(--display-glow\)/);
  assert.doesNotMatch(block, /data-idea-form="(status|task)"/, "only notes on the page");
  assert.match(block, /<div class="projects-ideas__heading"><h2 id="projects-ideas-title">Идеи<\/h2><span class="projects-ideas__count">\d+ открыт/, "a plain heading (Neon adds its sign) and a quiet count");
  const hostile = renderIdeasBlock({ available: true, openCount: 1, ideas: [{ ...view.ideas[0]!, summary: "<script>x</script>", context: "<b>", notes: [] }] }, snapshot.projects, "en");
  assert.match(hostile, /<span class="projects-idea__gist">&lt;script&gt;x&lt;\/script&gt;<\/span>/);
  assert.doesNotMatch(hostile, /<script>x|<b>/, "idea text is escaped");
  assert.match(renderIdeasBlock({ available: true, openCount: 0, ideas: [] }, [], "en"), /No open ideas/);
  assert.match(renderIdeasBlock({ available: false, openCount: 0, ideas: [] }, [], "en"), /cannot be read/);

  // Server: /api/ideas is a same-origin JSON action like the others.
  const server = createProjectsServer({ authorize: async () => "owner", origin: "https://kurami.example", snapshot: () => snapshot, ideas: async input => ({ state: "noted", echo: (input as { note: string }).note }) });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ideas`, headers = { "content-type": "application/json", origin: "https://kurami.example" };
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ action: "note", id: 1, note: "Via server" }) });
    assert.deepEqual([response.status, await response.json()], [200, { state: "noted", echo: "Via server" }]);
    assert.equal((await fetch(url, { method: "POST", headers: { ...headers, origin: "https://evil.example" }, body: "{}" })).status, 403);
  } finally { server.close(); }

  // Every word on the block and the form exists in Russian.
  const ru = browserMessages("ru");
  for (const key of ["Ideas", "thoughts for later, not tasks", "Make it a task in", "The idea became a task.", "No open ideas. Tell any Kurami chat: “save an idea: …”."]) assert.notEqual(ru[key], key, `${key} is translated`);

  // One skill for every agent: the sync installs kurami-ideas for Hermes, Claude Code and Codex, and skips an agent that is not installed.
  const agents = tempDir(join(tmpdir(), "kurami-agents-"));
  try {
    for (const dir of ["hermes/skills", "claude", "codex"]) mkdirSync(join(agents, dir), { recursive: true });
    const out = execFileSync("bash", [resolve(app, "bin/sync-hermes-skills.sh"), "--apply"], { env: { ...process.env, HERMES_HOME: join(agents, "hermes"), CLAUDE_CONFIG_DIR: join(agents, "claude"), CODEX_HOME: join(agents, "codex") }, encoding: "utf8" });
    for (const root of ["hermes/skills", "claude/skills", "codex/skills"]) assert.equal(readFileSync(join(agents, root, "kurami-ideas/SKILL.md"), "utf8"), readFileSync(resolve(app, "integrations/hermes/skills/kurami-ideas/SKILL.md"), "utf8"), `${root} has the skill`);
    assert.ok(!existsSync(join(agents, "claude/skills/kurami-run-control")), "Hermes-only skills stay in Hermes");
    assert.match(execFileSync("bash", [resolve(app, "bin/sync-hermes-skills.sh"), "--check"], { env: { ...process.env, HERMES_HOME: join(agents, "hermes"), CLAUDE_CONFIG_DIR: join(agents, "claude"), CODEX_HOME: join(agents, "missing") }, encoding: "utf8" }), /missing: agent not installed, skipped/);
    assert.match(out, /kurami-ideas → .*codex\/skills: installed/);
  } finally { rmSync(agents, { recursive: true, force: true }); }
  const skill = readFileSync(resolve(app, "integrations/hermes/skills/kurami-ideas/SKILL.md"), "utf8");
  for (const phrase of ["Discord, Telegram, a Claude Code or Codex session, the Kurami site chat", "Never start, plan or assign work", "--source <where>", "do not\npretend it was saved"]) assert.ok(skill.includes(phrase), `skill says: ${phrase}`);
  console.log(JSON.stringify({ ok: true, ideas: "store, journal, chat sources, CLI, Projects actions, issue once, styled block, escaping, server route, Russian, one skill for every agent" }));
} finally { rmSync(home, { recursive: true, force: true }); }
