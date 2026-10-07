// Project chronicle: status moves become started / review / returned / done, CI repairs and AI reviews join
// them, days follow the local time zone newest first, unknown projects and same-status events are skipped.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readChronicle } from "../src/orchestrator/projects/chronicle.ts";
import { renderHubDashboard } from "../src/hub/render.ts";
import { syntheticHubSnapshot } from "../src/ui-library/testing/fixtures.ts";
import { renderWeeklyChronicle } from "../src/briefing/weekly/chronicle.ts";
import { withDigestLanguage } from "../src/briefing/i18n.ts";

const app = resolve(import.meta.dirname, ".."), home = mkdtempSync(join(tmpdir(), "kurami-chronicle-"));
const statuses = { backlog: "Backlog", active: "In progress", review: "Human Review", done: "Done", deferred: "Deferred" };
try {
  execFileSync(process.execPath, [resolve(app, "src/orchestrator/state/init-run-store.ts")], { env: { ...process.env, KURAMI_HOME: home, ORCHESTRATOR_MIGRATIONS_DIR: resolve(app, "migrations") }, stdio: ["ignore", "ignore", "pipe"] });
  const path = join(home, "state/orchestrator.db"), database = new DatabaseSync(path);
  const event = (id: string, at: string, project: string, issue: number, from: string | null, to: string) => database.prepare(`INSERT INTO project_events
    (event_id,observed_at,project,item_id,content_id,content_type,repository,issue_number,title,url,from_status,to_status,payload_json,processing_state)
    VALUES (?,?,?,?,?,'Issue','Owner/Repo',?,?,'https://example.invalid',?,?,'{}','processed')`).run(id, at, project, `item-${issue}`, `content-${issue}`, issue, `Task ${issue}`, from, to);
  event("e1", "2026-10-05T21:30:00Z", "pickflick", 1, "Backlog", "In progress");   // 00:30 on the 6th in Vilnius
  event("e2", "2026-10-06T10:00:00Z", "pickflick", 1, "In progress", "Human Review");
  event("e3", "2026-10-06T12:00:00Z", "pickflick", 1, "Human Review", "In progress");
  event("e4", "2026-10-07T08:00:00Z", "pickflick", 1, "In progress", "Done");
  event("e5", "2026-10-07T08:30:00Z", "pickflick", 2, "Backlog", "Backlog");
  event("e6", "2026-10-07T08:40:00Z", "other", 3, "Backlog", "In progress");
  event("e7", "2026-09-20T08:00:00Z", "pickflick", 4, "Backlog", "In progress");
  database.close();
  const days = readChronicle(path, { pickflick: { statuses } }, new Date("2026-10-07T12:00:00Z"))!;
  assert.deepEqual(days.map(day => [day.day, day.events.map(entry => `${entry.issue}:${entry.kind}`)]), [
    ["2026-10-07", ["1:done"]],
    ["2026-10-06", ["1:started", "1:review", "1:returned"]],
  ], "local days, newest first; same-status, unknown-project and old events are left out");
  assert.equal(readChronicle(join(home, "missing.db"), {}, new Date()), null);

  const html = renderHubDashboard(syntheticHubSnapshot(), "ru");
  assert.match(html, /<h2 id="chronicle-title">.*Летопись недели<\/h2><span>6 событий<\/span>/);
  assert.match(html, /PickFlick #123<\/strong> исправление CI · удалось/);
  assert.match(html, /Ещё 1 дн\./, "older days fold away");
  const empty = syntheticHubSnapshot(); empty.chronicle = [];
  assert.doesNotMatch(renderHubDashboard(empty, "en"), /chronicle-title/);
  const weekly = withDigestLanguage("ru", () => renderWeeklyChronicle({ names: { pickflick: "PickFlick" }, days: [{ day: "2026-10-07", events: [{ at: "2026-10-07T08:00:00Z", project: "pickflick", issue: 1, title: "Task <1>", kind: "done" }] }] }));
  assert.match(weekly, /<h2 id="weekly-chronicle-heading">Летопись проектов<\/h2>/);
  assert.match(weekly, /<strong>PickFlick #1<\/strong> завершена — Task &lt;1&gt;/);
  assert.equal(renderWeeklyChronicle({ names: {}, days: [] }), "", "a quiet week renders nothing in Weekly");
  console.log(JSON.stringify({ ok: true, chronicle: "kinds, local days, filters, Hub section, empty week" }));
} finally { rmSync(home, { recursive: true, force: true }); }
